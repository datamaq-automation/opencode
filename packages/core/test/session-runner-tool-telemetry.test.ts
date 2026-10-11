import { expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"
import { Token } from "@opencode-ai/core/util/token"

const sessionID = SessionV2.ID.make("ses_telemetry_test")

const capture = () => {
  const published: Array<{ readonly type: string; readonly data: unknown }> = []
  const events = EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        const event = { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
        published.push({
          type: definition.durable
            ? EventV2.versionedType(definition.type, definition.durable.version)
            : definition.type,
          data,
        })
        return event
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
  return {
    published,
    publisher: createLLMEventPublisher(events, {
      sessionID,
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
      },
    }),
  }
}

test("publishes telemetry on tool success with token metrics", async () => {
  const { published, publisher } = capture()
  const largeOutput = "This is a test output. ".repeat(100) // ~2300 chars ≈ 575 tokens

  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolCall({
        id: "call-test",
        name: "read",
        input: { path: "file.txt" },
      })
    )
  )

  // Simulate raw (unpruned) output much larger than the pruned version
  const prunedOutput = largeOutput.slice(0, 100)
  const rawBytes = Buffer.byteLength(largeOutput, "utf-8")
  const rawTokens = Token.estimate(largeOutput)

  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: "call-test",
        name: "read",
        result: {
          type: "content",
          value: [{ type: "text", text: prunedOutput }],
        },
        output: {
          structured: { type: "text" },
          content: [{ type: "text", text: prunedOutput }],
        },
        metadata: { rawBytes, rawTokens },
      })
    )
  )

  const telemetry = published.find((event) => event.type === "session.next.tool.telemetry.1")
  expect(telemetry).toBeDefined()
  expect(telemetry?.data).toMatchObject({
    callID: "call-test",
    name: "read",
  })

  const tel = (telemetry?.data as any).telemetry
  expect(tel).toBeDefined()
  expect(tel).toEqual({
    rawBytes,
    prunedBytes: Buffer.byteLength(prunedOutput, "utf-8"),
    rawTokens,
    tokensSaved: rawTokens - Token.estimate(prunedOutput),
  })
})

// Unpruned output must report nothing saved, whatever its length or encoding: 9 characters is where
// rounding chars and ceiling bytes disagree, and non-ASCII text has more bytes than characters.
for (const output of ["Short tex", "Configuración del túnel: ñandú → ok"]) {
  test(`calculates zero tokens saved when no pruning occurs: ${output}`, async () => {
    const { published, publisher } = capture()

    await Effect.runPromise(
      publisher.publish(
        LLMEvent.toolCall({
          id: "call-short",
          name: "read",
          input: { path: "file.txt" },
        }),
      ),
    )

    await Effect.runPromise(
      publisher.publish(
        LLMEvent.toolResult({
          id: "call-short",
          name: "read",
          result: {
            type: "content",
            value: [{ type: "text", text: output }],
          },
          output: {
            structured: { type: "text" },
            content: [{ type: "text", text: output }],
          },
        }),
      ),
    )

    const telemetry = published.find((event) => event.type === "session.next.tool.telemetry.1")
    expect(telemetry).toBeDefined()

    const tel = (telemetry?.data as any).telemetry
    expect(tel.rawBytes).toBe(tel.prunedBytes)
    expect(tel.rawTokens).toBe(Token.estimate(output))
    expect(tel.tokensSaved).toBe(0)
  })
}

test("handles multiple tool invocations with separate telemetry", async () => {
  const { published, publisher } = capture()

  // First tool call
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolCall({
        id: "call-1",
        name: "read",
        input: { path: "file1.txt" },
      })
    )
  )

  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: "call-1",
        name: "read",
        result: {
          type: "content",
          value: [{ type: "text", text: "Output 1" }],
        },
        output: {
          structured: { type: "text" },
          content: [{ type: "text", text: "Output 1" }],
        },
      })
    )
  )

  // Second tool call
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolCall({
        id: "call-2",
        name: "bash",
        input: { command: "ls" },
      })
    )
  )

  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: "call-2",
        name: "bash",
        result: {
          type: "content",
          value: [{ type: "text", text: "Output 2" }],
        },
        output: {
          structured: { type: "text" },
          content: [{ type: "text", text: "Output 2" }],
        },
      })
    )
  )

  const telemetries = published.filter((event) => event.type === "session.next.tool.telemetry.1")
  expect(telemetries).toHaveLength(2)

  const tel1 = (telemetries[0]?.data as any)
  const tel2 = (telemetries[1]?.data as any)

  expect(tel1.callID).toBe("call-1")
  expect(tel1.name).toBe("read")
  expect(tel2.callID).toBe("call-2")
  expect(tel2.name).toBe("bash")
})
