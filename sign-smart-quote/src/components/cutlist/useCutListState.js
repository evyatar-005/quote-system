import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyPartRow, emptyStockRow, makeId } from './presets.js';
import { validateInput, findTooLargeParts } from './solver/geometry.js';

const STORAGE_KEY = 'cutlist:v1:inputs';

function toNumber(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function loadDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.stocks) || !Array.isArray(parsed.parts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota) - draft persistence is a convenience only
  }
}

/**
 * Owns the cut-list form state (stock rows, part rows, settings) plus
 * validation. Draft is persisted to localStorage so an accidental refresh
 * doesn't lose 30 rows of manual entry; this is a client-side convenience
 * only and is not the "no persistence" the feature otherwise honors.
 */
export function useCutListState() {
  const draft = useMemo(() => loadDraft(), []);
  const [stocks, setStocks] = useState(draft?.stocks?.length ? draft.stocks : [emptyStockRow()]);
  const [parts, setParts] = useState(draft?.parts?.length ? draft.parts : [emptyPartRow()]);
  const [kerf, setKerf] = useState(draft?.kerf ?? '3');
  const [mode, setMode] = useState(draft?.mode ?? 'guillotine');
  const [quality, setQuality] = useState(draft?.quality ?? 'normal');
  const [seed, setSeed] = useState(draft?.seed ?? 24301);
  const [deterministic, setDeterministic] = useState(draft?.deterministic ?? false);

  useEffect(() => {
    saveDraft({ stocks, parts, kerf, mode, quality, seed, deterministic });
  }, [stocks, parts, kerf, mode, quality, seed, deterministic]);

  const updateStock = useCallback((id, field, value) => {
    setStocks((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);
  const addStock = useCallback(() => setStocks((rows) => [...rows, emptyStockRow()]), []);
  const removeStock = useCallback((id) => setStocks((rows) => rows.filter((r) => r.id !== id)), []);

  const updatePart = useCallback((id, field, value) => {
    setParts((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);
  const addPart = useCallback(() => setParts((rows) => [...rows, emptyPartRow()]), []);
  const removePart = useCallback((id) => setParts((rows) => rows.filter((r) => r.id !== id)), []);

  const clearAll = useCallback(() => {
    setStocks([emptyStockRow()]);
    setParts([emptyPartRow()]);
    setKerf('3');
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadPreset = useCallback((preset) => {
    setStocks(preset.stocks);
    setParts(preset.parts);
    setKerf(preset.kerf);
  }, []);

  /** Normalized numeric input, ready for the solver, or null with errors listed. */
  const normalized = useMemo(() => {
    const stockDefs = stocks
      .filter((r) => r.name || r.length || r.width || r.qty)
      .map((r) => ({
        id: r.id,
        name: r.name || r.id,
        length: toNumber(r.length),
        width: toNumber(r.width),
        qty: toNumber(r.qty) || 0,
      }));
    const partDefs = parts
      .filter((r) => r.name || r.length || r.width || r.qty)
      .map((r) => ({
        id: r.id,
        name: r.name || r.id,
        length: toNumber(r.length),
        width: toNumber(r.width),
        qty: toNumber(r.qty) || 0,
      }));
    const kerfNum = toNumber(kerf) || 0;
    const { errors, warnings } = validateInput({ stocks: stockDefs, parts: partDefs, kerf: kerfNum });
    const tooLarge = errors.length ? [] : findTooLargeParts(stockDefs, partDefs);
    return {
      input: { stocks: stockDefs, parts: partDefs, kerf: kerfNum, mode },
      errors,
      warnings,
      tooLarge,
    };
  }, [stocks, parts, kerf, mode]);

  return {
    stocks,
    parts,
    kerf,
    mode,
    quality,
    seed,
    deterministic,
    setKerf,
    setMode,
    setQuality,
    setSeed,
    setDeterministic,
    updateStock,
    addStock,
    removeStock,
    updatePart,
    addPart,
    removePart,
    clearAll,
    loadPreset,
    normalized,
  };
}

export { makeId };
