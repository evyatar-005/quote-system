// Pure interpreter: turns a saved calculator line item into a proposed
// production worksheet — no DB access, so it runs identically on the server
// (building a Worksheet from a Quote) and in unit tests.
//
// Input shapes come straight from what MultiProductCalculator.jsx already
// saves on every quote (see calculation_data.items[] in that file):
//   item = { productType, widthM, heightM, thicknessMm, quantity, result, extraRows }
// `result` is the calculator's live pricing result for that line — when
// present, result.extrasBreakdown is an array of { key, label } for whichever
// EXTRAS_OPTIONS the agent selected (spacers, hidden_spacers, paint_single,
// paint_double — see CalculatorForm.jsx EXTRAS_OPTIONS), and result.cutType /
// result.diecut flags the straight/diecut choice where relevant.
//
// recipe = a production_recipes row plus its production_recipe_steps rows
// (as returned by GET /api/entities/RecipeStep?recipe_id=...), each step:
//   { seq, operation_key, station_key, performer, is_optional, condition_text,
//     alt_group, notes }
//
// Output: ordered proposed worksheet steps, sorted by seq. Every step is a
// PROPOSAL — a תפ"י operator can flip `included` or swap the chosen station
// within an alt_group before saving as a production_worksheet. Nothing here
// writes to the DB.

function extrasOf(item) {
  const breakdown = item?.result?.extrasBreakdown;
  return Array.isArray(breakdown) ? breakdown.map(e => e.key) : [];
}

// Rough size bucket used only to propose a default within an alt_group that
// represents an order swap (e.g. 001 לוקובונד: large pieces print-then-cut,
// medium pieces sometimes cut-then-print). Purely a suggestion — the seq/
// station on each alternative step in the DB is what actually differs; this
// function only decides which member of the group to pre-select.
function sizeBucket(item) {
  const w = parseFloat(item?.widthM) || 0;
  const h = parseFloat(item?.heightM) || 0;
  const areaSqm = w * h;
  if (areaSqm >= 1.5) return 'large';
  if (areaSqm >= 0.3) return 'medium';
  return 'small';
}

// Steps whose condition_text names a specific extras key / cut type are only
// proposed as included when that condition is actually met on this item.
// condition_text is free text (per the recipe admin UI) — matched loosely
// against known vocabulary rather than parsed as a formula, since it exists
// to be read by a human first and interpreted by this function second.
function autoInclude(step, item) {
  const extras = extrasOf(item);
  const cond = (step.condition_text || '').trim();

  if (!cond) {
    return { included: !step.is_optional, autoReason: null };
  }
  if (/paint_double|2 גוונים/.test(cond)) {
    return extras.includes('paint_double')
      ? { included: true, autoReason: 'נבחרה צביעה — 2 גוונים בהצעה' }
      : { included: false, autoReason: null };
  }
  if (/paint_single|גוון יחיד|צביעה/.test(cond)) {
    return (extras.includes('paint_single') || extras.includes('paint_double'))
      ? { included: true, autoReason: 'נבחרה צביעה בהצעה' }
      : { included: false, autoReason: null };
  }
  if (/spacers|ספייסר|קידוח/.test(cond)) {
    return (extras.includes('spacers') || extras.includes('hidden_spacers'))
      ? { included: true, autoReason: 'נבחרו ספייסרים בהצעה' }
      : { included: false, autoReason: null };
  }
  if (/דייקאט|diecut/i.test(cond)) {
    const isDiecut = /diecut/i.test(item?.productType || '') || item?.result?.cutType === 'diecut';
    return isDiecut
      ? { included: true, autoReason: 'נבחר חיתוך צורני (דייקאט)' }
      : { included: false, autoReason: null };
  }
  // Unrecognized condition text — surface it for a human to resolve rather
  // than silently guessing either way.
  return { included: !step.is_optional, autoReason: `תנאי לא מזוהה אוטומטית: "${cond}" — נדרש אישור ידני` };
}

/**
 * @param {{product_type: string, steps: Array}} recipe
 * @param {object} item saved calculator line item (see file header)
 * @returns {Array<{seq:number, operation_key:string, station_key:string|null,
 *                   performer:string, optional:boolean, alt_group:string|null,
 *                   included:boolean, autoReason:string|null, notes:string|null}>}
 */
function resolveRecipe(recipe, item) {
  if (!recipe || !Array.isArray(recipe.steps)) return [];

  const bucket = sizeBucket(item);
  const steps = [...recipe.steps].sort((a, b) => a.seq - b.seq);

  // Within each alt_group, pre-select exactly one member as the default; the
  // rest of the group is proposed excluded (but still listed, so the UI can
  // offer them as the alternative choice).
  const chosenInGroup = {};
  for (const step of steps) {
    if (!step.alt_group || chosenInGroup[step.alt_group]) continue;
    const group = steps.filter(s => s.alt_group === step.alt_group);
    // Default heuristic: a step whose notes/condition mention this item's
    // size bucket wins; otherwise the first step in seq order (DB entry
    // order == the recipe author's stated default).
    const bySize = group.find(s => (s.notes || s.condition_text || '').includes(bucket === 'large' ? 'גדול' : bucket === 'medium' ? 'בינוני' : 'קטן'));
    chosenInGroup[step.alt_group] = (bySize || group[0]).id;
  }

  return steps.map(step => {
    if (step.alt_group) {
      const isChosen = chosenInGroup[step.alt_group] === step.id;
      return {
        seq: step.seq,
        operation_key: step.operation_key,
        station_key: step.station_key,
        performer: step.performer,
        optional: !!step.is_optional,
        alt_group: step.alt_group,
        included: isChosen,
        autoReason: isChosen ? `ברירת מחדל לפי גודל (${bucket})` : null,
        notes: step.notes,
      };
    }
    const { included, autoReason } = autoInclude(step, item);
    return {
      seq: step.seq,
      operation_key: step.operation_key,
      station_key: step.station_key,
      performer: step.performer,
      optional: !!step.is_optional,
      alt_group: null,
      included,
      autoReason,
      notes: step.notes,
    };
  });
}

module.exports = { resolveRecipe, extrasOf, sizeBucket };
