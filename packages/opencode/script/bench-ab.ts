#!/usr/bin/env bun
// End-to-end A/B benchmark of token usage. Each variant runs the same tasks through `opencode run` against
// the same target repository, with its own data directory, and token usage is read back from the
// assistant messages the session persisted.
//
//   bun script/bench-ab.ts [--reps 3] [--model deepseek/deepseek-v4-pro] [--variants full,no-tool-opt,upstream]
//                          [--tasks id,id] [--upstream ../../../opencode-upstream] [--concurrency 3]
//
// Variants:
//   full         this checkout
//   no-tool-opt  this checkout with OPENCODE_DISABLE_TOOL_OUTPUT_OPTIMIZATIONS=1 (no skeleton, no shell pruning)
//   upstream     a worktree of upstream dev (pass --upstream), the baseline without any local optimization
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Database } from "bun:sqlite"
import { parseArgs } from "util"

const args = parseArgs({
  options: {
    reps: { type: "string", default: "3" },
    model: { type: "string", default: "deepseek/deepseek-v4-pro" },
    variants: { type: "string", default: "full,no-tool-opt,upstream" },
    tasks: { type: "string" },
    upstream: { type: "string", default: path.resolve(import.meta.dir, "../../../../opencode-upstream") },
    concurrency: { type: "string", default: "3" },
    timeout: { type: "string", default: "600" },
    out: { type: "string" },
  },
}).values

const target = path.resolve(import.meta.dir, "../../..")
const out = path.resolve(
  args.out ?? path.join(os.homedir(), ".local/share/opencode-bench", new Date().toISOString().replace(/[:.]/g, "-")),
)

const variants = [
  { id: "full", source: target, env: {} },
  { id: "no-tool-opt", source: target, env: { OPENCODE_DISABLE_TOOL_OUTPUT_OPTIMIZATIONS: "1" } },
  { id: "upstream", source: path.resolve(args.upstream), env: {} },
].filter((variant) => args.variants.split(",").includes(variant.id))

const expected = await computeExpectations()

// Every task must be answerable from the target repository alone, whatever opencode version runs it.
const tasks = [
  {
    id: "resumen-archivo-grande",
    prompt: "Explicá en 5 viñetas qué hace packages/opencode/src/session/processor.ts.",
    check: (answer: string) => /processor/i.test(answer) && /tool|herramienta/i.test(answer),
  },
  {
    id: "detalle-implementacion",
    prompt:
      "En packages/opencode/src/tool/shell.ts, ¿qué hace exactamente la función `tail` cuando el texto supera maxLines o maxBytes? Explicá el algoritmo línea por línea.",
    check: (answer: string) => /tail/i.test(answer) && /bytes?/i.test(answer),
  },
  {
    id: "buscar-definicion",
    prompt: "¿En qué archivo se define la función `compactLargeDiff` y qué umbral de bytes usa?",
    check: (answer: string) => /edit\.ts/.test(answer) && /2048|2\s?KB/i.test(answer),
  },
  {
    id: "correr-tests",
    prompt:
      "Corré `bun test test/tool/read.test.ts` dentro de packages/opencode y decime cuántos tests pasaron y cuántos fallaron.",
    check: (answer: string) => answer.includes(String(expected.readTestsPassed)),
  },
  {
    id: "log-git",
    prompt: "Ejecutá `git log --oneline -n 300` y decime el hash del commit más antiguo de esa lista.",
    check: (answer: string) => answer.includes(expected.oldestCommit),
  },
  {
    id: "contar-dependencias",
    prompt:
      "¿Cuántas entradas tiene el array `deps` del `node` exportado en packages/opencode/src/tool/registry.ts? Listalas.",
    check: (answer: string) => answer.includes(String(expected.registryDeps)),
  },
].filter((task) => !args.tasks || args.tasks.split(",").includes(task.id))

const jobs = Array.from({ length: Number(args.reps) }, (_, rep) =>
  tasks.flatMap((task) => variants.map((variant) => ({ rep, task, variant }))),
).flat()

console.log(`target: ${target}`)
console.log(`output: ${out}`)
console.log(`model: ${args.model} · ${jobs.length} runs · expected ${JSON.stringify(expected)}`)
await Promise.all(variants.map((variant) => prepareDataHome(variant.id)))

const results = await pool(jobs, Number(args.concurrency), async (job, index) => {
  const result = await runJob(job.variant, job.task.prompt)
  const row = {
    variant: job.variant.id,
    task: job.task.id,
    rep: job.rep,
    ...result,
    correct: result.ok && job.task.check(result.answer),
  }
  console.log(
    `[${index + 1}/${jobs.length}] ${row.variant} · ${row.task} · rep ${row.rep}: ` +
      (row.ok ? `${row.promptTokens} prompt tk, ${row.toolCalls} tools, ${row.correct ? "ok" : "WRONG"}` : `FAILED ${row.error}`),
  )
  return row
})

await Bun.write(path.join(out, "results.json"), JSON.stringify(results, null, 2))
const report = renderReport(results)
await Bun.write(path.join(out, "report.md"), report)
console.log("\n" + report)

type Variant = (typeof variants)[number]
type Result = Awaited<ReturnType<typeof runJob>> & { variant: string; task: string; rep: number; correct: boolean }

async function runJob(variant: Variant, prompt: string) {
  const started = performance.now()
  const proc = Bun.spawn(
    ["bun", "run", "src/index.ts", "run", "--format", "json", "--auto", "--model", args.model, "--dir", target, prompt],
    {
      cwd: path.join(variant.source, "packages/opencode"),
      env: { ...process.env, ...variant.env, XDG_DATA_HOME: dataHome(variant.id) },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const timer = setTimeout(() => proc.kill(), Number(args.timeout) * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  clearTimeout(timer)
  const seconds = (performance.now() - started) / 1000
  const sessionID = stdout
    .split("\n")
    .flatMap((line) => (line.startsWith("{") ? [JSON.parse(line) as { sessionID?: string }] : []))
    .find((event) => event.sessionID)?.sessionID
  if (!sessionID) return { ...emptyUsage(), ok: false, error: stderr.trim().split("\n").at(-1) ?? "no session", seconds }
  return { ...(await readUsage(variant.id, sessionID)), ok: proc.exitCode === 0, error: "", seconds }
}

async function readUsage(variant: string, sessionID: string) {
  const file = (await fs.readdir(path.join(dataHome(variant), "opencode"))).find(
    (name) => name.startsWith("opencode-") && name.endsWith(".db"),
  )
  if (!file) throw new Error(`no database for ${variant}`)
  const db = new Database(path.join(dataHome(variant), "opencode", file), { readonly: true })
  // Subagent work (task tool) runs in child sessions and counts toward the same task.
  const sessions = db
    .query("select id from session where id = ?1 or parent_id = ?1")
    .all(sessionID)
    .map((row) => (row as { id: string }).id)
  const placeholders = sessions.map(() => "?").join(",")
  const messages = db
    .query(`select data from message where session_id in (${placeholders}) order by time_created`)
    .all(...sessions)
    .map((row) => JSON.parse((row as { data: string }).data) as AssistantMessage)
    .filter((message) => message.role === "assistant")
  const parts = db
    .query(`select data from part where session_id in (${placeholders}) order by time_created`)
    .all(...sessions)
    .map((row) => JSON.parse((row as { data: string }).data) as MessagePart)
  db.close()
  const last = messages.at(-1)
  return {
    sessionID,
    steps: messages.length,
    promptTokens: sum(messages, (m) => (m.tokens?.input ?? 0) + (m.tokens?.cache?.read ?? 0) + (m.tokens?.cache?.write ?? 0)),
    uncachedTokens: sum(messages, (m) => m.tokens?.input ?? 0),
    outputTokens: sum(messages, (m) => (m.tokens?.output ?? 0) + (m.tokens?.reasoning ?? 0)),
    cost: sum(messages, (m) => m.cost ?? 0),
    toolCalls: parts.filter((part) => part.type === "tool").length,
    toolOutputChars: sum(parts, (part) => (part.type === "tool" ? (part.state?.output?.length ?? 0) : 0)),
    answer: parts
      .filter((part) => part.type === "text" && part.messageID === last?.id)
      .map((part) => part.text ?? "")
      .join("\n"),
  }
}

type AssistantMessage = {
  id: string
  role: string
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
}
type MessagePart = { type: string; messageID: string; text?: string; state?: { output?: string } }

function emptyUsage() {
  return {
    sessionID: "",
    steps: 0,
    promptTokens: 0,
    uncachedTokens: 0,
    outputTokens: 0,
    cost: 0,
    toolCalls: 0,
    toolOutputChars: 0,
    answer: "",
  }
}

function renderReport(rows: Result[]) {
  const ids = variants.map((variant) => variant.id)
  const baseline = ids.includes("upstream") ? "upstream" : ids.at(-1)
  const medians = (task: string, variant: string) => {
    const runs = rows.filter((row) => row.task === task && row.variant === variant && row.ok)
    return {
      runs: runs.length,
      correct: runs.filter((row) => row.correct).length,
      promptTokens: median(runs.map((row) => row.promptTokens)),
      uncachedTokens: median(runs.map((row) => row.uncachedTokens)),
      outputTokens: median(runs.map((row) => row.outputTokens)),
      cost: median(runs.map((row) => row.cost)),
      toolCalls: median(runs.map((row) => row.toolCalls)),
      seconds: median(runs.map((row) => row.seconds)),
    }
  }
  const totals = ids.map((variant) => {
    const perTask = tasks.map((task) => medians(task.id, variant))
    return {
      variant,
      promptTokens: sum(perTask, (m) => m.promptTokens),
      outputTokens: sum(perTask, (m) => m.outputTokens),
      cost: sum(perTask, (m) => m.cost),
      correct: sum(perTask, (m) => m.correct),
      runs: sum(perTask, (m) => m.runs),
    }
  })
  const base = totals.find((total) => total.variant === baseline)
  const delta = (value: number, reference = 0) =>
    reference === 0 ? "—" : `${value >= reference ? "+" : ""}${(((value - reference) / reference) * 100).toFixed(1)}%`
  return [
    `# A/B de tokens`,
    ``,
    `Modelo \`${args.model}\` · ${args.reps} repeticiones por tarea · medianas por tarea, totales = suma de medianas.`,
    `Prompt tk = input + cache leído + cache escrito (todo lo que el modelo procesó). Línea base: \`${baseline}\`.`,
    ``,
    `## Totales`,
    ``,
    `| Variante | Prompt tk | vs ${baseline} | Output tk | Costo USD | vs ${baseline} | Respuestas correctas |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
    ...totals.map(
      (total) =>
        `| ${total.variant} | ${fmt(total.promptTokens)} | ${delta(total.promptTokens, base?.promptTokens)} | ${fmt(total.outputTokens)} | ${total.cost.toFixed(4)} | ${delta(total.cost, base?.cost)} | ${total.correct}/${total.runs} |`,
    ),
    ``,
    `## Por tarea`,
    ``,
    `| Tarea | Variante | Prompt tk | Sin caché tk | Output tk | Costo USD | Herramientas | Segundos | Correctas |`,
    `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
    ...tasks.flatMap((task) =>
      ids.map((variant) => {
        const m = medians(task.id, variant)
        return `| ${task.id} | ${variant} | ${fmt(m.promptTokens)} | ${fmt(m.uncachedTokens)} | ${fmt(m.outputTokens)} | ${m.cost.toFixed(4)} | ${m.toolCalls} | ${m.seconds.toFixed(0)} | ${m.correct}/${m.runs} |`
      }),
    ),
    ``,
    `Corridas fallidas: ${rows.filter((row) => !row.ok).length}. Datos crudos en \`results.json\`.`,
    ``,
  ].join("\n")
}

async function computeExpectations() {
  const registry = await Bun.file(path.join(target, "packages/opencode/src/tool/registry.ts")).text()
  const deps = registry.slice(registry.indexOf("export const node")).match(/deps:\s*\[([\s\S]*?)\]/)?.[1] ?? ""
  const tests = Bun.spawnSync(["bun", "test", "test/tool/read.test.ts"], { cwd: path.join(target, "packages/opencode") })
  const log = Bun.spawnSync(["git", "log", "--oneline", "-n", "300"], { cwd: target }).stdout.toString().trim()
  return {
    registryDeps: deps.split("\n").filter((line) => /^\s*[\w.]+,?\s*$/.test(line) && line.trim() !== "").length,
    readTestsPassed: Number(/(\d+) pass/.exec(tests.stderr.toString() + tests.stdout.toString())?.[1] ?? -1),
    oldestCommit: log.split("\n").at(-1)?.split(" ")[0]?.slice(0, 7) ?? "",
  }
}

// Each variant gets its own data directory so sessions and migrations never mix; credentials are copied in.
async function prepareDataHome(variant: string) {
  const dir = path.join(dataHome(variant), "opencode")
  await fs.mkdir(dir, { recursive: true })
  const auth = Bun.file(path.join(os.homedir(), ".local/share/opencode/auth.json"))
  if (await auth.exists()) await Bun.write(path.join(dir, "auth.json"), auth)
}

function dataHome(variant: string) {
  return path.join(out, "data", variant)
}

async function pool<T, R>(items: T[], size: number, work: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  const next = { index: 0 }
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next.index < items.length) {
        const index = next.index++
        results[index] = await work(items[index], index)
      }
    }),
  )
  return results
}

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0)
}

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function fmt(value: number) {
  return Math.round(value).toLocaleString("es-AR")
}
