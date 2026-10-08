# Optimization Validation

Estado de verificación de las optimizaciones de herramientas. Para el catálogo completo, ver [OPTIMIZATIONS.md](OPTIMIZATIONS.md). Para el procedimiento de medición manual, ver [BENCHMARK-SESSION.md](BENCHMARK-SESSION.md).

## Verificado

| Optimización | Cómo se verificó | Estado |
|---|---|---|
| Skeleton opt-in en `read` (legacy y Core V2) | `view: "skeleton"` aplica el skeleton; sin `view` devuelve el contenido completo, incluso en archivos > 800 líneas | Validado |
| Telemetría en `/telemetry` (TUI, v1) | Tests de `session-runner-tool-telemetry` y prueba manual: `read` con skeleton reporta ahorro > 0 | Validado |
| Poda de output de `bash` (solo ruido) | Tests de `terminal-pruner` con salida sintética | Validado en tests; no verificado con salida real de instalación |
| Compactación de diffs (`compactLargeDiff`) | `packages/opencode/test/tool/compact-diff.test.ts` | Validado en tests; no se trazó si el diff compactado llega al modelo |

## No verificado

- **Validación sintáctica en `edit`/`write`/`apply_patch`:** hay tests unitarios del validador, pero no de rechazo a través de las herramientas.
- **Ahorro real de tokens por la compactación de diffs:** el A/B actual no edita archivos.
- **Ahorro de la poda con output real de `npm install`, `pytest`, `cargo` o `go test`.**

## Historial

- 2026-10-06: el A/B end-to-end (`bun run bench:ab`) mostró +20% de tokens con el auto-skeleton y la poda genérica. Se retiraron ambos, y el skeleton quedó opt-in.
- 2026-10-06: el mismo A/B después de los cambios dio +0.9% de tokens frente a upstream, dentro del ruido.
