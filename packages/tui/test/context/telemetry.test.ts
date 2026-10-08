import { expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { savings } from "../../src/context/telemetry"

const completed = (metadata: Record<string, unknown>): Part => ({
  id: "prt_1",
  sessionID: "ses_1",
  messageID: "msg_1",
  type: "tool",
  callID: "call_1",
  tool: "bash",
  state: {
    status: "completed",
    input: {},
    output: "",
    title: "",
    metadata,
    time: { start: 0, end: 1 },
  },
})

test("ignores parts that are not completed tool calls", () => {
  expect(savings({ id: "prt_1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hi" })).toBeUndefined()
  expect(
    savings({
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "running", input: {}, time: { start: 0 } },
    }),
  ).toBeUndefined()
  expect(savings(completed({}))).toBeUndefined()
})

test("reports nothing saved when the tool did not prune", () => {
  expect(savings(completed({ telemetry: { estimatedTokens: 50, bytes: 200 } }))).toEqual({
    tool: "bash",
    tokensSaved: 0,
    bytesSaved: 0,
  })
})

test("reports the difference between raw and sent output", () => {
  expect(
    savings(completed({ telemetry: { estimatedTokens: 50, bytes: 200, rawTokens: 500, rawBytes: 2000 } })),
  ).toEqual({ tool: "bash", tokensSaved: 450, bytesSaved: 1800 })
})

test("never reports negative savings", () => {
  expect(
    savings(completed({ telemetry: { estimatedTokens: 50, bytes: 200, rawTokens: 40, rawBytes: 100 } })),
  ).toEqual({ tool: "bash", tokensSaved: 0, bytesSaved: 0 })
})

test("ignores non-numeric metrics", () => {
  expect(
    savings(completed({ telemetry: { estimatedTokens: "50", bytes: 200, rawTokens: "500", rawBytes: 2000 } })),
  ).toEqual({ tool: "bash", tokensSaved: 0, bytesSaved: 1800 })
})
