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
    // Spend guard: refuse to start if the estimate exceeds this, and stop launching runs once it is reached.
    "max-cost": { type: "string", default: "1" },
    // Stop after this many consecutive failed runs, so a provider outage does not burn the whole batch.
    "max-failures": { type: "string", default: "3" },
    out: { type: "string" },
  },
}).values

const target = path.resolve(import.meta.dir, "../../..")
// Fixed commit that anchors the git log task; see computeExpectations.
const anchor = "f7da00f35e"
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
// Read tasks answer from repository state pinned by an anchor commit or by a symbol this repo does not edit.
// Edit tasks work on fixture files under the run's output directory, never inside the repository.
const tasks: Task[] = [
  {
    id: "resumen-archivo-grande",
    prompt: () => "Explicá en 5 viñetas qué hace packages/opencode/src/session/processor.ts.",
    check: (answer) => /processor/i.test(answer) && /tool|herramienta/i.test(answer),
  },
  {
    id: "detalle-implementacion",
    prompt: () =>
      "En packages/opencode/src/tool/shell.ts, ¿qué hace exactamente la función `tail` cuando el texto supera maxLines o maxBytes? Explicá el algoritmo línea por línea.",
    check: (answer) => /tail/i.test(answer) && /bytes?/i.test(answer),
  },
  {
    id: "buscar-definicion",
    prompt: () => "¿En qué archivo se define `estimate` en el paquete core y cuántos caracteres por token usa?",
    check: (answer) => /util\/token\.ts|token\.ts/.test(answer) && /\b4\b/.test(answer),
  },
  {
    id: "correr-tests",
    prompt: () =>
      "Corré `bun test test/tool/read.test.ts` dentro de packages/opencode y decime cuántos tests pasaron y cuántos fallaron.",
    check: (answer) => answer.includes(String(expected.readTestsPassed)),
  },
  {
    id: "log-git",
    prompt: () =>
      `Ejecutá \`git log --oneline ${expected.anchor} -n 300\` y decime el hash del commit más antiguo de esa lista.`,
    check: (answer) => answer.includes(expected.oldestCommit),
  },
  {
    id: "contar-dependencias",
    prompt: () =>
      "¿Cuántas entradas tiene el array `deps` del `node` exportado en packages/opencode/src/tool/registry.ts? Listalas.",
    check: (answer) => answer.includes(String(expected.registryDeps)),
  },
  {
    id: "max-read-bytes",
    prompt: () => "¿Cuál es el valor de MAX_READ_BYTES en packages/core/src/tool/read-filesystem.ts, en bytes?",
    check: (answer) => /51[.,\s_]?200|50\s?\*\s?1024|50\s?KB/i.test(answer),
  },
  {
    id: "max-read-lines",
    prompt: () => "¿Cuál es el valor de MAX_READ_LINES en packages/core/src/tool/read-filesystem.ts?",
    check: (answer) => /2[.,\s_]?000/.test(answer),
  },
  {
    id: "contar-tools",
    prompt: () =>
      "¿Cuántos archivos .ts hay directamente dentro de packages/opencode/src/tool (sin contar subcarpetas)?",
    check: (answer) => answer.includes(String(expected.toolFiles)),
  },
  {
    id: "editar-version",
    setup: (dir) => Bun.write(path.join(dir, "fixture.ts"), 'export const VERSION = "1.0.0"\n').then(() => {}),
    prompt: (dir) =>
      `En ${path.join(dir, "fixture.ts")}, cambiá VERSION de "1.0.0" a "2.0.0" con la herramienta de edición. Cuando termines, respondé solo: listo`,
    check: async (answer, dir) => {
      const text = await readText(path.join(dir, "fixture.ts"))
      return text.includes('"2.0.0"') && !text.includes('"1.0.0"') && /listo/i.test(answer)
    },
  },
  {
    id: "crear-archivo",
    prompt: (dir) => `Creá el archivo ${path.join(dir, "hola.txt")} con exactamente el contenido: hello-bench`,
    check: async (_answer, dir) => (await readText(path.join(dir, "hola.txt"))).trim() === "hello-bench",
  },
  {
    id: "editar-segunda-ocurrencia",
    setup: (dir) => Bun.write(path.join(dir, "dup.txt"), "x = 1\nx = 1\n").then(() => {}),
    prompt: (dir) =>
      `En ${path.join(dir, "dup.txt")} hay dos líneas "x = 1". Cambiá solo la segunda por "x = 2" y dejá la primera igual.`,
    check: async (_answer, dir) => (await readText(path.join(dir, "dup.txt"))) === "x = 1\nx = 2\n",
  },
].filter((task) => !args.tasks || args.tasks.split(",").includes(task.id))

type Task = {
  id: string
  setup?: (dir: string) => Promise<void>
  prompt: (dir: string) => string
  check: (answer: string, dir: string) => boolean | Promise<boolean>
}

const jobs = Array.from({ length: Number(args.reps) }, (_, rep) =>
  tasks.flatMap((task) => variants.map((variant) => ({ rep, task, variant }))),
).flat()

console.log(`target: ${target}`)
console.log(`output: ${out}`)
console.log(`model: ${args.model} · ${jobs.length} runs · expected ${JSON.stringify(expected)}`)
// Observed average was about 0.012 USD per run; 0.015 keeps the estimate on the safe side.
const estimate = jobs.length * 0.015
console.log(`costo estimado ~${estimate.toFixed(2)} USD (tope ${args["max-cost"]} USD)`)
if (estimate > Number(args["max-cost"])) {
  console.error("El costo estimado supera --max-cost. Subí el tope a propósito para confirmar el gasto.")
  process.exit(1)
}
await Promise.all(variants.map((variant) => prepareDataHome(variant.id)))

// Shared by all workers: once a guard trips, no worker starts another run.
const guard = { cost: 0, failures: 0, stop: "" }
const results = (
  await pool(jobs, Number(args.concurrency), async (job, index) => {
    if (guard.stop) return undefined
    const dir = path.join(out, "scratch", `${job.task.id}-${job.variant.id}-${job.rep}`)
    await fs.mkdir(dir, { recursive: true })
    await job.task.setup?.(dir)
    const result = await runJob(job.variant, job.task.prompt(dir))
    const row = {
      variant: job.variant.id,
      task: job.task.id,
      rep: job.rep,
      ...result,
      correct: result.ok && (await job.task.check(result.answer, dir)),
    }
    console.log(
      `[${index + 1}/${jobs.length}] ${row.variant} · ${row.task} · rep ${row.rep}: ` +
        (row.ok ? `${row.promptTokens} prompt tk, ${row.toolCalls} tools, ${row.correct ? "ok" : "WRONG"}` : `FAILED ${row.error}`),
    )
    guard.cost += row.cost
    guard.failures = row.ok ? 0 : guard.failures + 1
    if (guard.cost >= Number(args["max-cost"])) guard.stop = `costo ${guard.cost.toFixed(3)} USD alcanzó el tope`
    if (guard.failures >= Number(args["max-failures"])) guard.stop = `${guard.failures} fallas seguidas. Último error: ${row.error}`
    return row
  })
).filter((row) => row !== undefined)
if (guard.stop) console.error(`Corrida detenida: ${guard.stop}. Los resultados son parciales.`)

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
  // With --format json, errors can be on either stream; take the last line of whichever has one.
  const stdoutMessage = lastLine(stdout).match(/"message":"([^"]+)"/)?.[1]
  const fallback = lastLine(stderr) || stdoutMessage || lastLine(stdout).slice(0, 300) || "error sin detalle"
  if (!sessionID) return { ...emptyUsage(), ok: false, error: fallback, seconds }
  const ok = proc.exitCode === 0
  const error = ok ? "" : ((await providerError(variant.id, sessionID)) ?? fallback)
  return { ...(await readUsage(variant.id, sessionID)), ok, error, seconds }
}

// Exit codes hide the cause; the provider error is only in opencode's log, on lines tagged with the session.
async function providerError(variant: string, sessionID: string) {
  const file = path.join(dataHome(variant), "opencode", "log", "opencode.log")
  if (!(await Bun.file(file).exists())) return undefined
  const line = (await Bun.file(file).text()).split("\n").findLast((l) => l.includes(sessionID) && l.includes("level=ERROR"))
  return line?.match(/error(?:\.error)?="([^"]+)"/)?.[1]
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
    tools: countTools(parts),
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
type MessagePart = { type: string; messageID: string; tool?: string; text?: string; state?: { output?: string } }

// A missing file means the model did not create or edit it: the check fails instead of crashing the batch.
async function readText(file: string) {
  return (await Bun.file(file).exists()) ? Bun.file(file).text() : ""
}

function lastLine(text: string) {
  return text.trim().split("\n").at(-1) ?? ""
}

function countTools(parts: MessagePart[]) {
  return parts
    .flatMap((part) => (part.type === "tool" && part.tool ? [part.tool] : []))
    .reduce<Record<string, number>>((counts, name) => ({ ...counts, [name]: (counts[name] ?? 0) + 1 }), {})
}

function emptyUsage() {
  return {
    sessionID: "",
    steps: 0,
    promptTokens: 0,
    uncachedTokens: 0,
    outputTokens: 0,
    cost: 0,
    toolCalls: 0,
    tools: {} as Record<string, number>,
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
  // Paired per task: the spread between tasks is the noise that matters, not the spread between runs.
  const paired = (variant: string) => {
    const logs = tasks
      .map((task) => Math.log(medians(task.id, variant).promptTokens / medians(task.id, baseline ?? "").promptTokens))
      .filter(Number.isFinite)
    const mean = sum(logs, (v) => v) / logs.length
    const sd = Math.sqrt(sum(logs, (v) => (v - mean) ** 2) / (logs.length - 1))
    return { pct: (Math.exp(mean) - 1) * 100, se: (sd / Math.sqrt(logs.length)) * 100, tasks: logs.length }
  }
  const toolCounts = ids.map((variant) => {
    const counts = rows
      .filter((row) => row.variant === variant && row.ok)
      .reduce<Record<string, number>>((acc, row) => {
        for (const [name, count] of Object.entries(row.tools)) acc[name] = (acc[name] ?? 0) + count
        return acc
      }, {})
    const line = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")
    return `| ${variant} | ${line || "—"} |`
  })
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
    `## Diferencia pareada vs \`${baseline}\``,
    ``,
    `Promedio de la log-razón de prompt tk por tarea (cada tarea pesa igual). ± es el error estándar entre tareas, aproximado en %.`,
    ``,
    `| Variante | Diferencia | ± | Tareas |`,
    `| --- | ---: | ---: | ---: |`,
    ...ids
      .filter((variant) => variant !== baseline)
      .map((variant) => {
        const p = paired(variant)
        return `| ${variant} | ${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(1)}% | ±${p.se.toFixed(1)}% | ${p.tasks} |`
      }),
    ``,
    `## Herramientas por variante (llamadas totales)`,
    ``,
    `| Variante | Llamadas |`,
    `| --- | --- |`,
    ...toolCounts,
    ``,
    `Corridas fallidas: ${rows.filter((row) => !row.ok).length}. Datos crudos en \`results.json\`.`,
    ``,
  ].join("\n")
}

async function computeExpectations() {
  const registry = await Bun.file(path.join(target, "packages/opencode/src/tool/registry.ts")).text()
  const deps = registry.slice(registry.indexOf("export const node")).match(/deps:\s*\[([\s\S]*?)\]/)?.[1] ?? ""
  const tests = Bun.spawnSync(["bun", "test", "test/tool/read.test.ts"], { cwd: path.join(target, "packages/opencode") })
  // Anchored at a fixed commit: a window ending at HEAD moves whenever new commits land during a run.
  const log = Bun.spawnSync(["git", "log", "--oneline", anchor, "-n", "300"], { cwd: target }).stdout.toString().trim()
  const toolDir = path.join(target, "packages/opencode/src/tool")
  const toolFiles = (await fs.readdir(toolDir, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".ts"),
  ).length
  return {
    anchor,
    registryDeps: deps.split("\n").filter((line) => /^\s*[\w.]+,?\s*$/.test(line) && line.trim() !== "").length,
    readTestsPassed: Number(/(\d+) pass/.exec(tests.stderr.toString() + tests.stdout.toString())?.[1] ?? -1),
    oldestCommit: log.split("\n").at(-1)?.split(" ")[0]?.slice(0, 7) ?? "",
    toolFiles,
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
