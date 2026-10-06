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

const isPassLine = (line: string) => PASS_PATTERNS.some((pattern) => pattern.test(line))
const isFailLine = (line: string) => FAIL_PATTERNS.some((pattern) => pattern.test(line))
const isVerboseLine = (line: string) => VERBOSE_PATTERNS.some((pattern) => pattern.test(line))

const deduplicateConsecutive = (lines: string[]): { lines: string[]; deduped: number } => {
  const result: string[] = []
  let deduped = 0
  let lastLine = ""
  let duplicateCount = 0

  for (const line of lines) {
    if (line === lastLine && !isFailLine(line)) {
      duplicateCount++
      deduped++
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

  return { lines: result, deduped }
}

export const prune = (output: string, options?: PruneOptions): PruneResult => {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES
  const lines = output.split("\n")

  // Deduplicate consecutive lines (except error lines)
  const { lines: dedupedLines, deduped: dedupedCount } = deduplicateConsecutive(lines)

  if (dedupedLines.length <= maxLines) {
    return {
      content: dedupedLines.join("\n"),
      pruned: dedupedCount > 0,
      originalLines: lines.length,
      keptLines: dedupedLines.length,
      prunedLines: dedupedCount,
    }
  }

  const failIndices = dedupedLines.reduce<number[]>((acc, line, idx) => {
    if (isFailLine(line)) acc.push(idx)
    return acc
  }, [])

  // If failures exist, keep header, failure contexts, and summary footer
  if (failIndices.length > 0) {
    const keepMask = new Array<boolean>(dedupedLines.length).fill(false)

    // Keep top 6 lines (test suite invocation / environment header)
    const headerLines = Math.min(dedupedLines.length, 6)
    for (let i = 0; i < headerLines; i++) keepMask[i] = true

    // Keep bottom 10 lines (test summary / timing)
    const footerStart = Math.max(0, dedupedLines.length - 10)
    for (let i = footerStart; i < dedupedLines.length; i++) keepMask[i] = true

    // For each failure, keep 2 lines before and 16 lines after (capturing stack traces/diffs)
    failIndices.forEach((failIdx) => {
      const start = Math.max(0, failIdx - 2)
      const end = Math.min(dedupedLines.length, failIdx + 16)
      for (let i = start; i < end; i++) keepMask[i] = true
    })

    const resultLines: string[] = []
    let inPrunedGap = false
    let currentGapCount = 0

    dedupedLines.forEach((line, idx) => {
      if (keepMask[idx]) {
        if (inPrunedGap) {
          resultLines.push(
            `[... pruned ${currentGapCount} passing tests / verbose lines on local CPU (deduplicated) ...]`,
          )
          inPrunedGap = false
          currentGapCount = 0
        }
        resultLines.push(line)
        return
      }

      inPrunedGap = true
      currentGapCount++
    })

    if (inPrunedGap) {
      resultLines.push(
        `[... pruned ${currentGapCount} passing tests / verbose lines on local CPU (deduplicated) ...]`,
      )
    }

    return {
      content: resultLines.join("\n"),
      pruned: true,
      originalLines: lines.length,
      keptLines: resultLines.length,
      prunedLines: lines.length - resultLines.length + dedupedCount,
    }
  }

  // No specific failure pattern found: keep head and tail of generic large output
  const headCount = Math.floor(maxLines * 0.45)
  const tailCount = Math.floor(maxLines * 0.45)
  const skippedCount = dedupedLines.length - (headCount + tailCount)

  if (skippedCount <= 0) {
    return {
      content: dedupedLines.join("\n"),
      pruned: dedupedCount > 0,
      originalLines: lines.length,
      keptLines: dedupedLines.length,
      prunedLines: dedupedCount,
    }
  }

  const resultLines = [
    ...dedupedLines.slice(0, headCount),
    `[... pruned ${skippedCount} lines on local CPU (deduplicated) ...]`,
    ...dedupedLines.slice(dedupedLines.length - tailCount),
  ]

  return {
    content: resultLines.join("\n"),
    pruned: true,
    originalLines: lines.length,
    keptLines: resultLines.length,
    prunedLines: lines.length - resultLines.length,
  }
}
