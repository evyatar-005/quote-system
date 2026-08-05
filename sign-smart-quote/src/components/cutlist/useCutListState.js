import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyPartRow, emptyStockRow, makeId } from './presets.js';
import { validateInput, findTooLargeParts } from './solver/geometry.js';

const STORAGE_KEY = 'cutlist:v1:inputs';

/** mm per 1 unit - used both to convert stored dimensions when the unit
 * selector changes, and to convert display units to mm for the solver. */
const UNIT_FACTORS = { mm: 1, cm: 10, m: 1000 };

function toNumber(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Round to 3 decimals and strip a trailing ".000" so conversions look clean. */
function formatConverted(n) {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/** Bulk-convert every row's length/width by `ratio` (old-unit-mm / new-unit-mm). Qty and name untouched. */
function convertRows(rows, ratio) {
  return rows.map((r) => {
    const len = toNumber(r.length);
    const wid = toNumber(r.width);
    return {
      ...r,
      length: r.length === '' || !Number.isFinite(len) ? r.length : formatConverted(len * ratio),
      width: r.width === '' || !Number.isFinite(wid) ? r.width : formatConverted(wid * ratio),
    };
  });
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
const MIN_VISIBLE_ROWS = 4;

/** Pad a saved (or empty) row list up to MIN_VISIBLE_ROWS with fresh blank rows. */
function withMinRows(savedRows, makeEmptyRow) {
  const rows = savedRows?.length ? [...savedRows] : [];
  while (rows.length < MIN_VISIBLE_ROWS) rows.push(makeEmptyRow());
  return rows;
}

export function useCutListState() {
  const draft = useMemo(() => loadDraft(), []);
  const [stocks, setStocks] = useState(() => withMinRows(draft?.stocks, emptyStockRow));
  const [parts, setParts] = useState(() => withMinRows(draft?.parts, emptyPartRow));
  const [unit, setUnitState] = useState(draft?.unit ?? 'mm');
  const [kerf, setKerf] = useState(draft?.kerf ?? '3');
  const [mode, setMode] = useState(draft?.mode ?? 'guillotine');
  const [deterministic, setDeterministic] = useState(draft?.deterministic ?? false);
  // CNC (סומא) registration-mark margins - mutually exclusive: setting one to
  // a value > 0 clears the other, since the machine only needs one kind of
  // margin per job (either a border around the whole sheet, or one around
  // each individual part). Always mm, like kerf - independent of the length/
  // width unit selector.
  const [somaPerSheet, setSomaPerSheetRaw] = useState(draft?.somaPerSheet ?? '0');
  const [somaPerPart, setSomaPerPartRaw] = useState(draft?.somaPerPart ?? '0');

  useEffect(() => {
    saveDraft({ stocks, parts, unit, kerf, mode, deterministic, somaPerSheet, somaPerPart });
  }, [stocks, parts, unit, kerf, mode, deterministic, somaPerSheet, somaPerPart]);

  const setSomaPerSheet = useCallback((value) => {
    setSomaPerSheetRaw(value);
    if (parseFloat(value) > 0) setSomaPerPartRaw('0');
  }, []);
  const setSomaPerPart = useCallback((value) => {
    setSomaPerPartRaw(value);
    if (parseFloat(value) > 0) setSomaPerSheetRaw('0');
  }, []);

  /** Changing the unit bulk-converts every already-entered dimension (in both
   * tables at once) so the numbers keep representing the same physical size -
   * e.g. switching from מ"מ to ס"מ turns a stored 1950 into 195. */
  const setUnit = useCallback((newUnit) => {
    setUnitState((oldUnit) => {
      if (oldUnit === newUnit) return oldUnit;
      const ratio = UNIT_FACTORS[oldUnit] / UNIT_FACTORS[newUnit];
      setStocks((rows) => convertRows(rows, ratio));
      setParts((rows) => convertRows(rows, ratio));
      return newUnit;
    });
  }, []);

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
    setStocks(Array.from({ length: MIN_VISIBLE_ROWS }, emptyStockRow));
    setParts(Array.from({ length: MIN_VISIBLE_ROWS }, emptyPartRow));
    setKerf('3');
    setSomaPerSheetRaw('0');
    setSomaPerPartRaw('0');
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
    setUnitState('mm'); // presets are always authored in mm
  }, []);

  /** Normalized numeric input, ready for the solver (always in mm), or errors listed. */
  const normalized = useMemo(() => {
    const toMm = UNIT_FACTORS[unit];
    // Soma (CNC registration mark) margins - always mm, independent of the unit
    // selector. Per-sheet margin shrinks the usable board (deducted from the
    // whole plate); per-part margin grows every individual part's footprint.
    const somaSheetBand = toNumber(somaPerSheet) || 0; // band width on each edge
    const somaSheetMm = somaSheetBand * 2; // total deducted across the sheet
    const somaPartBand = toNumber(somaPerPart) || 0; // band width around each part
    const somaPartMm = somaPartBand * 2; // total added to each part
    const stockDefs = stocks
      .filter((r) => r.name || r.length || r.width || r.qty)
      .map((r, i) => ({
        id: r.id,
        name: r.name || `לוח ${i + 1}`,
        length: toNumber(r.length) * toMm - somaSheetMm,
        width: toNumber(r.width) * toMm - somaSheetMm,
        qty: toNumber(r.qty) || 0,
      }));
    const partDefs = parts
      .filter((r) => r.name || r.length || r.width || r.qty)
      .map((r, i) => ({
        id: r.id,
        name: r.name || `חלק ${i + 1}`,
        length: toNumber(r.length) * toMm + somaPartMm,
        width: toNumber(r.width) * toMm + somaPartMm,
        qty: toNumber(r.qty) || 0,
      }));
    // kerf (blade thickness) is always mm regardless of the dimensions unit
    const kerfNum = toNumber(kerf) || 0;
    const { errors, warnings } = validateInput({ stocks: stockDefs, parts: partDefs, kerf: kerfNum });
    const tooLarge = errors.length ? [] : findTooLargeParts(stockDefs, partDefs);
    return {
      input: { stocks: stockDefs, parts: partDefs, kerf: kerfNum, mode },
      errors,
      warnings,
      tooLarge,
      somaSheetBand,
      somaPartBand,
    };
  }, [stocks, parts, unit, kerf, mode, somaPerSheet, somaPerPart]);

  return {
    stocks,
    parts,
    unit,
    setUnit,
    kerf,
    mode,
    deterministic,
    somaPerSheet,
    somaPerPart,
    setKerf,
    setMode,
    setDeterministic,
    setSomaPerSheet,
    setSomaPerPart,
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
