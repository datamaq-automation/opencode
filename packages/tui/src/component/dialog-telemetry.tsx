import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTelemetry } from "../context/telemetry"
import { useTheme } from "../context/theme"

export const DialogTelemetry = () => {
  const telemetry = useTelemetry()
  const { theme } = useTheme()

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        Token Telemetry
      </text>
      <box flexDirection="column">
        <text fg={theme.textMuted}>Tools Executed: {telemetry.stats().totalTools}</text>
        <text fg={theme.textMuted}>Tokens Saved (est.): {telemetry.stats().totalTokensSaved}</text>
        <text fg={theme.textMuted}>Bytes Saved: {formatBytes(telemetry.stats().totalBytesSaved)}</text>
      </box>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        By Tool
      </text>
      <For each={Array.from(telemetry.stats().byTool.entries())}>
        {([toolName, stats]) => (
          <text fg={theme.text}>
            {toolName}: {stats.count}x, {stats.tokensSaved}tk saved ({formatBytes(stats.bytesSaved)})
          </text>
        )}
      </For>
    </box>
  )
}
