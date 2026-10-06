import { createContext, useContext, createSignal, createEffect, onCleanup } from "solid-js"
import type { SessionEvent } from "@opencode-ai/core/session/event"
import { useEvent } from "./event"

export interface ToolTelemetry {
  readonly callID: string
  readonly name: string
  readonly rawBytes: number
  readonly prunedBytes: number
  readonly rawTokens: number
  readonly tokensSaved: number
  readonly timestamp: number
}

export interface TelemetryStats {
  readonly totalTools: number
  readonly totalTokensSaved: number
  readonly totalBytesSaved: number
  readonly byTool: Map<string, {
    readonly count: number
    readonly tokensSaved: number
    readonly bytesSaved: number
    readonly avgTokensSaved: number
  }>
  readonly recent: ReadonlyArray<ToolTelemetry>
}

interface TelemetryContext {
  readonly stats: () => TelemetryStats
  readonly recent: () => ReadonlyArray<ToolTelemetry>
}

const TelemetryContextValue = createContext<TelemetryContext>()

export const TelemetryProvider = (props: { children: any }) => {
  const [telemetries, setTelemetries] = createSignal<ToolTelemetry[]>([])
  const event = useEvent()

  createEffect(() => {
    const unsubscribe = event.subscribe((evt: any) => {
      if (evt.type === "session.next.tool.telemetry" || evt.type === "session.next.tool.telemetry.1") {
        const data = evt
        const tel: ToolTelemetry = {
          callID: data.callID,
          name: data.name,
          rawBytes: data.telemetry?.rawBytes || 0,
          prunedBytes: data.telemetry?.prunedBytes || 0,
          rawTokens: data.telemetry?.rawTokens || 0,
          tokensSaved: data.telemetry?.tokensSaved || 0,
          timestamp: Date.now(),
        }
        setTelemetries((prev) => [tel, ...prev.slice(0, 49)])
      }
    })
    onCleanup(() => unsubscribe())
  })

  const stats = () => {
    const tels = telemetries()
    const byTool = new Map<string, {
      count: number
      tokensSaved: number
      bytesSaved: number
    }>()

    for (const tel of tels) {
      const key = tel.name
      const existing = byTool.get(key) || { count: 0, tokensSaved: 0, bytesSaved: 0 }
      byTool.set(key, {
        count: existing.count + 1,
        tokensSaved: existing.tokensSaved + tel.tokensSaved,
        bytesSaved: existing.bytesSaved + (tel.rawBytes - tel.prunedBytes),
      })
    }

    const toolStats = new Map(
      Array.from(byTool.entries()).map(([name, data]) => [
        name,
        {
          count: data.count,
          tokensSaved: data.tokensSaved,
          bytesSaved: data.bytesSaved,
          avgTokensSaved: data.count > 0 ? Math.round(data.tokensSaved / data.count) : 0,
        },
      ])
    )

    const totalTokensSaved = Array.from(byTool.values()).reduce((sum, t) => sum + t.tokensSaved, 0)
    const totalBytesSaved = Array.from(byTool.values()).reduce((sum, t) => sum + t.bytesSaved, 0)

    return {
      totalTools: tels.length,
      totalTokensSaved,
      totalBytesSaved,
      byTool: toolStats,
      recent: tels,
    }
  }

  return (
    <TelemetryContextValue.Provider value={{ stats, recent: telemetries }}>
      {props.children}
    </TelemetryContextValue.Provider>
  )
}

export const useTelemetry = (): TelemetryContext => {
  const ctx = useContext(TelemetryContextValue)
  if (!ctx) throw new Error("useTelemetry must be used within TelemetryProvider")
  return ctx
}
