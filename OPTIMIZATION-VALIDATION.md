# Optimization Validation

Estado de verificación de las optimizaciones de herramientas. Para el catálogo completo, ver [OPTIMIZATIONS.md](OPTIMIZATIONS.md). Para el procedimiento de medición manual, ver [BENCHMARK-SESSION.md](BENCHMARK-SESSION.md).

## Verificado

| Optimización | Cómo se verificó | Estado |
|---|---|---|
| Skeleton opt-in en `read` (legacy y Core V2) | `view: "skeleton"` aplica el skeleton; sin `view` devuelve el contenido completo, incluso en archivos > 800 líneas | Validado |
| Telemetría en `/telemetry` (TUI, v1) | `packages/tui/test/context/telemetry.test.ts` cubre `savings()`; prueba manual: `read` con skeleton reporta ahorro > 0 | Validado |
| Poda de output de `bash` (solo ruido) | `packages/core/test/terminal-pruner.test.ts` con salida sintética y con dos fixtures reales (`test/fixtures/terminal-pruner/`) | `pytest -v` real: colapsa 120 líneas `PASSED` y conserva la falla, el traceback y el resumen. `bun test` real: queda entero, porque bun sin TTY solo imprime las fallas. `npm install` real da 7 líneas, nada que podar |
| Validación sintáctica en `edit`/`write`/`apply_patch` | Tests a través de cada herramienta (`packages/opencode/test/tool/`) | Rechaza el cambio si rompe un archivo válido y deja el archivo intacto; `write` permite sobrescribir un archivo que ya era inválido |
| Compactación de diffs (`compactLargeDiff`, ahora en `packages/core/src/util/diff.ts`) | `packages/core/test/diff.test.ts` | Solo de visualización: el diff completo se guarda y va a los prompts de permisos; el TUI y el CLI truncan los bloques inline. **No ahorra tokens del modelo**: el modelo recibe `part.state.output` (`packages/opencode/src/session/message-v2.ts:305`). Verificado por lectura de código. |

## No verificado

- **Ahorro de tokens atribuible a cualquier optimización:** el A/B no tiene poder estadístico suficiente (ver `BENCHMARK-SESSION.md`).
- **Ahorro de la poda con output real de `cargo` o `go test`:** no están instalados en esta máquina.
- **Telemetría V2 de punta a punta:** `tool-bash.test.ts` verifica que la telemetría sale del registry y `session-runner-tool-telemetry.test.ts` que el publicador la usa; no hay un test que recorra el runner completo hasta el evento.

## Tests que fallan en el código original (preexistentes)

Verificados ejecutando los archivos con y sin los cambios de la rama. Fallan igual en ambos casos; no son regresiones de esta rama.

- `packages/opencode/test/tool/write.test.ts` › "sets file permissions when writing sensitive data": espera modo `0o644`. Causa no investigada.
- `packages/core`: `session-runner.test.ts` (2 tests de `SessionRunnerLLM`), `location-layer.test.ts` › "isolates location state…" y `project-copy.test.ts` › "requires force to remove a dirty git worktree". Fallan igual con y sin los cambios de telemetría. `process.test.ts` › "fiber interruption cleans up…" falla a veces con la suite completa y pasa sola.

## Historial

- 2026-10-08: la telemetría V2 recibe `rawBytes` y `rawTokens` de las herramientas que podan (`toTelemetry`). Antes no llegaban y el evento reportaba ahorro falso sin poda.
- 2026-10-08: los dos tests de sintaxis de `edit` que fallaban esperaban el comportamiento anterior a `d67bd565e5` (escribir y reportar). Ahora verifican el rechazo. Los layers de test de `write` y `apply_patch` no incluían `SyntaxValidator`, así que la validación no se ejecutaba en sus tests.
- 2026-10-08: el diff completo se guarda en metadata; el truncado ocurre solo al renderizar (TUI y CLI). `write` envía el diff completo al permiso. Ver `packages/core/src/util/diff.ts`.
- 2026-10-08: el benchmark de 72 corridas (`baseline-v3`) quedó sin medición válida por saldo agotado del proveedor. Ver `BENCHMARK-SESSION.md`.

- 2026-10-06: el A/B end-to-end (`bun run bench:ab`) mostró +20% de tokens con el auto-skeleton y la poda genérica. Se retiraron ambos, y el skeleton quedó opt-in.
- 2026-10-06: el mismo A/B después de los cambios dio +0.9% de tokens frente a upstream, dentro del ruido.
