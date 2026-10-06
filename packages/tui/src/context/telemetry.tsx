import { createMemo } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useSync } from "./sync"

type ToolStats = {
  count: number
  tokensSaved: number
  bytesSaved: number
}

// Stats are derived from the open session's completed tool parts, whose metadata.telemetry the
// server persists, so they survive restarts and need no separate event stream.
export const { use: useTelemetry, provider: TelemetryProvider } = createSimpleContext({
  name: "Telemetry",
  init: () => {
    const sync = useSync()
    const route = useRoute()
    const stats = createMemo(() => {
      const messages = route.data.type === "session" ? (sync.data.message[route.data.sessionID] ?? []) : []
      const saved = messages
        .flatMap((message) => sync.data.part[message.id] ?? [])
        .flatMap((part) => savings(part) ?? [])
      return {
        totalTools: saved.length,
        totalTokensSaved: saved.reduce((sum, item) => sum + item.tokensSaved, 0),
        totalBytesSaved: saved.reduce((sum, item) => sum + item.bytesSaved, 0),
        byTool: saved.reduce((byTool, item) => {
          const prev = byTool.get(item.tool) ?? { count: 0, tokensSaved: 0, bytesSaved: 0 }
          return byTool.set(item.tool, {
            count: prev.count + 1,
            tokensSaved: prev.tokensSaved + item.tokensSaved,
            bytesSaved: prev.bytesSaved + item.bytesSaved,
          })
        }, new Map<string, ToolStats>()),
      }
    })
    return { stats }
  },
})

function savings(part: Part) {
  if (part.type !== "tool" || part.state.status !== "completed") return
  const telemetry = part.state.metadata.telemetry
  if (!isRecord(telemetry)) return
  // rawTokens/rawBytes are only present when a tool pruned its output; otherwise nothing was saved.
  const tokens = num(telemetry.estimatedTokens) ?? 0
  const bytes = num(telemetry.bytes) ?? 0
  return {
    tool: part.tool,
    tokensSaved: Math.max(0, (num(telemetry.rawTokens) ?? tokens) - tokens),
    bytesSaved: Math.max(0, (num(telemetry.rawBytes) ?? bytes) - bytes),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function num(value: unknown) {
  return typeof value === "number" ? value : undefined
}
