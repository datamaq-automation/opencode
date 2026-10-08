const MAX_DIFF_BYTES = 2048

// Display-only: the full diff is stored and sent to permission prompts; renderers call this to keep inline diffs short.
export function compactLargeDiff(diff: string): string {
  if (Buffer.byteLength(diff, "utf-8") <= MAX_DIFF_BYTES) {
    return diff
  }
  const lines = diff.split("\n")
  const additions = lines.filter((l) => l.startsWith("+")).length
  const deletions = lines.filter((l) => l.startsWith("-")).length
  return `[Diff too large (${Buffer.byteLength(diff, "utf-8")} bytes). Summary: +${additions} lines, -${deletions} lines]`
}
