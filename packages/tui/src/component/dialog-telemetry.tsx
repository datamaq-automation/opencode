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
      <box flexDirection="row" gap={2} flexGrow={1} minWidth={0}>
        <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
          <text fg={theme.textMuted}>Tools Executed</text>
          <text fg={theme.text}>{telemetry.stats().totalTools}</text>
        </box>
        <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
          <text fg={theme.textMuted}>Tokens Saved</text>
          <text fg={theme.text}>{telemetry.stats().totalTokensSaved}</text>
        </box>
        <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
          <text fg={theme.textMuted}>Bytes Saved</text>
          <text fg={theme.text}>{formatBytes(telemetry.stats().totalBytesSaved)}</text>
        </box>
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
