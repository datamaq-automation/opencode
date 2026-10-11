import { describe, expect, test } from "bun:test"
import { compactLargeDiff } from "../src/util/diff"

describe("compactLargeDiff", () => {
  test("keeps diffs at or under 2048 bytes unchanged", () => {
    const diff = "--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line\n context"
    expect(compactLargeDiff(diff)).toBe(diff)
  })

  test("summarizes diffs over 2048 bytes with addition and deletion counts", () => {
    const added = Array.from({ length: 300 }, () => "+ added line with enough content to exceed the limit").join("\n")
    const removed = Array.from({ length: 5 }, () => "- removed").join("\n")
    const diff = `${added}\n${removed}`
    const bytes = Buffer.byteLength(diff, "utf-8")

    expect(bytes).toBeGreaterThan(2048)
    expect(compactLargeDiff(diff)).toBe(`[Diff too large (${bytes} bytes). Summary: +300 lines, -5 lines]`)
  })
})
