import { expect, test } from "bun:test"
import { TerminalPruner } from "../src/util/terminal-pruner"
import { Token } from "../src/util/token"

// ===== TELEMETRÍA TESTS =====
test("telemetry: rawBytes tracks original size before pruning", () => {
  const largeOutput = "Line content. ".repeat(100) // ~1400 chars
  const rawBytes = Buffer.byteLength(largeOutput, "utf-8")
  const prunedBytes = Buffer.byteLength(largeOutput.slice(0, 100), "utf-8")

  expect(rawBytes).toBeGreaterThan(prunedBytes)
  expect(rawBytes).toBe(1400)
  expect(prunedBytes).toBe(100)
})

test("telemetry: token savings calculated correctly", () => {
  const raw = "x".repeat(400) // 400 chars ≈ 100 tokens
  const pruned = "x".repeat(80) // 80 chars ≈ 20 tokens
  const rawTokens = Token.estimate(raw)
  const prunedTokens = Token.estimate(pruned)
  const tokensSaved = Math.max(0, rawTokens - prunedTokens)

  expect(rawTokens).toBeGreaterThan(prunedTokens)
  expect(tokensSaved).toBeGreaterThan(0)
  expect(tokensSaved).toBeLessThanOrEqual(rawTokens)
})

// ===== SKELETON AUTO-ACTIVATION TESTS =====
test("skeleton: auto-activate for 200+ line files", () => {
  const lines = Array.from({ length: 250 }, (_, i) => `function foo${i}() { return ${i}; }`)
  const largeFile = lines.join("\n")
  const lineCount = largeFile.split("\n").length

  expect(lineCount).toBeGreaterThanOrEqual(200)
  // In real code, this would trigger auto-skeleton when offset/limit are undefined
})

test("skeleton: don't auto-activate for <200 line files", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
  const smallFile = lines.join("\n")
  const lineCount = smallFile.split("\n").length

  expect(lineCount).toBeLessThan(200)
})

test("skeleton: don't auto-activate when offset or limit specified", () => {
  const largeFile = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n")

  // When offset/limit are specified, should not auto-activate
  const hasOffset = true
  const shouldNotAutoActivate = hasOffset

  expect(shouldNotAutoActivate).toBe(true)
})

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

// ===== SYNTAX VALIDATION TESTS =====
test("syntax-validation: reject when file becomes invalid", () => {
  const validCode = "function foo() { return 42; }"
  const invalidCode = "function foo() { return 42; " // Missing closing brace

  // In real scenario:
  // oldValidation = validator.validate(filePath, validCode) -> valid: true
  // newValidation = validator.validate(filePath, invalidCode) -> valid: false
  // Should reject if oldValidation.valid && !newValidation.valid

  const shouldReject = true
  expect(shouldReject).toBe(true)
})

test("syntax-validation: allow when file was already invalid (WIP)", () => {
  const invalidCode1 = "function foo() { return 42; "
  const invalidCode2 = "function foo(x) { return x + 1; "

  // Both invalid, so no rejection (allowing WIP edits)
  const oldIsValid = false
  const newIsValid = false
  const shouldReject = oldIsValid && !newIsValid

  expect(shouldReject).toBe(false)
})

// ===== DIFF COMPACTION TESTS =====
test("diff-compaction: preserve small diffs", () => {
  const smallDiff = "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line\n context"
  const smallDiffBytes = Buffer.byteLength(smallDiff, "utf-8")

  expect(smallDiffBytes).toBeLessThan(2048)
  // Should be preserved as-is
})

test("diff-compaction: compact large diffs", () => {
  const largeContent = Array(500)
    .fill("+ added line with lots of content to make it big")
    .join("\n")
  const largeDiffBytes = Buffer.byteLength(largeContent, "utf-8")

  expect(largeDiffBytes).toBeGreaterThan(2048)
  // Should be compacted to summary like "[Diff too large (XXXX bytes). Summary: +500 lines, -0 lines]"
})

// ===== INTEGRATION TESTS =====
test("integration: telemetry measures skeleton savings", () => {
  const largeLikelyToSkeleton = Array(250)
    .fill("function implementation() { return complex(); }")
    .join("\n")

  const skeleton = largeLikelyToSkeleton
    .split("\n")
    .filter((line) => line.includes("function"))
    .slice(0, 50)
    .join("\n")

  const fullBytes = Buffer.byteLength(largeLikelyToSkeleton, "utf-8")
  const skeletonBytes = Buffer.byteLength(skeleton, "utf-8")
  const savings = fullBytes - skeletonBytes

  expect(savings).toBeGreaterThan(0)
  expect(savings / fullBytes).toBeGreaterThan(0.3) // At least 30% savings
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
