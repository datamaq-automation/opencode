import { Show, For } from "solid-js"
import { useTelemetry } from "../context/telemetry"
import { useDialog } from "../ui/dialog"

export const DialogTelemetry = () => {
  const telemetry = useTelemetry()
  const { visible } = useDialog("telemetry")

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Show when={visible()}>
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-gray-900 rounded-lg p-6 w-full max-w-2xl max-h-96 overflow-auto">
          <h2 class="text-xl font-bold mb-4 text-cyan-400">Token Telemetry</h2>

          <div class="grid grid-cols-3 gap-4 mb-6">
            <div class="bg-gray-800 p-3 rounded">
              <div class="text-sm text-gray-400">Tools Executed</div>
              <div class="text-2xl font-bold text-green-400">{telemetry.stats().totalTools}</div>
            </div>
            <div class="bg-gray-800 p-3 rounded">
              <div class="text-sm text-gray-400">Tokens Saved</div>
              <div class="text-2xl font-bold text-blue-400">{telemetry.stats().totalTokensSaved}</div>
            </div>
            <div class="bg-gray-800 p-3 rounded">
              <div class="text-sm text-gray-400">Bytes Saved</div>
              <div class="text-2xl font-bold text-purple-400">{formatBytes(telemetry.stats().totalBytesSaved)}</div>
            </div>
          </div>

          <div class="mb-6">
            <h3 class="text-lg font-semibold text-cyan-300 mb-3">By Tool</h3>
            <div class="space-y-2">
              <For each={Array.from(telemetry.stats().byTool.entries())}>
                {([toolName, stats]) => (
                  <div class="flex justify-between items-center p-2 bg-gray-800 rounded text-sm">
                    <div class="flex-1">
                      <span class="font-mono text-green-300">{toolName}</span>
                      <span class="text-gray-400 ml-2">× {stats.count}</span>
                    </div>
                    <div class="flex gap-4 text-right">
                      <div class="w-20">
                        <div class="text-blue-400">{stats.tokensSaved} tk</div>
                        <div class="text-xs text-gray-500">avg {stats.avgTokensSaved}</div>
                      </div>
                      <div class="w-20">
                        <div class="text-purple-400">{formatBytes(stats.bytesSaved)}</div>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold text-cyan-300 mb-3">Recent</h3>
            <div class="space-y-1 text-xs">
              <For each={telemetry.recent().slice(0, 10)}>
                {(tel) => (
                  <div class="flex justify-between p-1 bg-gray-800 rounded font-mono">
                    <span class="text-green-300">{tel.name}</span>
                    <span class="text-blue-400">
                      {tel.tokensSaved} tk ({Math.round((tel.tokensSaved / tel.rawTokens) * 100)}%)
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
