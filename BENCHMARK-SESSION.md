# Optimization Benchmark Session Guide

**Objetivo**: Validar que las 5 optimizaciones funcionan en sesiones reales con datos concretos.

**Duración**: ~15-20 minutos  
**Setup**: `bun dev` en `packages/opencode` con terminal limpia

---

## Opción A: Manual Benchmark (Recomendado)

### Step 1: Skeleton Auto-Activation
**Esperado**: Archivo >200 líneas → auto-skeleton activa → tokensSaved > 0

```
1. Ejecutar sesión
2. /read packages/opencode/src/lsp/lsp.ts (341 líneas)
3. Comando: /telemetry
4. Revisar:
   - Tools Executed: should see "read"
   - Tokens Saved: should be > 0
   - Output should show <reason>Auto-enabled for file with 341 lines</reason>
```

**Nota qué ves:**
- [ ] Skeleton se activó automáticamente
- [ ] tokensSaved fue > 0
- [ ] Bytes Saved fue > 0 KB

---

### Step 2: Terminal Pruning Deduplication
**Esperado**: Comando ruidoso → dedup activa → Bytes Saved > 0

```
1. Ejecutar: /bash "npm install --save lodash"
2. Comando: /telemetry
3. Revisar:
   - Tools Executed: bash should be there
   - Bytes Saved: should be > 0 KB (from deduplication)
   - Output should show [... repeated X times ...]
```

**Nota qué ves:**
- [ ] Deduplicación de líneas repetidas funcionó
- [ ] Bytes Saved fue significativo (>5 KB)
- [ ] Lineas colapsadas con [... repeated ...]

---

### Step 3: Syntax Validation
**Esperado**: Código válido → cambio inválido → error

```
1. /edit packages/opencode/src/lsp/cache.ts
   oldString: "return methods"
   newString: "return methods" (sin punto y coma al final - TypeScript)
2. Deberías ver error de validación: 
   "Syntax validation failed: changes would create invalid syntax"
```

**Nota qué ves:**
- [ ] Validación de sintaxis rechazó el cambio
- [ ] Error message fue claro y específico

---

### Step 4: Diff Compaction
**Esperado**: Cambio grande → diff >2KB → compactado en metadata

```
1. /edit packages/opencode/src/lsp/lsp.ts
   oldString: (selecciona ~50 líneas de método)
   newString: (reemplaza con versión similar pero diferente)
2. Revisar el permission prompt:
   - Diff should show [Diff too large...] no el full diff
```

**Nota qué ves:**
- [ ] Diff grande fue compactado
- [ ] Summary mostró +N lines, -N lines
- [ ] No se envió el diff completo

---

### Step 5: Integration Test
**Esperado**: Todas juntas trabajando

```
1. /read packages/core/src/util/terminal-pruner.ts (143 líneas)
   → Skeleton puede activar si supera threshold
2. /bash "find . -name '*.ts' | wc -l"
   → Terminal pruning puede dedup
3. /telemetry
   → Ver aggregated savings de ambas operaciones
```

**Nota qué ves:**
- [ ] Skeleton tokensSaved
- [ ] Bash bytesSaved
- [ ] Total cumulative savings

---

## Opción B: Automated Benchmark (Semi-automated)

**Próximamente**: Script que automatiza estos pasos

```bash
# Ejecutar desde packages/opencode:
bun run benchmark-session.ts
```

Esto ejecutará todos los steps automáticamente y reportará datos en formato tabla.

---

## Measurement Sheet

Después de completar, rellenar:

```
| Metric | Expected | Observed | Status |
|--------|----------|----------|--------|
| Skeleton tokensSaved (read large file) | > 60% | ? | ✓/✗ |
| Terminal pruning bytesSaved (npm install) | 20-50 KB | ? | ✓/✗ |
| Syntax validation rejection | error msg | ? | ✓/✗ |
| Diff compaction (>2KB) | [Diff too large...] | ? | ✓/✗ |
| Total session tokens saved | 30-40% | ? | ✓/✗ |
```

---

## Troubleshooting

**Skeleton no se activó**:
- Verificar que archivo > 200 líneas
- Verificar que NO hay `offset` o `limit` en el read
- Revisar que Skeleton.Service está en layers

**Terminal pruning sin savings**:
- Comando debe ser "ruidoso" (muchas líneas repetidas)
- `npm install` es mejor que `ls`

**Syntax validation no rechazó**:
- Revisar que el cambio realmente hace inválido el archivo
- TypeScript es más strict que JavaScript

**Diff no se compactó**:
- Verificar que el diff es > 2KB
- Revisar que `compactLargeDiff()` está siendo llamado

---

## Next Steps After Measurements

1. **Si todo funciona**: 
   - ✅ Adjust thresholds si es necesario
   - ✅ Proceed to LSP optimization (Fase 2)

2. **Si algo no funciona**:
   - 🔧 Debug con logs
   - 🔧 Check integration points
   - 🔧 Iterate before LSP work

3. **Reportar findings**:
   - Agregar resultados al measurement sheet
   - Actualizar OPTIMIZATION-VALIDATION.md con datos reales
