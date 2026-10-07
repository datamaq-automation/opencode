# Optimization Benchmark Session Guide

> **Estado (2026-10-07): VALIDADO ✓** 
> 
> A/B benchmark completo ejecutado 2026-10-06 (`packages/opencode/script/bench-ab.ts`) mostró que:
> - Skeleton automático + poda genérica causaban +20% tokens (pasos extra de modelo)
> - **Solución implementada**: Skeleton ahora es opt-in (view="skeleton"), poda solo colapsa noise (tests/installer)
> - **Resultado**: Rerun 2026-10-06 post-fixes: +0.9% tokens (vs upstream +0% noise)
> - **Conclusión**: Optimizaciones validadas. Pronto a Phase 2 (LSP cache).

**Objetivo**: Documentar las optimizaciones validadas en sesiones reales y su impacto medido.

**Validación**: Completada 2026-10-06  
**Pasos**: 3 validaciones clave (skeleton opt-in, pruning selectivo, telemetría TUI)

---

## Validación Manual (Post-Optimization)

### Step 1: Skeleton Opt-In Mode
**Esperado**: Skeleton solo activa con `view="skeleton"`, sin re-reads involuntarias

```
1. Ejecutar sesión
2. /read packages/opencode/src/tool/shell.ts (300+ líneas)
3. Comando: /telemetry
4. Revisar:
   - Tools Executed: should see "read"
   - Tokens Saved: should be ~0 (sin skeleton auto)
5. Repetir con: /read packages/opencode/src/tool/shell.ts view=skeleton
6. Revisar:
   - Tokens Saved: should be > 0 (skeleton enabled)
```

**Validación:**
- [x] Skeleton NO activa automáticamente (fix 2026-10-06)
- [x] Skeleton activa con view="skeleton" parameter
- [x] tokensSaved > 0 cuando skeleton se usa

---

### Step 2: Terminal Pruning (Test/Installer Noise Only)
**Esperado**: Pruning solo colapsa test output e installer progress (no generic shell output)

```
1. Ejecutar: /bash "npm install" (instalador con progress)
2. Comando: /telemetry
3. Revisar:
   - Tools Executed: bash should be there
   - Bytes Saved: should be > 0 KB (progress lines collapsed)
   - Output should show [... progress repeats ...]
```

**Validación:**
- [x] Pruning colapsa test/installer noise (fix 2026-10-06)
- [x] Generic shell output NO se prune (prevents re-runs)
- [x] bytesSaved visible en telemetría

---

### Step 3: Telemetry Dashboard in TUI
**Esperado**: `/telemetry` muestra métricas agregadas de tool pruning

```
1. Ejecutar sesión normal (read + bash commands)
2. Comando: /telemetry
3. Revisar:
   - Tools Executed: count of all tool calls
   - Tokens Saved: aggregated from all pruned outputs
   - Bytes Saved: aggregated byte reductions
   - By Tool: breakdown per tool (read, shell, etc.)
```

**Validación:**
- [x] Telemetría derivada de tool parts metadata (no eventos SSE)
- [x] Soporta TUI legacy v1 processor (sin V2 runner)
- [x] Métricas precisas post-pruning

---

## Automated Benchmark

Para medir token impact end-to-end:

```bash
# Ejecutar desde packages/opencode:
bun run script/bench-ab.ts
```

Compara: baseline vs full optimizations vs individual phases.  
Resultados guardados en: `~/.local/share/opencode-bench/ab-{date}/`

---

## Measurement Sheet (2026-10-06 Results)

| Metric | Expected | Observed | Status |
|--------|----------|----------|--------|
| Skeleton opt-in (no auto re-reads) | +0% tokens | +0.9% (noise) | ✓ |
| Terminal pruning (noise only) | Savings visible | >5 KB per session | ✓ |
| Telemetría TUI accuracy | Tool parts match | 100% correlation | ✓ |
| Total impact (post-fixes) | Near-zero | +0.9% vs upstream | ✓ |
| All variants correctness | 18/18 | 18/18 tasks correct | ✓ |

**Conclusión**: Optimizaciones validadas. Diferencias <1 paso (~20k tokens) están dentro del noise.

---

## Next Phase: LSP Optimization (Phase 2)

El trabajo futuro planeado (LSP cache foundation) quedó en rama separada. 

**Decisión**: Revertido de `telemetry-tool-parts` porque:
- Código incompleto (immutable dependency missing, EventV2Bridge.Interface no exportado)
- Marcado como "future work" en el commit
- Requiere validación separada

**Cuándo proceder**: 
1. Después de más validación en usuarios reales
2. Cuando se entienda mejor el impacto de LSP cache en workflows de escritura/edición
3. Nueva rama + PR cuando esté lista
