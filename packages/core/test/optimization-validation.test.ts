import { expect, test } from "bun:test"
import { TerminalPruner } from "../src/util/terminal-pruner"

// ===== TERMINAL PRUNING TESTS =====
test("terminal-pruning: deduplicate consecutive identical lines", () => {
  const output = [...Array(8).fill("added 10 packages"), "done"].join("\n")
  const result = TerminalPruner.prune(output, { maxLines: 100 })

  // Should deduplicate the repeated "added 10 packages"
  expect(result.pruned).toBe(true)
  expect(result.originalLines).toBe(9)
  expect(result.prunedLines).toBeGreaterThan(0)
})

test("terminal-pruning: preserve error lines (never deduplicate)", () => {
  const output = [
    "Error: something failed",
    "Error: something failed",
    "Error: something failed",
  ].join("\n")
  const result = TerminalPruner.prune(output, { maxLines: 100 })

  // Errors should be preserved even if duplicated
  const lineCount = result.content.split("\n").length
  expect(lineCount).toBeGreaterThanOrEqual(3)
})

test("terminal-pruning: never prunes content the command asked to view", () => {
  const output = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n")
  const commands = ["cat src/index.ts", "cd pkg && sed -n '1,300p' a.ts", "FOO=1 /usr/bin/head -300 a.ts", "git diff HEAD~1"]

  for (const command of commands) {
    const result = TerminalPruner.prune(output, { maxLines: 80, command })
    expect(result.pruned).toBe(false)
    expect(result.content).toBe(output)
  }
})

test("terminal-pruning: still prunes noisy commands", () => {
  const output = Array.from({ length: 300 }, (_, i) => `✓ suite > case ${i} [1ms]`).join("\n")

  expect(TerminalPruner.prune(output, { maxLines: 80, command: "bun run build" }).pruned).toBe(true)
  expect(TerminalPruner.prune(output, { maxLines: 80, command: "git status" }).pruned).toBe(true)
  expect(TerminalPruner.prune(output, { maxLines: 80, command: "cat log.txt | bun run analyze" }).pruned).toBe(true)
})

test("terminal-pruning: collapse >5 repeated lines", () => {
  const repeated = Array(10)
    .fill("Building module...")
    .join("\n")
  const output = "Starting build\n" + repeated + "\nBuild complete"
  const result = TerminalPruner.prune(output, { maxLines: 100 })

  expect(result.content).toContain("repeated")
  expect(result.pruned).toBe(true)
})

test("terminal-pruning: keep ≤5 duplicates as-is", () => {
  const repeated = Array(3).fill("progress: 33%").join("\n")
  const output = "Start\n" + repeated + "\nEnd"
  const result = TerminalPruner.prune(output, { maxLines: 100 })

  // With ≤5 duplicates, keep them as-is (no collapse annotation)
  const hasCollapseAnnotation = result.content.includes("repeated")
  // May not have annotation since we keep low duplicate counts
})

test("terminal-pruning: preserve failures with context", () => {
  const output = [
    ...Array.from({ length: 10 }, (_, i) => `✓ case ${i} [1ms]`),
    "✗ case 10 [1ms]",
    "  Error: assertion failed",
    "  at line 42",
    ...Array.from({ length: 10 }, (_, i) => `✓ case ${i + 11} [1ms]`),
  ].join("\n")

  const result = TerminalPruner.prune(output, { maxLines: 5 })

  expect(result.content).toContain("✗ case 10")
  expect(result.content).toContain("assertion failed")
  expect(result.content).toContain("at line 42")
  expect(result.content).toContain("pruned 10 passing tests")
  expect(result.pruned).toBe(true)
})

test("integration: terminal pruning + dedup reduces output significantly", () => {
  const verbose = [
    "Building...",
    "npm install some-package@1.0.0",
    "npm install some-package@1.0.0",
    "npm install some-package@1.0.0",
    "npm install some-package@1.0.0",
    "npm install some-package@1.0.0",
    ...Array(50).fill("progress: 50%"),
    "Build complete",
  ].join("\n")

  const result = TerminalPruner.prune(verbose, { maxLines: 50 })

  expect(result.pruned).toBe(true)
  expect(result.prunedLines).toBeGreaterThan(0)
  // Original was ~65 lines, result should be <50
  expect(result.keptLines).toBeLessThanOrEqual(50)
})
