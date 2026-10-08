# Optimization Benchmark Session Guide

> **Estado (2026-10-07): VALIDADO ✓** 
> 
> A/B benchmark completo ejecutado 2026-10-06 (`packages/opencode/script/bench-ab.ts`) mostró que:
> - Skeleton automático + poda genérica causaban +20% tokens (pasos extra de modelo)
> - **Solución implementada**: Skeleton ahora es opt-in (view="skeleton"), poda solo colapsa noise (tests/installer)
> - **Resultado**: Rerun 2026-10-06 post-fixes (`ab-2026-10-06-v2`, solo `full` y `upstream`, 6 tareas × 3 repeticiones): `full` +0.9% de tokens de prompt frente a `upstream`
> - **Corrida previa** (`ab-2026-10-06`, pre-fixes): `full` +11.2% y `no-tool-opt` −3.9% frente a `upstream`, con 18/18 respuestas correctas en las tres variantes
> - **Conclusión**: Con n=18 por variante, +0.9% está dentro del ruido. Las optimizaciones no quedan demostradas como ahorro; solo se verificó que no empeoran el total.
> - **Phase 2 (LSP cache)**: revertida de la rama, sin trabajo en curso (ver al final)

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

Para medir token impact end-to-end, desde `packages/opencode`:

```bash
bun run bench:ab --reps 3 --variants full,upstream --out ~/.local/share/opencode-bench/<nombre>
```

Opciones: `--variants` (`full`, `no-tool-opt`, `upstream`), `--tasks` (ids separados por coma), `--reps`, `--concurrency` (3 por defecto), `--model` (`deepseek/deepseek-v4-pro` por defecto). Resultados: `results.json` (crudo, una fila por corrida) y `report.md`.

### Tareas (12)

- **Lectura (9):** `resumen-archivo-grande`, `detalle-implementacion`, `buscar-definicion` (símbolo `estimate` en core), `correr-tests`, `log-git` (anclado a `f7da00f35e`), `contar-dependencias`, `max-read-bytes`, `max-read-lines`, `contar-tools`.
- **Edición (3):** `editar-version`, `crear-archivo`, `editar-segunda-ocurrencia`. Cada una trabaja sobre archivos temporales en `<out>/scratch/`, nunca dentro del repo, y se verifica leyendo el archivo resultante.

Las expectativas que dependen del repo (`registryDeps`, `readTestsPassed`, `oldestCommit`, `toolFiles`) se calculan al arrancar. `log-git` usa un commit fijo como ancla para que los commits nuevos no cambien la respuesta esperada.

### Reporte

- **Totales y por tarea:** medianas por tarea; los totales son la suma de medianas.
- **Diferencia pareada vs línea base:** promedio de la log-razón de prompt tokens por tarea, con error estándar entre tareas. Es la cifra que sirve para decidir, porque la varianza entre tareas domina a la varianza entre repeticiones.
- **Herramientas por variante:** llamadas totales por nombre, leídas de las partes `tool` de la base de datos de cada variante.

### Protocolo de corrida

1. **Revisar el saldo del proveedor antes de correr.** Con saldo agotado, las corridas fallan con `AI_APICallError: Insufficient Balance` y el benchmark no mide nada (ver la corrida fallida abajo). El script no puede consultar el saldo, así que este paso sigue siendo manual.
   - **Tope de gasto:** `--max-cost` (1 USD por defecto). El script estima ~0.015 USD por corrida y no arranca si la estimación supera el tope. Para correr un lote más grande, subir el tope a propósito.
   - **Corte por costo:** al alcanzar el tope durante la corrida, no se lanzan más corridas. Los resultados quedan marcados como parciales.
   - **Corte por fallas:** `--max-failures` (3 por defecto). Tras esa cantidad de fallas seguidas, el script se detiene y muestra el error real que leyó del log de opencode.
2. **No hacer commits ni cambios en el repo mientras corre.** La variante `full` ejecuta el checkout actual; cambiar archivos durante la corrida la contamina.
3. **Las ediciones van a `<out>/scratch/`**, nunca al repo.
4. **Medir solo con el número de corridas completo.** Una corrida con fallas no se compara con otra completa.

### Corrida fallida: `baseline-v3` (2026-10-08)

Intento de 72 corridas (12 tareas × 3 repeticiones × `full` y `upstream`). Terminó con 53 fallidas. La causa está en `data/<variant>/opencode/log/opencode.log`: `AI_APICallError: Insufficient Balance` desde DeepSeek, a partir de las 04:01. Las 19 corridas restantes son una muestra incompleta y no se usan para comparar. Hay que relanzar con saldo.

Lección: el error aparece en el log de opencode, no en `results.json`, que solo guarda `ok: false` con `error` vacío. Cuando una corrida falla sin mensaje, revisar el log antes de sacar conclusiones.

---

## Measurement Sheet (2026-10-06 Results)

| Metric | Expected | Observed | Status |
|--------|----------|----------|--------|
| Skeleton opt-in (no auto re-reads) | +0% tokens | No medido por separado; el +0.9% es del total | — |
| Terminal pruning (noise only) | Savings visible | ">5 KB per session": sin datos guardados que lo respalden | No verificado |
| Telemetría TUI accuracy | Tool parts match | "100% correlation": sin datos guardados que lo respalden | No verificado |
| Total impact (post-fixes) | Near-zero | +0.9% `full` vs `upstream` (v2) | Dentro del ruido |
| Correctness (post-fixes) | 18/18 | `full` 17/18 (falla `contar-dependencias` rep 0); `upstream` 18/18 | Parcial |
| Correctness (pre-fixes) | 18/18 | 18/18 en `full`, `no-tool-opt` y `upstream` | ✓ |

**Conclusión**: el benchmark muestra que el cambio final no sube el total de tokens de forma medible con 18 corridas por variante. No demuestra ahorro, y una falla de correctitud en `full` queda sin investigar.

### Investigación posterior (2026-10-08)

Línea base sobre HEAD `telemetry-cleanup` (`baseline-telemetry-cleanup`), comparada con upstream. Las diferencias son pareadas por tarea, con error estándar sobre las 6 tareas:

| Corrida | `full` vs upstream | `no-tool-opt` vs upstream |
|---|---|---|
| v1 (pre-fixes) | +11.2% (sin error estándar calculado) | −3.9% |
| v2 (post-fixes) | +1.4% ± 3.8% | — |
| Baseline (HEAD actual) | +6.7% ± 7.5% | +3.0% |

- **Ninguna diferencia es distinguible del ruido.** Entre tareas el cambio va de −19% a +38%. Con 6 tareas × 3 repeticiones, el benchmark no detecta efectos menores a ~10–15%.
- **`contar-dependencias` (v2, `full`, rep 0):** el modelo respondió "24 entradas" y listó 25. Son 25 entradas reales en `registry.ts:438-466`. Es un error de conteo del modelo, no una regresión de la herramienta.
- **`log-git` (baseline, reps 1 y 2, todas las variantes):** el benchmark se corrió mientras yo hacía commits en el mismo repo que usa como objetivo. El commit `f7da00f` (esperado) quedó en la posición 305 de `git log -n 300`, y la ventana empieza ahora en `1ce281b7ab`. Es un artefacto del entorno. Corregirlo requiere fijar la ventana del prompt a un commit, en lugar de `HEAD`.
- **Regla para futuras corridas:** no hacer commits ni cambios en el repo objetivo mientras corre `bench:ab`, o correrlo en un worktree fijo.

**Ruta de sesión por defecto:** `opencode run` envía prompts por el SDK a `/session/:id/prompt`, que usa `SessionPrompt.Service` (v1) (`handlers/session.ts:52,300`). Ningún route de prompt que revisé usa V2. No verifiqué la ruta del TUI.

---

## Next Phase: LSP Optimization (Phase 2)

El trabajo de LSP cache foundation fue revertido de `telemetry-tool-parts` (commit `8fbf2554c5`), no movido a otra rama.

**Decisión**: Revertido porque:
- Código incompleto (immutable dependency missing, EventV2Bridge.Interface no exportado)
- Marcado como "future work" en el commit
- Requiere validación separada

**Cuándo proceder**: 
1. Después de más validación en usuarios reales
2. Cuando se entienda mejor el impacto de LSP cache en workflows de escritura/edición
3. Nueva rama + PR cuando esté lista
