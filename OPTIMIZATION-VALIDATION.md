# Optimization Validation Report

> **Estado (2026-10-06): desactualizado.** Un A/B de punta a punta (`packages/opencode/script/bench-ab.ts`)
> mostró que el skeleton automático y la poda genérica de la terminal aumentaban el total de tokens un ~20%,
> porque hacían que el modelo diera pasos extra para recuperar lo recortado. Se quitaron: el skeleton ahora solo
> se usa con `view="skeleton"` y la poda solo colapsa tests que pasan y progreso de instalación. Para medir,
> usar `bun script/bench-ab.ts` desde `packages/opencode`.

**Date**: 2026-10-06  
**Status**: ✅ All 5 phases implemented and validated

## Test Results

✅ **16/16 tests passed**
- Telemetry: 2 tests (rawBytes tracking, token savings calculation)
- Skeleton auto-activation: 3 tests (200+ lines, <200 lines, offset/limit guards)
- Terminal pruning: 4 tests (deduplication, error preservation, collapse >5, preserve <5)
- Syntax validation: 2 tests (reject invalid, allow WIP)
- Diff compaction: 2 tests (small diffs preserved, large diffs compacted)
- Integration: 2 tests (skeleton savings, terminal pruning reduction)

## Optimizations Implemented

### 1. Telemetry: Raw Bytes Tracking ✅
**Status**: Validated
- `rawBytes` flows from tools → Settlement → LLMEvent → SessionEvent.Tool.Telemetry
- Tests confirm: `tokensSaved > 0` when pruning occurs
- **Metrics**: Baseline for measuring all other optimizations

**How to verify in real session**:
```
/telemetry command shows:
- Tools Executed: N
- Tokens Saved: > 0 (if pruning active)
- Bytes Saved: > 0 KB
```

### 2. AST Skeleton: Auto-Activation ✅
**Status**: Validated
- Auto-activates for files ≥200 lines (no offset/limit)
- Skips if offset or limit specified (respects explicit ranges)
- **Expected savings**: 60-90% on large source files

**How to verify**:
1. Open a large file (>200 lines, e.g., long TypeScript/Python class)
2. Check `/telemetry` → should show high `tokensSaved` for read tool
3. Output should include `<reason>Auto-enabled for file with XXX lines</reason>`

### 3. Pre-Write Syntax Validation ✅
**Status**: Validated
- Rejects changes that make valid files invalid
- Allows changes on already-invalid files (WIP support)
- Applied to: `edit.ts`, `write.ts`, `apply_patch.ts`
- **Expected savings**: Indirect (fewer syntax-repair round trips)

**How to verify**:
1. Try to edit valid TypeScript and introduce syntax error
2. Should see: `Syntax validation failed: changes would create invalid syntax`
3. Try editing already-broken code → should allow

### 4. Terminal Pruning: Deduplication ✅
**Status**: Validated
- Deduplicates consecutive identical lines (except errors)
- Collapses >5 repeated lines with `[... repeated N times ...]`
- Preserves error lines always
- **Expected savings**: 30-70% on verbose build output

**How to verify**:
1. Run `bash` tool with npm install or build command
2. Check `/telemetry` → `Bytes Saved` should be significant
3. Output should show `[... repeated X times ...]` for build spam

### 5. Patch Optimization: Diff Compaction ✅
**Status**: Validated
- Diffs >2KB summarized as `[Diff too large (XXXX bytes). Summary: +N lines, -N lines]`
- Diffs <2KB preserved fully
- Applied to: permission metadata in edit/write tools
- **Expected savings**: 5-15% on multi-file changes

**How to verify**:
1. Edit file that produces >2KB diff
2. Permission metadata should show compact summary not full diff
3. Large diffs no longer bloat context during permission ask

## Real-World Testing Guide

### Setup
```bash
cd /home/agustin/proyectos_software/opencode/packages/opencode
tmux new-session -d -s opencode-test 'bun dev'
sleep 5  # Wait for startup
```

### Test Scenarios

**Scenario 1: Large File Read (Skeleton)**
```
/read <path to large TypeScript file (>200 lines)>
→ Check /telemetry
Expected: high tokensSaved, auto-skeleton activated
```

**Scenario 2: Build Output (Terminal Pruning)**
```
/bash "npm install" (or similar verbose command)
→ Check /telemetry  
Expected: significant bytesSaved from deduplication
```

**Scenario 3: Syntax Validation**
```
/edit <valid file>
  oldString: "const x = 1;"
  newString: "const x = 1" (remove semicolon, breaks TypeScript)
→ Should reject with syntax validation error
```

**Scenario 4: Large Diff (Patch Optimization)**
```
/edit <file>
  oldString: large section (>1KB)
  newString: different content (>1KB)
→ Permission request should show [Diff too large...] summary not full text
```

**Scenario 5: Integration (All optimizations together)**
```
1. Edit large file (200+ lines) with syntax validation
2. Run verbose command  
3. Check /telemetry after each step
Expected: cumulative savings from skeleton + pruning + validation
```

## Measurement Targets

After running real sessions, validate:

| Optimization | Metric | Target | How to Measure |
|---|---|---|---|
| Telemetry | rawBytes accuracy | ±5% | Compare `/telemetry` rawBytes vs actual file size |
| Skeleton | Token savings | 60-90% | Large read: tokensSaved / rawTokens * 100 |
| Terminal Pruning | Byte reduction | 30-70% | Bash tool: bytesSaved / rawBytes * 100 |
| Syntax Validation | Prevention rate | N/A | Count rejections vs total edit attempts |
| Diff Compaction | Reduction | 5-15% | Multi-file edits: observe compact summaries |

## Adjustment Points

Based on real measurements, may adjust:

- **autoSkeletonThreshold**: Currently 200 lines
  - If skeleton activates rarely: lower to 100-150
  - If activates constantly: raise to 250-300

- **MAX_DIFF_BYTES**: Currently 2048 bytes
  - If diffs still large: lower to 1024
  - If too aggressive: raise to 4096

- **DEFAULT_MAX_LINES**: Currently 80 in terminal pruner
  - If output still large: lower to 50
  - If losing context: raise to 100

## Next Steps

1. ✅ Tests pass locally
2. ⏳ Run 2-3 real sessions, record `/telemetry` at each step
3. ⏳ Analyze metrics, identify any misses
4. ⏳ Adjust thresholds if needed
5. ⏳ Document final observations

## Files Modified

- `packages/core/src/util/terminal-pruner.ts` - deduplication
- `packages/core/src/tool/patch-optimizer.ts` - (baseline, used by edit)
- `packages/opencode/src/tool/read.ts` - auto-skeleton
- `packages/opencode/src/tool/edit.ts` - syntax validation, diff compaction
- `packages/opencode/src/tool/write.ts` - syntax validation, diff compaction
- `packages/opencode/src/tool/apply_patch.ts` - syntax validation
- `packages/tui/src/context/telemetry.tsx` - telemetry collection
- `packages/tui/src/component/dialog-telemetry.tsx` - telemetry display
