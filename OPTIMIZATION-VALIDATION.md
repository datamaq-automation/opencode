# Optimization Validation

Estado de verificación de las optimizaciones de herramientas. Para el catálogo completo, ver [OPTIMIZATIONS.md](OPTIMIZATIONS.md). Para el procedimiento de medición manual, ver [BENCHMARK-SESSION.md](BENCHMARK-SESSION.md).

## Verificado

| Optimización | Cómo se verificó | Estado |
|---|---|---|
| Skeleton opt-in en `read` (legacy y Core V2) | `view: "skeleton"` aplica el skeleton; sin `view` devuelve el contenido completo, incluso en archivos > 800 líneas | Validado |
| Telemetría en `/telemetry` (TUI, v1) | Tests de `session-runner-tool-telemetry` y prueba manual: `read` con skeleton reporta ahorro > 0 | Validado |
| Poda de output de `bash` (solo ruido) | Tests de `terminal-pruner` con salida sintética | Validado en tests; no verificado con salida real de instalación |
| Compactación de diffs (`compactLargeDiff`, ahora en `packages/core/src/util/diff.ts`) | `packages/core/test/diff.test.ts` | Solo de visualización: el diff completo se guarda y va a los prompts de permisos; el TUI y el CLI truncan los bloques inline. **No ahorra tokens del modelo**: el modelo recibe `part.state.output` (`packages/opencode/src/session/message-v2.ts:305`). Verificado por lectura de código. |

## No verificado

- **Validación sintáctica en `edit`/`write`/`apply_patch`:** hay tests unitarios del validador, pero no de rechazo a través de las herramientas.
- **Ahorro de tokens atribuible a cualquier optimización:** el A/B no tiene poder estadístico suficiente (ver `BENCHMARK-SESSION.md`).
- **Ahorro de la poda con output real de `npm install`, `pytest`, `cargo` o `go test`.**

## Tests que fallan en el código original (preexistentes)

Verificados ejecutando los archivos con y sin los cambios de la rama. Fallan igual en ambos casos; no son regresiones de esta rama.

- `packages/opencode/test/tool/write.test.ts` › "sets file permissions when writing sensitive data": espera modo `0o644`. Causa no investigada.
- `packages/opencode/test/tool/edit.test.ts` › "detects syntax errors in edited TypeScript file" y "… Python file": causa no investigada. El error que se ve en el log es el de validación sintáctica, pero no revisé qué espera el test exactamente.

## Historial

- 2026-10-08: el diff completo se guarda en metadata; el truncado ocurre solo al renderizar (TUI y CLI). `write` envía el diff completo al permiso. Ver `packages/core/src/util/diff.ts`.
- 2026-10-08: el benchmark de 72 corridas (`baseline-v3`) quedó sin medición válida por saldo agotado del proveedor. Ver `BENCHMARK-SESSION.md`.

- 2026-10-06: el A/B end-to-end (`bun run bench:ab`) mostró +20% de tokens con el auto-skeleton y la poda genérica. Se retiraron ambos, y el skeleton quedó opt-in.
- 2026-10-06: el mismo A/B después de los cambios dio +0.9% de tokens frente a upstream, dentro del ruido.
