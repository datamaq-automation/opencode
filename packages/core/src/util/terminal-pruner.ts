export * as TerminalPruner from "./terminal-pruner"

export const DEFAULT_MAX_LINES = 80

export interface PruneOptions {
  readonly maxLines?: number
  readonly command?: string
}

export interface PruneResult {
  readonly content: string
  readonly pruned: boolean
  readonly originalLines: number
  readonly keptLines: number
  readonly prunedLines: number
}

const PASS_PATTERNS = [
  /^\s*(?:✓|✔)\s+/,
  /^\s*PASS\s+/,
  /^\s*\[PASS\]/,
  /^\s*.*?\bPASSED\b/,
  /^\s*---\s*PASS:/,
  /^\s*test\s+.*?\.\.\.\s+ok\b/,
  /^\s*ok\s+\d+\s+-/,
]

const FAIL_PATTERNS = [
  /^\s*(?:✕|✗)\s+/,
  /^\s*FAIL\s+/,
  /^\s*\[FAIL\]/,
  /^\s*.*?\bFAILED\b/,
  /^\s*---\s*FAIL:/,
  /^\s*test\s+.*?\.\.\.\s+FAILED\b/,
  /^\s*(?:Error|ERROR|error|AssertionError)(?::|\b)/,
  /^\s*Traceback \(most recent call last\):/,
  /^\s*(?:Expected:|Received:|Diff:)/,
  /^\s*=== FAILURES ===/,
]

const VERBOSE_PATTERNS = [
  /^\s*added \d+ packages/i,
  /^\s*up to date/i,
  /^\s*\[.*?\] Downloaded/i,
  /^\s*Downloading/i,
  /^\s*\d+% progress/i,
]

// Commands whose output is content the model explicitly asked to see, not log noise.
const VIEW_COMMANDS = new Set(["cat", "bat", "batcat", "head", "tail", "nl", "less", "more", "sed", "awk", "jq"])
const VIEW_GIT_SUBCOMMANDS = new Set(["show", "diff", "blame"])

// Judged on the last stage of the command line, since that stage produces the output.
const isViewCommand = (command: string) => {
  const words = (command.split(/&&|\|\||;|\|/).at(-1) ?? "").trim().split(/\s+/)
  // Skip leading environment assignments such as `FOO=1 cat file`.
  const start = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  if (start === -1) return false
  const program = words.at(start)?.split("/").at(-1) ?? ""
  if (program === "git") return VIEW_GIT_SUBCOMMANDS.has(words.at(start + 1) ?? "")
  return VIEW_COMMANDS.has(program)
}

const isPassLine = (line: string) => PASS_PATTERNS.some((pattern) => pattern.test(line))
const isFailLine = (line: string) => FAIL_PATTERNS.some((pattern) => pattern.test(line))
const isVerboseLine = (line: string) => VERBOSE_PATTERNS.some((pattern) => pattern.test(line))

const deduplicateConsecutive = (lines: string[]): string[] => {
  const result: string[] = []
  let lastLine = ""
  let duplicateCount = 0

  for (const line of lines) {
    if (line === lastLine && !isFailLine(line)) {
      duplicateCount++
      continue
    }

    if (duplicateCount > 0 && duplicateCount <= 5) {
      for (let i = 0; i < duplicateCount; i++) {
        result.push(lastLine)
      }
    } else if (duplicateCount > 5) {
      result.push(lastLine)
      result.push(`[... repeated ${duplicateCount - 1} times ...]`)
    }

    duplicateCount = 0
    lastLine = line
    result.push(line)
  }

  if (duplicateCount > 0) {
    if (duplicateCount <= 5) {
      for (let i = 0; i < duplicateCount; i++) {
        result.push(lastLine)
      }
    } else {
      result.push(lastLine)
      result.push(`[... repeated ${duplicateCount - 1} times ...]`)
    }
  }

  return result
}

export const prune = (output: string, options?: PruneOptions): PruneResult => {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES
  const lines = output.split("\n")
  if (options?.command && isViewCommand(options.command)) {
    return { content: output, pruned: false, originalLines: lines.length, keptLines: lines.length, prunedLines: 0 }
  }

  // Deduplicate consecutive lines (except error lines)
  const dedupedLines = deduplicateConsecutive(lines)
  // Only test-runner and installer noise is collapsed. Cutting generic output made models re-run commands to
  // see the missing part, which cost far more than it saved; plain truncation still happens in the shell tool.
  const kept = dedupedLines.length <= maxLines ? dedupedLines : collapseNoise(dedupedLines)
  return {
    content: kept.join("\n"),
    pruned: kept.length < lines.length,
    originalLines: lines.length,
    keptLines: kept.length,
    prunedLines: Math.max(0, lines.length - kept.length),
  }
}

// Replaces runs of three or more passing-test or progress lines with one marker; failures and all other lines stay.
function collapseNoise(lines: string[]) {
  const state = { kept: new Array<string>(), pending: new Array<string>() }
  const flush = () => {
    state.kept.push(
      ...(state.pending.length >= 3
        ? [`[... pruned ${state.pending.length} passing tests / progress lines ...]`]
        : state.pending),
    )
    state.pending = []
  }
  lines.forEach((line) => {
    if (isPassLine(line) || isVerboseLine(line)) {
      state.pending.push(line)
      return
    }
    flush()
    state.kept.push(line)
  })
  flush()
  return state.kept
}
