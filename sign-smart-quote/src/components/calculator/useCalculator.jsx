/**
 * Core calculation logic.
 * base_price_Xmm = price per mm per sqm (₪/mm/m²)
 * All costs from PricingConfig.
 */

// Logo (001) product types → PricingConfig material-cost field.
// The 4 plain perspex colors (print/black/white/milky) share one generic
// material rate (perspex_cost_per_mm) since there's no separate cost field
// per color yet; mirror/metallic already have their own dedicated fields.
const MATERIAL_COST_KEY_BY_PRODUCT_TYPE = {
  pvc_white: "pvc_white_cost_per_mm",
  pvc_black: "pvc_black_cost_per_mm",
  perspex_print: "perspex_cost_per_mm",
  perspex_print_back: "perspex_cost_per_mm",
  perspex_black: "perspex_cost_per_mm",
  perspex_white: "perspex_cost_per_mm",
  perspex_milky: "perspex_cost_per_mm",
  perspex_mirror: "perspex_mirror_cost_per_mm",
  perspex_metallic: "perspex_gold_metallic_cost_per_mm",
};

// Agent-adjustable price range (לוקובונד/פיויסי): a tier's price_per_sqm is the
// starting price; agent_min_price_per_sqm (if > 0) is the floor a sales agent can
// discount down to via a slider in their own quote screen. 0 = no range, the
// starting price is fixed. requested is the agent's chosen price_per_sqm (or null
// to just use the starting price) — always clamped into [floor, startingPrice].
function clampAgentPricePerSqm(startingPrice, agentMinPrice, requested) {
  const floor = (parseFloat(agentMinPrice) || 0) > 0 ? parseFloat(agentMinPrice) : startingPrice;
  if (requested == null || requested === "") return startingPrice;
  const req = parseFloat(requested);
  if (isNaN(req)) return startingPrice;
  return Math.min(startingPrice, Math.max(floor, req));
}

// Raw material cost for 1 m² of a logo product at a given thickness, no extras —
// same components `calculate()` uses for the PVC/perspex path (board + ink + dowel +
// packaging + instruction sheet + mounting board, plus waste %). Used by the admin
// price table to show a gross-margin estimate per cell that actually matches what
// the calculator (and a real quote) would compute, instead of board cost alone.
function rawMaterialCostPerSqm(config, productType, thicknessMm) {
  const T = parseFloat(thicknessMm) || 0;
  const materialCostKey = MATERIAL_COST_KEY_BY_PRODUCT_TYPE[productType] || "pvc_white_cost_per_mm";
  const materialCostPerMmPerSqm = parseFloat(config?.[materialCostKey]) || 0;
  const boardCost = materialCostPerMmPerSqm * T; // area = 1 m²
  const inkCost = parseFloat(config?.ink_cost) || 0;
  const dowelCost = parseFloat(config?.dowel_cost_per_sqm) || 0;
  const packagingCost = parseFloat(config?.packaging_cost) || 0;
  const instructionCost = parseFloat(config?.instruction_sheet_cost) || 0;
  const mountingCost = parseFloat(config?.mounting_board_cost) || 0;
  const beforeWaste = boardCost + inkCost + dowelCost + packagingCost + instructionCost + mountingCost;
  const wastePct = (parseFloat(config?.raw_material_waste_percent) || 0) / 100;
  return beforeWaste * (1 + wastePct);
}

// Lokobond (005) — flat ₪/m² material cost, no thickness multiplier (fixed 3mm product).
function lokobondMaterialCostPerSqm(config) {
  return parseFloat(config?.lokobond_cost_per_sqm) || 0;
}

// Laser-cut numbers (012) — same perspex finishes as the logo family, but
// priced per single digit by height+thickness (signshop_number_tiers), not
// per m² — see NumberPriceTable.jsx.
const NUMBER_TYPES = [
  'numbers_perspex_clear', 'numbers_perspex_black', 'numbers_perspex_white',
  'numbers_perspex_milky', 'numbers_perspex_mirror', 'numbers_perspex_metallic',
];

// Foamex (006) product types → PricingConfig material-cost field (₪/mm/m², like PVC).
const FOAMEX_MATERIAL_COST_KEY_BY_PRODUCT_TYPE = {
  foamex_white: "foamex_white_cost_per_mm",
  foamex_black: "foamex_black_cost_per_mm",
};

// Raw material cost for 1 m² of Foamex at a given thickness — same ×mm math as PVC.
// No ink/dowel/packaging/instruction/mounting costs here (not part of this product's cost model).
function foamexMaterialCostPerSqm(config, productType, thicknessMm) {
  const T = parseFloat(thicknessMm) || 0;
  const key = FOAMEX_MATERIAL_COST_KEY_BY_PRODUCT_TYPE[productType] || "foamex_white_cost_per_mm";
  return (parseFloat(config?.[key]) || 0) * T;
}

// Perspex board (010) — same cost/time shape as Foamex, just its own material
// costs (מ"עלויות חומרי גלם") and own thicknesses (3/5/10 מ"מ instead of 2/3/5).
const PERSPEX_BOARD_MATERIAL_COST_KEY_BY_PRODUCT_TYPE = {
  perspex_board_clear_print: "perspex_board_clear_print_cost_per_mm",
  perspex_board_black_matte: "perspex_board_black_matte_cost_per_mm",
  perspex_board_black_glossy: "perspex_board_black_glossy_cost_per_mm",
  perspex_board_white: "perspex_board_white_cost_per_mm",
  perspex_board_milky: "perspex_board_milky_cost_per_mm",
  perspex_board_back_print: "perspex_board_back_print_cost_per_mm",
};
function perspexBoardMaterialCostPerSqm(config, productType, thicknessMm) {
  const T = parseFloat(thicknessMm) || 0;
  const key = PERSPEX_BOARD_MATERIAL_COST_KEY_BY_PRODUCT_TYPE[productType] || "perspex_board_clear_print_cost_per_mm";
  return (parseFloat(config?.[key]) || 0) * T;
}

export function calculate({ config, widthM, heightM, widthCm, heightCm, thicknessMm, quantity = 1, productType, region = 'מרכז', includeInstallation = 'yes', delivery = 'pickup', priceTiers = [], stickerPriceTiers = [], paintSurchargeTiers = [], kapaPriceTiers = [], kapaTierId = null, rollupPriceTiers = [], rollupTierId = null, lokobondAreaTiers = [], glassPriceTiers = [], glassTierId = null, numberPriceTiers = [], numberTierId = null, cutType = 'straight', standardShelves = 0, customShelves = 0, elements, extras = [], enforceMinimumPrice = true, customPricePerSqm = null, orderAreaOverride = null }) {
  const W = widthM != null && widthM !== '' ? parseFloat(widthM) : (parseFloat(widthCm) || 0) / 100;
  const H = heightM != null && heightM !== '' ? parseFloat(heightM) : (parseFloat(heightCm) || 0) / 100;
  // A dimension must be a real positive number — "0", a blank field, or a
  // negative value are all treated as "not entered yet", never as a valid
  // (and therefore price-able) size.
  const hasWidth = Number.isFinite(W) && W > 0;
  const hasHeight = Number.isFinite(H) && H > 0;
  const isSticker = productType === 'vinyl_sticker' || productType === 'texture_sticker';
  const isKapa = productType === 'kapa';
  const isRollup = productType === 'rollup_magnetic' || productType === 'rollup_regular';
  const isLokobond = productType === 'lokobond_diecut' || productType === 'lokobond_plain';
  const isFoamex = productType === 'foamex_white' || productType === 'foamex_black';
  const isPerspexBoard = Object.prototype.hasOwnProperty.call(PERSPEX_BOARD_MATERIAL_COST_KEY_BY_PRODUCT_TYPE, productType);
  const isGlass = productType === 'glass_extra_clear';
  const isNumbers = NUMBER_TYPES.includes(productType);
  // PVC carpet (013) — sold by roll width, not by thickness; the form always
  // sends a fixed placeholder thicknessMm (just a price-tier lookup key, same
  // as lokobond's fixed "3"), same reasoning as the lokobond exclusion below.
  const isPvcCarpet = productType === 'pvc_carpet';
  if (!config) return null;
  // Kapa / roll-up / glass are fixed-price catalog items chosen directly (מחיר קבוע × כמות) —
  // no dimensions needed. Everything else still needs width/height (+ thickness for logo/foamex).
  // Lokobond has a fixed 3mm thickness — the form always sends it, but don't require it here.
  if (!isKapa && !isRollup && !isGlass && !isNumbers && (!hasWidth || !hasHeight)) return null;
  if (!isSticker && !isKapa && !isRollup && !isLokobond && !isGlass && !isPvcCarpet && !isNumbers && !thicknessMm) return null;

  const Q = parseInt(quantity) || 1;
  const area = (W || 0) * (H || 0);
  const overheadPct = (parseFloat(config.operational_overhead_percent) || 0) / 100;

  // --- KAPA PATH (fixed-price list row × quantity) ---
  if (isKapa) {
    // Prefer the directly-chosen row; fall back to legacy dimension matching.
    let tier = kapaTierId != null ? kapaPriceTiers.find(t => String(t.id) === String(kapaTierId)) : null;
    if (!tier) {
      const fits = (t) => (W <= Number(t.max_width_m) && H <= Number(t.max_height_m)) || (W <= Number(t.max_height_m) && H <= Number(t.max_width_m));
      const candidates = kapaPriceTiers.filter(t => t.cut_type === cutType);
      const matchedTiers = candidates.filter(fits).sort((a, b) => (Number(a.max_width_m) * Number(a.max_height_m)) - (Number(b.max_width_m) * Number(b.max_height_m)));
      tier = matchedTiers[0] || candidates.sort((a, b) => (Number(b.max_width_m) * Number(b.max_height_m)) - (Number(a.max_width_m) * Number(a.max_height_m)))[0];
    }
    if (!tier) return null;

    // Kapa is a fixed-size catalog row (chosen by tier, not by width/height
    // entry) — the generic `area`/`totalArea` fields are always 0 for it
    // otherwise, which breaks any per-m² metric (cost/m², price/m²) a manager
    // wants to see. The tier's own nominal size is the real physical size of
    // the product being sold, so it's used here for that purpose.
    const kapaArea = (parseFloat(tier.max_width_m) || 0) * (parseFloat(tier.max_height_m) || 0);
    const sheetIsSmall = Number(tier.max_width_m) <= 1.22 + 0.01 && Number(tier.max_height_m) <= 2.44 + 0.01;
    const sheetCost = sheetIsSmall ? (parseFloat(config.kapa_sheet_cost_122x244) || 0) : (parseFloat(config.kapa_sheet_cost_150x300) || 0);
    // Kapa is a fixed-size catalog row (chosen by tier, not by width/height
    // entry) — the generic `area` above is always 0 here. Ink is charged per
    // the actual raw sheet used to cut it from (same sheet that sheetCost is
    // priced on), not the cut piece's final size.
    const kapaSheetArea = sheetIsSmall ? 1.22 * 2.44 : 1.5 * 3.0;
    // Ink is a flat ₪/m² cost shared by every printed family (config.ink_cost) —
    // kapa is printed too, so it needs the same line every other family has.
    const inkCost = (parseFloat(config.ink_cost) || 0) * kapaSheetArea * Q;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const rawMaterialBeforeWaste = sheetCost * Q + inkCost;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    // Cost (חומרי גלם) and selling price (קביעת מחירי מכירה) are separate config
    // fields — shelves used to reuse the selling price as its own cost too (zero
    // margin, and mislabeled as "cost" in the material breakdown).
    const shelvesCostReal = (parseInt(standardShelves) || 0) * (parseFloat(config.kapa_shelf_standard_cost) || 0)
      + (parseInt(customShelves) || 0) * (parseFloat(config.kapa_shelf_custom_cost) || 0);
    const shelvesSellingPrice = (parseInt(standardShelves) || 0) * (parseFloat(config.kapa_shelf_standard_price) || 0)
      + (parseInt(customShelves) || 0) * (parseFloat(config.kapa_shelf_custom_price) || 0);

    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
    const isDieCut = tier.cut_type === 'die_cut';
    const prePrintMinutes = parseFloat(config.kapa_pre_print_time_minutes) || 0;
    const printMinutes = parseFloat(config[sheetIsSmall ? 'kapa_print_time_small_minutes' : 'kapa_print_time_large_minutes']) || 0;
    // קאפה נחתך ב-CNC (סומא) בלבד — אין חיתוך לייזר במקטע הזה.
    const preCutMinutes = parseFloat(config.kapa_pre_cut_time_minutes) || 0;
    const cutMinutesKey = `kapa_cut_time_${sheetIsSmall ? 'small' : 'large'}_${isDieCut ? 'diecut' : 'straight'}_minutes`;
    const cutMinutes = parseFloat(config[cutMinutesKey]) || 0;
    const packagingMinutes = parseFloat(config.kapa_packaging_time_minutes) || 0;
    const prePrintLaborCost = (prePrintMinutes / 60) * printHourCost * Q;
    const printLaborCost = (printMinutes / 60) * printHourCost * Q;
    const preCutLaborCost = (preCutMinutes / 60) * printHourCost * Q;
    const cncCutLaborCost = (cutMinutes / 60) * printHourCost * Q;
    const packagingLaborCost = (packagingMinutes / 60) * workerHourCost * Q;
    const laborCost = prePrintLaborCost + printLaborCost + preCutLaborCost + cncCutLaborCost + packagingLaborCost;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const sellingPricePerUnit = Number(tier.price) || 0;
    // קאפה — ללא דמי משלוח בכלל
    const sellingPriceAll = sellingPricePerUnit * Q + shelvesSellingPrice;

    const salesAgentCommissionCost = sellingPriceAll * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPriceAll * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostAll = rawMaterialCost + laborCost + overheadCost + salesAgentCommissionCost + marketingCommissionCost + shelvesCostReal;

    const profitPerUnit = sellingPriceAll - totalCostAll;
    const profitMarginPct = sellingPriceAll > 0 ? (profitPerUnit / sellingPriceAll) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    const extrasBreakdown = [];
    if (shelvesCostReal > 0 || shelvesSellingPrice > 0) extrasBreakdown.push({ key: 'shelves', label: 'מדפים', cost: round(shelvesCostReal), sellingCost: round(shelvesSellingPrice), calc: `${standardShelves || 0} סטנדרטים + ${customShelves || 0} בעיצוב אישי`, type: 'material' });

    return {
      area: round(kapaArea),
      totalArea: round(kapaArea * Q),
      kapaSku: tier.sku,
      kapaDescription: tier.description,
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(rawMaterialCost + laborCost + overheadCost),
      totalCostPerUnit: round(totalCostAll / Q),
      totalCostAll: round(totalCostAll),
      sellingPricePerUnit: round(sellingPricePerUnit),
      sellingPriceAll: round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: round(priceWithVat),
      extrasBreakdown,
      isSticker: false,
      isKapa: true,
      productFamily: 'kapa',
      breakdown: {
        kapaSheetCost: round(sheetCost * Q),
        inkCost: round(inkCost),
        // The tier's own nominal size — kapa has no agent-entered width/height
        // (it's chosen by tier, not measured), so this is the only place the
        // product's physical size is recorded at all. It's an upper bound
        // ("up to" the tier's max size), not an exact cut measurement.
        kapaWidthM: parseFloat(tier.max_width_m) || 0,
        kapaHeightM: parseFloat(tier.max_height_m) || 0,
        kapaSheetIsSmall: sheetIsSmall,
        kapaPrePrintLaborCost: round(prePrintLaborCost),
        kapaPrintLaborCost: round(printLaborCost),
        kapaPreCutLaborCost: round(preCutLaborCost),
        kapaCncCutLaborCost: round(cncCutLaborCost),
        kapaPackagingLaborCost: round(packagingLaborCost),
        kapaIsDieCut: isDieCut,
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- ROLLUP PATH (fixed-size catalog row, quantity-discount pricing) ---
  // Unit 1 / unit 2 / unit 3-and-up each carry their own price set directly on
  // the tier row (no formula) — sellingPriceAll sums each unit at its own rate.
  if (isRollup) {
    const tier = rollupTierId != null ? rollupPriceTiers.find(t => String(t.id) === String(rollupTierId)) : null;
    if (!tier) return null;

    const rollupArea = (parseFloat(tier.width_m) || 0) * (parseFloat(tier.height_m) || 0);
    // Paper cost is a flat ₪/m² rate shared by all sizes of the same material
    // (magnetic paper for rollup_magnetic, synthetic paper for rollup_regular) —
    // it no longer varies per size row. Stand/mechanism cost is the opposite:
    // flat per unit, but specific to each size (bigger stands cost more).
    const isMagnetic = productType === 'rollup_magnetic';
    const paperCostPerSqm = isMagnetic
      ? (parseFloat(config.rollup_magnetic_paper_cost_per_sqm) || 0)
      : (parseFloat(config.rollup_synthetic_paper_cost_per_sqm) || 0);
    // Magnetic rollup applies paper to both sides (front print + back magnetic
    // strip surface) by default, so the paper area is doubled for this family only.
    const paperAreaMultiplier = isMagnetic ? 2 : 1;
    const standCost = parseFloat(tier.stand_cost) || 0;
    // Ink is a flat ₪/m² cost shared by every printed family (config.ink_cost) —
    // printed once (the front face), so unlike paper it never doubles for the
    // magnetic backing.
    const inkCost = (parseFloat(config.ink_cost) || 0) * rollupArea * Q;
    const rawMaterialBeforeWaste = (paperCostPerSqm * rollupArea * paperAreaMultiplier + standCost) * Q + inkCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    // Quantity-break pricing — the ₪/unit rate depends on the TOTAL quantity
    // ordered (1 / 2 / 3-or-more), and that single rate applies to every unit
    // in the order. This is NOT a marginal/incremental price per extra unit.
    const unitPriceForQty = Q === 1 ? (parseFloat(tier.price_unit_1) || 0)
      : Q === 2 ? (parseFloat(tier.price_unit_2) || 0)
      : (parseFloat(tier.price_unit_3_plus) || 0);
    const sellingPriceAll = unitPriceForQty * Q;
    const sellingPricePerUnit = unitPriceForQty;

    const overheadCost = rawMaterialCost * overheadPct;
    const salesAgentCommissionCost = sellingPriceAll * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPriceAll * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostAll = rawMaterialCost + overheadCost + salesAgentCommissionCost + marketingCommissionCost;

    const profitPerUnit = (sellingPriceAll - totalCostAll) / Q;
    const profitMarginPct = sellingPriceAll > 0 ? ((sellingPriceAll - totalCostAll) / sellingPriceAll) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    return {
      area: round(rollupArea),
      totalArea: round(rollupArea * Q),
      rollupSku: tier.sku,
      rollupDescription: tier.description,
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: 0,
      overheadCost: round(overheadCost),
      baseCost: round(rawMaterialCost + overheadCost),
      totalCostPerUnit: round(totalCostAll / Q),
      totalCostAll: round(totalCostAll),
      sellingPricePerUnit: round(sellingPricePerUnit),
      sellingPriceAll: round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: round(priceWithVat),
      extrasBreakdown: [],
      isSticker: false,
      isKapa: false,
      isRollup: true,
      productFamily: 'rollup',
      breakdown: {
        paperCostPerSqm: round(paperCostPerSqm),
        paperCost: round(paperCostPerSqm * rollupArea * paperAreaMultiplier * Q),
        inkCost: round(inkCost),
        paperAreaMultiplier,
        standCost: round(standCost * Q),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- GLASS PATH (extra clear, fixed-size catalog row × quantity) ---
  // Cost and selling price are both set directly per size (no per-sqm formula) —
  // glass sheets are bought pre-cut to size, so there's no cutting labor either.
  // Every unit ships with 4 spacers (baked into the cost, not an optional extra
  // like the logo family's spacers).
  if (isGlass) {
    const tier = glassTierId != null ? glassPriceTiers.find(t => String(t.id) === String(glassTierId)) : null;
    if (!tier) return null;

    const sheetCost = parseFloat(tier.cost_price) || 0;
    const spacersCost = 4 * (parseFloat(config.spacers_cost) || 0);
    const glassArea = (parseFloat(tier.width_cm) || 0) * (parseFloat(tier.height_cm) || 0) / 10000;
    // Ink is a flat ₪/m² cost shared by every printed family (config.ink_cost) —
    // glass is printed too (see printLaborCost below), so it needs the same
    // material line every other printed family has.
    const inkCost = (parseFloat(config.ink_cost) || 0) * glassArea * Q;
    const rawMaterialBeforeWaste = (sheetCost + spacersCost) * Q + inkCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const prePrintMinutes = parseFloat(config.glass_pre_print_time_minutes) || 0;
    const printMinutes = parseFloat(config.glass_print_time_minutes) || 0;
    const printLaborCost = ((prePrintMinutes + printMinutes) / 60) * printHourCost * Q;
    const laborCost = printLaborCost;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const sellingPricePerUnit = parseFloat(tier.selling_price) || 0;
    const sellingPriceAll = sellingPricePerUnit * Q;

    const salesAgentCommissionCost = sellingPriceAll * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPriceAll * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostAll = rawMaterialCost + laborCost + overheadCost + salesAgentCommissionCost + marketingCommissionCost;

    const profitPerUnit = (sellingPriceAll - totalCostAll) / Q;
    const profitMarginPct = sellingPriceAll > 0 ? ((sellingPriceAll - totalCostAll) / sellingPriceAll) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    return {
      area: round((parseFloat(tier.width_cm) || 0) * (parseFloat(tier.height_cm) || 0) / 10000),
      totalArea: round((parseFloat(tier.width_cm) || 0) * (parseFloat(tier.height_cm) || 0) / 10000 * Q),
      glassSku: tier.sku,
      glassDescription: tier.description,
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(rawMaterialCost + laborCost + overheadCost),
      totalCostPerUnit: round(totalCostAll / Q),
      totalCostAll: round(totalCostAll),
      sellingPricePerUnit: round(sellingPricePerUnit),
      sellingPriceAll: round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: round(priceWithVat),
      extrasBreakdown: [],
      isSticker: false,
      isKapa: false,
      isRollup: false,
      productFamily: 'glass',
      breakdown: {
        sheetCost: round(sheetCost * Q),
        spacersCost: round(spacersCost * Q),
        inkCost: round(inkCost),
        printLaborCost: round(printLaborCost),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- NUMBERS PATH (laser-cut digits, fixed price per unit by height+thickness) ---
  // No live material/labor cost model — like Kapa/Glass, the admin enters the
  // final ₪-per-digit directly in NumberPriceTable.jsx. The picker only ever
  // offers rows that already have a real price set (see CalculatorForm.jsx),
  // so `tier` is guaranteed to exist here — this mirrors the same
  // never-price-silently guarantee the other fixed-price families rely on.
  if (isNumbers) {
    const tier = numberTierId != null ? numberPriceTiers.find(t => String(t.id) === String(numberTierId)) : null;
    if (!tier) return null;

    const sellingPricePerUnit = Math.max(parseFloat(tier.price_per_unit) || 0, parseFloat(tier.min_price) || 0);
    const sellingPriceAll = sellingPricePerUnit * Q;

    const salesAgentCommissionCost = sellingPriceAll * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPriceAll * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostAll = salesAgentCommissionCost + marketingCommissionCost;

    const profitPerUnit = (sellingPriceAll - totalCostAll) / Q;
    const profitMarginPct = sellingPriceAll > 0 ? ((sellingPriceAll - totalCostAll) / sellingPriceAll) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    return {
      area: 0,
      totalArea: 0,
      numberHeightCm: tier.height_cm,
      numberThicknessMm: tier.thickness_mm,
      rawMaterialCost: 0,
      rawMaterialBeforeWaste: 0,
      wasteAmount: 0,
      laborCost: 0,
      overheadCost: 0,
      baseCost: 0,
      totalCostPerUnit: round(totalCostAll / Q),
      totalCostAll: round(totalCostAll),
      sellingPricePerUnit: round(sellingPricePerUnit),
      sellingPriceAll: round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: round(priceWithVat),
      extrasBreakdown: [],
      isSticker: false,
      isKapa: false,
      isRollup: false,
      productFamily: 'numbers',
      breakdown: {
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- STICKER PATH ---
  if (isSticker) {
    const prefix = productType === 'vinyl_sticker' ? 'vinyl' : 'texture';
    const materialOnlyCostPerSqm = parseFloat(config[`${prefix}_sticker_material_cost_per_sqm`]) || 0;
    const inkOnlyCostPerSqm = parseFloat(config.ink_cost) || 0;
    const materialCostPerSqm = materialOnlyCostPerSqm + inkOnlyCostPerSqm;
    const installCostPerSqm = parseFloat(config[`${prefix}_sticker_install_cost_per_sqm`]) || 0;
    const isSouth = region === 'דרום';
    const installMinCost = parseFloat(config[`${prefix}_sticker_install_min_cost${isSouth ? '_south' : ''}`]) || 0;
    const minPriceKey = `${prefix}_sticker_install_min_price${isSouth ? '_south' : ''}`;
    const installMinPrice = parseFloat(config[minPriceKey]) || 0;

    const printTimePerSqm = parseFloat(config[`${prefix}_sticker_print_time_per_sqm`]) || 0;
    const cutTimePerSqm = parseFloat(config[`${prefix}_sticker_cut_time_per_sqm`]) || 0;
    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const prePrintMinutes = parseFloat(config[`${prefix}_sticker_pre_print_time_minutes`]) || 0;
    const preCutMinutes = parseFloat(config[`${prefix}_sticker_pre_cut_time_minutes`]) || 0;

    const totalArea = area * Q;
    const materialOnlyCost = materialOnlyCostPerSqm * totalArea;
    const inkOnlyCost = inkOnlyCostPerSqm * totalArea;
    const materialBeforeWaste = materialOnlyCost + inkOnlyCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = materialBeforeWaste * wastePct;
    const rawMaterialCost = materialBeforeWaste + wasteAmount;
    const printLaborCost = ((prePrintMinutes + printTimePerSqm * totalArea) / 60) * printHourCost;
    const cutLaborCost = ((preCutMinutes + cutTimePerSqm * totalArea) / 60) * printHourCost;
    const laborCost = printLaborCost + cutLaborCost;
    const installCost = includeInstallation === 'no' ? 0 : Math.max(installCostPerSqm * totalArea, installMinCost);
    const overheadCost = (rawMaterialCost + laborCost + installCost) * overheadPct;
    const baseCost = rawMaterialCost + laborCost + installCost + overheadCost;

    const stickerPricePerSqm = parseFloat(config[`${prefix}_sticker_price_per_sqm`]) || 0;
    const stickerPriceRaw = stickerPricePerSqm * totalArea;
    const minStickerPrice = parseFloat(config[`${prefix}_sticker_min_price`]) || 0;
    const stickerPrice = enforceMinimumPrice ? Math.max(stickerPriceRaw, minStickerPrice) : stickerPriceRaw;

    const installPricePerSqm = parseFloat(config[`${prefix}_sticker_install_price_per_sqm`]) || 0;
    const installPriceRaw = installPricePerSqm * totalArea;
    const installPrice = includeInstallation === 'no' ? 0 : (enforceMinimumPrice ? Math.max(installPriceRaw, installMinPrice) : installPriceRaw);

    const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
    const sellingPriceAll = stickerPrice + installPrice + shippingCost;

    const salesAgentCommissionCost = sellingPriceAll * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPriceAll * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost + shippingCost;

    const profitPerUnit = sellingPriceAll - totalCostPerUnit;
    const profitMarginPct = sellingPriceAll > 0 ? (profitPerUnit / sellingPriceAll) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    return {
      area: round(area),
      totalArea: round(totalArea),
      stickerOnlyPrice: round(stickerPrice),
      rawMaterialCost: round(rawMaterialCost),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(baseCost),
      totalCostPerUnit: round(totalCostPerUnit),
      totalCostAll: round(totalCostPerUnit),
      sellingPricePerUnit: round(sellingPriceAll),
      sellingPriceAll: round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: round(priceWithVat),
      paintSellingSurcharge: 0,
      extrasBreakdown: [],
      isSticker: true,
      productFamily: 'sticker',
      breakdown: {
        boardCost: 0,
        inkCost: 0,
        dowelCost: 0,
        packagingCost: 0,
        instructionCost: 0,
        mountingCost: 0,
        printLaborCost: 0,
        laserLaborCost: 0,
        somaLaborCost: 0,
        packagingLaborCost: 0,
        paintRoomCost: 0,
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
        stickerMaterialCost: round(materialOnlyCost),
        stickerInkCost: round(inkOnlyCost),
        stickerMaterialBeforeWaste: round(materialBeforeWaste),
        stickerWasteAmount: round(wasteAmount),
        installationCost: round(installPrice),
        stickerInstallCost: round(installCost),
        stickerPrintLaborCost: round(printLaborCost),
        stickerCutLaborCost: round(cutLaborCost),
        stickerSellingPrice: round(sellingPriceAll),
        installationSellingPrice: 0,
      }
    };
  }

  // --- LOKOBOND PATH (005) — thickness fixed at 3mm; cut/clean cost is per linear
  // meter (מ"א, board perimeter × elements), not per m² like the logo laser/soma cut ---
  if (isLokobond) {
    const isDiecut = productType === 'lokobond_diecut';
    const materialCostPerSqm = parseFloat(config.lokobond_cost_per_sqm) || 0;
    const boardCost = materialCostPerSqm * area;
    // Lokobond is digitally printed just like the logo family — same shared
    // ink rate applies, it just wasn't wired in here before.
    const inkCost = (parseFloat(config.ink_cost) || 0) * area;

    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
    // Pre-print and packaging are both "per 3 m² tier" — every 3 m² (or part of)
    // needs another full pre-print/packaging pass (e.g. re-loading the press).
    const areaTierUnits = Math.max(1, Math.ceil(area / 3));
    const prePrintMinutes = (parseFloat(config.lokobond_pre_print_time_minutes) || 0) * areaTierUnits;
    const printMinutesPerSqm = parseFloat(config.lokobond_print_time_per_sqm_minutes) || 0;
    const printLaborCost = ((prePrintMinutes + printMinutesPerSqm * area) / 60) * printHourCost;
    const packagingMinutes = (parseFloat(config.lokobond_packaging_time_minutes) || 0) * areaTierUnits;
    const packagingLaborCost = (packagingMinutes / 60) * workerHourCost;

    const perimeterPerElement = 2 * ((W || 0) + (H || 0));
    const numElements = parseFloat(elements) || 1;
    const totalLinearMeters = perimeterPerElement * numElements;

    const preCutMinutes = parseFloat(config.lokobond_pre_cut_time_minutes) || 0;
    const preCutLaborCost = (preCutMinutes / 60) * printHourCost;
    const cutRateKey = isDiecut ? 'lokobond_cut_time_per_linear_meter_minutes_diecut' : 'lokobond_cut_time_per_linear_meter_minutes_plain';
    const cutMinutesPerMeter = parseFloat(config[cutRateKey]) || 0;
    const cutLaborCost = (cutMinutesPerMeter * totalLinearMeters / 60) * printHourCost;

    const cleanMinutesPerMeter = parseFloat(config.lokobond_clean_time_per_linear_meter_minutes) || 0;
    const cleanLaborCost = (cleanMinutesPerMeter * totalLinearMeters / 60) * printHourCost;

    const laborCost = printLaborCost + preCutLaborCost + cutLaborCost + cleanLaborCost + packagingLaborCost;
    const rawMaterialBeforeWaste = boardCost + inkCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const baseCost = rawMaterialCost + laborCost + overheadCost;

    // Area-tiered pricing ("from X m² and up, price is Y/m²") takes priority over
    // the flat price_per_sqm tier when rows exist for this product type — pick the
    // highest area_from that the actual ORDER has reached or passed. This is a bulk
    // discount: it's the total lokobond area across the WHOLE quote (every lokobond
    // line item, regardless of thickness/diecut-vs-plain) that counts, not a single
    // panel's area — a single sign is rarely 15+ m² on its own, but an order of many
    // smaller signs commonly is. orderAreaOverride (summed across line items by the
    // multi-product screen) takes priority; a standalone call (e.g. admin test tool)
    // falls back to just this line's own unit area × quantity.
    const totalOrderArea = orderAreaOverride != null ? orderAreaOverride : area * Q;
    const areaTiersForType = lokobondAreaTiers
      .filter(t => t.product_type === productType)
      .sort((a, b) => (parseFloat(b.area_from) || 0) - (parseFloat(a.area_from) || 0));
    const matchedAreaTier = areaTiersForType.find(t => totalOrderArea >= (parseFloat(t.area_from) || 0));

    const tier = priceTiers.find(t => t.product_type === productType && String(t.thickness_mm) === "3");
    let sellingPricePerUnit;
    let priceMissing = false;
    let priceRangeMin = null, priceRangeMax = null, effectivePricePerSqm = null;
    if (matchedAreaTier) {
      const startingPrice = parseFloat(matchedAreaTier.price_per_sqm) || 0;
      effectivePricePerSqm = clampAgentPricePerSqm(startingPrice, matchedAreaTier.agent_min_price_per_sqm, customPricePerSqm);
      priceRangeMax = startingPrice;
      priceRangeMin = (parseFloat(matchedAreaTier.agent_min_price_per_sqm) || 0) > 0 ? parseFloat(matchedAreaTier.agent_min_price_per_sqm) : startingPrice;
      let priceFromAreaTier = effectivePricePerSqm * area;
      const areaTierMinPrice = parseFloat(matchedAreaTier.min_price) || 0;
      if (enforceMinimumPrice && areaTierMinPrice && priceFromAreaTier < areaTierMinPrice) priceFromAreaTier = areaTierMinPrice;
      sellingPricePerUnit = priceFromAreaTier;
    } else if (tier && tier.price_per_sqm) {
      const startingPrice = tier.price_per_sqm;
      effectivePricePerSqm = clampAgentPricePerSqm(startingPrice, tier.agent_min_price_per_sqm, customPricePerSqm);
      priceRangeMax = startingPrice;
      priceRangeMin = (parseFloat(tier.agent_min_price_per_sqm) || 0) > 0 ? parseFloat(tier.agent_min_price_per_sqm) : startingPrice;
      let priceFromTier = effectivePricePerSqm * area;
      if (enforceMinimumPrice && tier.min_price && priceFromTier < tier.min_price) priceFromTier = tier.min_price;
      sellingPricePerUnit = priceFromTier;
    } else {
      // No matching price tier for this product/thickness — do NOT silently
      // sell at raw cost. Surface this as an explicit pricing error instead;
      // the UI shows it and blocks the quote until an admin sets a price.
      sellingPricePerUnit = baseCost;
      priceMissing = true;
    }

    const salesAgentCommissionCost = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost;
    const totalCostAll = totalCostPerUnit * Q;
    const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
    const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
    const profitPerUnit = sellingPricePerUnit - totalCostPerUnit;
    const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    const extrasBreakdown = [];
    if (shippingCost > 0) extrasBreakdown.push({ key: 'shipping', label: 'משלוח', cost: round(shippingCost), sellingCost: round(shippingCost), calc: `${round(shippingCost)} ₪ קבוע`, type: 'material' });

    return {
      area: round(area),
      totalArea: round(area * Q),
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(baseCost),
      totalCostPerUnit: round(totalCostPerUnit),
      totalCostAll: round(totalCostAll + shippingCost),
      priceMissing,
      errorMessage: priceMissing ? 'לא הוגדר מחיר מכירה למוצר/עובי זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.' : null,
      sellingPricePerUnit: priceMissing ? null : round(sellingPricePerUnit),
      sellingPriceAll: priceMissing ? null : round(sellingPriceAll),
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: priceMissing ? null : round(priceWithVat),
      isSticker: false,
      isKapa: false,
      productFamily: 'lokobond',
      priceRangeMin: priceRangeMin != null ? round(priceRangeMin) : null,
      priceRangeMax: priceRangeMax != null ? round(priceRangeMax) : null,
      effectivePricePerSqm: effectivePricePerSqm != null ? round(effectivePricePerSqm) : null,
      extrasBreakdown,
      breakdown: {
        boardCost: round(boardCost),
        inkCost: round(inkCost),
        totalLinearMeters: round(totalLinearMeters),
        areaTierUnits,
        isDiecut,
        matchedAreaTierPricePerSqm: matchedAreaTier ? round(parseFloat(matchedAreaTier.price_per_sqm) || 0) : null,
        matchedAreaTierAreaFrom: matchedAreaTier ? round(parseFloat(matchedAreaTier.area_from) || 0) : null,
        matchedAreaTierMinPrice: matchedAreaTier ? round(parseFloat(matchedAreaTier.min_price) || 0) : null,
        flatTierPricePerSqm: tier ? round(parseFloat(tier.price_per_sqm) || 0) : null,
        flatTierMinPrice: tier ? round(parseFloat(tier.min_price) || 0) : null,
        printLaborCost: round(printLaborCost),
        preCutLaborCost: round(preCutLaborCost),
        cutLaborCost: round(cutLaborCost),
        cleanLaborCost: round(cleanLaborCost),
        packagingLaborCost: round(packagingLaborCost),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- FOAMEX PATH (006) — thickness varies (2/3/5mm); cut/clean cost per linear meter (מ"א) ---
  if (isFoamex) {
    const T = parseFloat(thicknessMm) || 0;
    const materialCostKey = productType === 'foamex_black' ? 'foamex_black_cost_per_mm' : 'foamex_white_cost_per_mm';
    const materialCostPerMmPerSqm = parseFloat(config[materialCostKey]) || 0;
    const boardCost = materialCostPerMmPerSqm * T * area;
    // Foamex is digitally printed just like the logo family — same shared
    // ink rate applies, it just wasn't wired in here before.
    const inkCost = (parseFloat(config.ink_cost) || 0) * area;

    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
    // Pre-print and packaging are both "per 3 m² tier" — every 3 m² (or part of)
    // needs another full pre-print/packaging pass (e.g. re-loading the press).
    const areaTierUnits = Math.max(1, Math.ceil(area / 3));
    const prePrintMinutes = (parseFloat(config.foamex_pre_print_time_minutes) || 0) * areaTierUnits;
    const printMinutesPerSqm = parseFloat(config.foamex_print_time_per_sqm_minutes) || 0;
    const printLaborCost = ((prePrintMinutes + printMinutesPerSqm * area) / 60) * printHourCost;
    const packagingMinutes = (parseFloat(config.foamex_packaging_time_minutes) || 0) * areaTierUnits;
    const packagingLaborCost = (packagingMinutes / 60) * workerHourCost;

    const perimeterPerElement = 2 * ((W || 0) + (H || 0));
    const numElements = parseFloat(elements) || 1;
    const totalLinearMeters = perimeterPerElement * numElements;

    const thicknessKey = String(thicknessMm).replace(/\.0$/, '');
    const preCutMinutes = parseFloat(config.foamex_pre_cut_time_minutes) || 0;
    const preCutLaborCost = (preCutMinutes / 60) * printHourCost;
    const cutMinutesPerMeter = parseFloat(config[`foamex_cut_time_per_linear_meter_minutes_${thicknessKey}`]) || 0;
    const cutLaborCost = (cutMinutesPerMeter * totalLinearMeters / 60) * printHourCost;
    // Cleaning rate is shared across all thicknesses (same as Lokobond) — no per-thickness split.
    const cleanMinutesPerMeter = parseFloat(config.foamex_clean_time_per_linear_meter_minutes) || 0;
    const cleanLaborCost = (cleanMinutesPerMeter * totalLinearMeters / 60) * printHourCost;

    const laborCost = printLaborCost + preCutLaborCost + cutLaborCost + cleanLaborCost + packagingLaborCost;
    const rawMaterialBeforeWaste = boardCost + inkCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const baseCost = rawMaterialCost + laborCost + overheadCost;

    const tier = priceTiers.find(t => t.product_type === productType && String(t.thickness_mm) === String(thicknessMm));
    let sellingPricePerUnit;
    let priceMissing = false;
    let priceRangeMin = null, priceRangeMax = null, effectivePricePerSqm = null;
    if (tier && tier.price_per_sqm) {
      const startingPrice = tier.price_per_sqm;
      effectivePricePerSqm = clampAgentPricePerSqm(startingPrice, tier.agent_min_price_per_sqm, customPricePerSqm);
      priceRangeMax = startingPrice;
      priceRangeMin = (parseFloat(tier.agent_min_price_per_sqm) || 0) > 0 ? parseFloat(tier.agent_min_price_per_sqm) : startingPrice;
      let priceFromTier = effectivePricePerSqm * area;
      if (enforceMinimumPrice && tier.min_price && priceFromTier < tier.min_price) priceFromTier = tier.min_price;
      sellingPricePerUnit = priceFromTier;
    } else {
      // No matching price tier for this product/thickness — do NOT silently
      // sell at raw cost. Surface this as an explicit pricing error instead;
      // the UI shows it and blocks the quote until an admin sets a price.
      sellingPricePerUnit = baseCost;
      priceMissing = true;
    }

    const salesAgentCommissionCost = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost;
    const totalCostAll = totalCostPerUnit * Q;
    const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
    const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
    const profitPerUnit = sellingPricePerUnit - totalCostPerUnit;
    const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    const extrasBreakdown = [];
    if (shippingCost > 0) extrasBreakdown.push({ key: 'shipping', label: 'משלוח', cost: round(shippingCost), sellingCost: round(shippingCost), calc: `${round(shippingCost)} ₪ קבוע`, type: 'material' });

    return {
      area: round(area),
      totalArea: round(area * Q),
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(baseCost),
      totalCostPerUnit: round(totalCostPerUnit),
      totalCostAll: round(totalCostAll + shippingCost),
      priceMissing,
      errorMessage: priceMissing ? 'לא הוגדר מחיר מכירה למוצר/עובי זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.' : null,
      sellingPricePerUnit: priceMissing ? null : round(sellingPricePerUnit),
      sellingPriceAll: priceMissing ? null : round(sellingPriceAll),
      priceRangeMin: priceRangeMin != null ? round(priceRangeMin) : null,
      priceRangeMax: priceRangeMax != null ? round(priceRangeMax) : null,
      effectivePricePerSqm: effectivePricePerSqm != null ? round(effectivePricePerSqm) : null,
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: priceMissing ? null : round(priceWithVat),
      isSticker: false,
      isKapa: false,
      productFamily: 'foamex',
      extrasBreakdown,
      breakdown: {
        boardCost: round(boardCost),
        inkCost: round(inkCost),
        materialCostPerMmPerSqm: round(materialCostPerMmPerSqm),
        thickness_mm: T,
        totalLinearMeters: round(totalLinearMeters),
        areaTierUnits,
        printLaborCost: round(printLaborCost),
        preCutLaborCost: round(preCutLaborCost),
        cutLaborCost: round(cutLaborCost),
        cleanLaborCost: round(cleanLaborCost),
        packagingLaborCost: round(packagingLaborCost),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- PERSPEX BOARD PATH (010) — same shape as Foamex: thickness varies (3/5/10mm);
  // cut/clean cost per linear meter (מ"א); own material costs + own time-cost config keys. ---
  if (isPerspexBoard) {
    const T = parseFloat(thicknessMm) || 0;
    const materialCostKey = PERSPEX_BOARD_MATERIAL_COST_KEY_BY_PRODUCT_TYPE[productType] || "perspex_board_clear_print_cost_per_mm";
    const materialCostPerMmPerSqm = parseFloat(config[materialCostKey]) || 0;
    const boardCost = materialCostPerMmPerSqm * T * area;
    const inkCost = (parseFloat(config.ink_cost) || 0) * area;

    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
    const areaTierUnits = Math.max(1, Math.ceil(area / 3));
    const prePrintMinutes = (parseFloat(config.perspex_board_pre_print_time_minutes) || 0) * areaTierUnits;
    const printMinutesPerSqm = parseFloat(config.perspex_board_print_time_per_sqm_minutes) || 0;
    const printLaborCost = ((prePrintMinutes + printMinutesPerSqm * area) / 60) * printHourCost;
    const packagingMinutes = (parseFloat(config.perspex_board_packaging_time_minutes) || 0) * areaTierUnits;
    const packagingLaborCost = (packagingMinutes / 60) * workerHourCost;

    const perimeterPerElement = 2 * ((W || 0) + (H || 0));
    const numElements = parseFloat(elements) || 1;
    const totalLinearMeters = perimeterPerElement * numElements;

    const thicknessKey = String(thicknessMm).replace(/\.0$/, '');
    const preCutMinutes = parseFloat(config.perspex_board_pre_cut_time_minutes) || 0;
    const preCutLaborCost = (preCutMinutes / 60) * printHourCost;
    const cutMinutesPerMeter = parseFloat(config[`perspex_board_cut_time_per_linear_meter_minutes_${thicknessKey}`]) || 0;
    const cutLaborCost = (cutMinutesPerMeter * totalLinearMeters / 60) * printHourCost;
    const cleanMinutesPerMeter = parseFloat(config.perspex_board_clean_time_per_linear_meter_minutes) || 0;
    const cleanLaborCost = (cleanMinutesPerMeter * totalLinearMeters / 60) * printHourCost;

    const laborCost = printLaborCost + preCutLaborCost + cutLaborCost + cleanLaborCost + packagingLaborCost;
    const rawMaterialBeforeWaste = boardCost + inkCost;
    const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
    const wasteAmount = rawMaterialBeforeWaste * wastePct;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const baseCost = rawMaterialCost + laborCost + overheadCost;

    const tier = priceTiers.find(t => t.product_type === productType && String(t.thickness_mm) === String(thicknessMm));
    let sellingPricePerUnit;
    let priceMissing = false;
    let priceRangeMin = null, priceRangeMax = null, effectivePricePerSqm = null;
    if (tier && tier.price_per_sqm) {
      const startingPrice = tier.price_per_sqm;
      effectivePricePerSqm = clampAgentPricePerSqm(startingPrice, tier.agent_min_price_per_sqm, customPricePerSqm);
      priceRangeMax = startingPrice;
      priceRangeMin = (parseFloat(tier.agent_min_price_per_sqm) || 0) > 0 ? parseFloat(tier.agent_min_price_per_sqm) : startingPrice;
      let priceFromTier = effectivePricePerSqm * area;
      if (enforceMinimumPrice && tier.min_price && priceFromTier < tier.min_price) priceFromTier = tier.min_price;
      sellingPricePerUnit = priceFromTier;
    } else {
      // No matching price tier for this product/thickness — do NOT silently
      // sell at raw cost. Surface this as an explicit pricing error instead;
      // the UI shows it and blocks the quote until an admin sets a price.
      sellingPricePerUnit = baseCost;
      priceMissing = true;
    }

    const salesAgentCommissionCost = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost;
    const totalCostAll = totalCostPerUnit * Q;
    const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
    const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
    const profitPerUnit = sellingPricePerUnit - totalCostPerUnit;
    const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    const extrasBreakdown = [];
    if (shippingCost > 0) extrasBreakdown.push({ key: 'shipping', label: 'משלוח', cost: round(shippingCost), sellingCost: round(shippingCost), calc: `${round(shippingCost)} ₪ קבוע`, type: 'material' });

    return {
      area: round(area),
      totalArea: round(area * Q),
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(baseCost),
      totalCostPerUnit: round(totalCostPerUnit),
      totalCostAll: round(totalCostAll + shippingCost),
      priceMissing,
      errorMessage: priceMissing ? 'לא הוגדר מחיר מכירה למוצר/עובי זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.' : null,
      sellingPricePerUnit: priceMissing ? null : round(sellingPricePerUnit),
      sellingPriceAll: priceMissing ? null : round(sellingPriceAll),
      priceRangeMin: priceRangeMin != null ? round(priceRangeMin) : null,
      priceRangeMax: priceRangeMax != null ? round(priceRangeMax) : null,
      effectivePricePerSqm: effectivePricePerSqm != null ? round(effectivePricePerSqm) : null,
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: priceMissing ? null : round(priceWithVat),
      isSticker: false,
      isKapa: false,
      productFamily: 'perspexBoard',
      extrasBreakdown,
      breakdown: {
        boardCost: round(boardCost),
        inkCost: round(inkCost),
        materialCostPerMmPerSqm: round(materialCostPerMmPerSqm),
        thickness_mm: T,
        totalLinearMeters: round(totalLinearMeters),
        areaTierUnits,
        printLaborCost: round(printLaborCost),
        preCutLaborCost: round(preCutLaborCost),
        cutLaborCost: round(cutLaborCost),
        cleanLaborCost: round(cleanLaborCost),
        packagingLaborCost: round(packagingLaborCost),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- PVC CARPET PATH (013) — sold off a fixed-width roll. An order whose
  // width isn't an exact multiple of the roll width still needs full roll-widths
  // laid side by side, so the material actually consumed (and its cost) is
  // rounded up to the tiled width, not the ordered width. The customer pays the
  // normal ₪/m² tier price for the area they ordered, PLUS a separate charge for
  // the wasted strip — billed at cost, not retail, times an admin-configurable
  // multiplier (so the shop isn't just eating the offcut, but isn't marking it
  // up at full margin either).
  if (isPvcCarpet) {
    const materialCostPerSqm = parseFloat(config.pvc_carpet_cost_per_sqm) || 0;
    const rollWidthM = parseFloat(config.pvc_carpet_roll_width_m) || 0;
    const wasteMultiplier = parseFloat(config.pvc_carpet_waste_multiplier) || 1;

    const rollWidthsNeeded = rollWidthM > 0 ? Math.ceil((W || 0) / rollWidthM) : 1;
    const tiledWidthM = rollWidthM > 0 ? rollWidthsNeeded * rollWidthM : (W || 0);
    const wasteWidthM = Math.max(0, tiledWidthM - (W || 0));
    const wasteAreaSqm = wasteWidthM * (H || 0);

    // Ink is a flat ₪/m² cost shared by every printed family (config.ink_cost) —
    // pvc carpet is printed too (see printLaborCost below), so it needs the
    // same material line every other printed family has. Charged on the
    // ordered area only, not the wasted roll offcut — nothing is printed there.
    const inkCost = (parseFloat(config.ink_cost) || 0) * area;
    const rawMaterialBeforeWaste = materialCostPerSqm * area + inkCost;
    const wasteAmount = materialCostPerSqm * wasteAreaSqm;
    const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;

    // Labor — same shape as foamex/lokobond (prep+processing per m², pre-cut once
    // per unit, cut+clean per linear meter, packaging per area-tier), just without
    // a thickness split (this product has one fixed thickness) or a per-element
    // perimeter (a carpet order is always one rectangle, not several cut shapes).
    const printHourCost = parseFloat(config.print_hour_cost) || 0;
    const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
    const areaTierUnits = Math.max(1, Math.ceil(area / 3));
    const prePrintMinutes = (parseFloat(config.pvc_carpet_pre_print_time_minutes) || 0) * areaTierUnits;
    const printMinutesPerSqm = parseFloat(config.pvc_carpet_print_time_per_sqm_minutes) || 0;
    const printLaborCost = ((prePrintMinutes + printMinutesPerSqm * area) / 60) * printHourCost;
    const packagingMinutes = (parseFloat(config.pvc_carpet_packaging_time_minutes) || 0) * areaTierUnits;
    const packagingLaborCost = (packagingMinutes / 60) * workerHourCost;

    const totalLinearMeters = 2 * ((W || 0) + (H || 0));
    const preCutMinutes = parseFloat(config.pvc_carpet_pre_cut_time_minutes) || 0;
    const preCutLaborCost = (preCutMinutes / 60) * printHourCost;
    const cutMinutesPerMeter = parseFloat(config.pvc_carpet_cut_time_per_linear_meter_minutes) || 0;
    const cutLaborCost = (cutMinutesPerMeter * totalLinearMeters / 60) * printHourCost;
    const cleanMinutesPerMeter = parseFloat(config.pvc_carpet_clean_time_per_linear_meter_minutes) || 0;
    const cleanLaborCost = (cleanMinutesPerMeter * totalLinearMeters / 60) * printHourCost;

    const laborCost = printLaborCost + preCutLaborCost + cutLaborCost + cleanLaborCost + packagingLaborCost;

    const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
    const baseCost = rawMaterialCost + laborCost + overheadCost;

    const tier = priceTiers.find(t => t.product_type === productType && String(t.thickness_mm) === String(thicknessMm));
    let sellingPricePerUnit;
    let priceMissing = false;
    let priceRangeMin = null, priceRangeMax = null, effectivePricePerSqm = null;
    let wasteCharge = 0;
    if (tier && tier.price_per_sqm) {
      const startingPrice = tier.price_per_sqm;
      effectivePricePerSqm = clampAgentPricePerSqm(startingPrice, tier.agent_min_price_per_sqm, customPricePerSqm);
      priceRangeMax = startingPrice;
      priceRangeMin = (parseFloat(tier.agent_min_price_per_sqm) || 0) > 0 ? parseFloat(tier.agent_min_price_per_sqm) : startingPrice;
      let priceFromTier = effectivePricePerSqm * area;
      if (enforceMinimumPrice && tier.min_price && priceFromTier < tier.min_price) priceFromTier = tier.min_price;
      wasteCharge = wasteAmount * wasteMultiplier;
      sellingPricePerUnit = priceFromTier + wasteCharge;
    } else {
      // No matching price tier for this product/thickness — do NOT silently
      // sell at raw cost. Surface this as an explicit pricing error instead;
      // the UI shows it and blocks the quote until an admin sets a price.
      sellingPricePerUnit = baseCost;
      priceMissing = true;
    }

    const salesAgentCommissionCost = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
    const marketingCommissionCost = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
    const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost;
    const totalCostAll = totalCostPerUnit * Q;
    const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
    const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
    const profitPerUnit = sellingPricePerUnit - totalCostPerUnit;
    const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
    const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

    const extrasBreakdown = [];
    if (shippingCost > 0) extrasBreakdown.push({ key: 'shipping', label: 'משלוח', cost: round(shippingCost), sellingCost: round(shippingCost), calc: `${round(shippingCost)} ₪ קבוע`, type: 'material' });

    return {
      area: round(area),
      totalArea: round(area * Q),
      rawMaterialCost: round(rawMaterialCost),
      rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
      wasteAmount: round(wasteAmount),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      baseCost: round(baseCost),
      totalCostPerUnit: round(totalCostPerUnit),
      totalCostAll: round(totalCostAll + shippingCost),
      priceMissing,
      errorMessage: priceMissing ? 'לא הוגדר מחיר מכירה למוצר זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.' : null,
      sellingPricePerUnit: priceMissing ? null : round(sellingPricePerUnit),
      sellingPriceAll: priceMissing ? null : round(sellingPriceAll),
      priceRangeMin: priceRangeMin != null ? round(priceRangeMin) : null,
      priceRangeMax: priceRangeMax != null ? round(priceRangeMax) : null,
      effectivePricePerSqm: effectivePricePerSqm != null ? round(effectivePricePerSqm) : null,
      profitPerUnit: round(profitPerUnit),
      profitMarginPct: round(profitMarginPct),
      priceWithVat: priceMissing ? null : round(priceWithVat),
      isSticker: false,
      isKapa: false,
      productFamily: 'pvcCarpet',
      extrasBreakdown,
      breakdown: {
        rollWidthM,
        rollWidthsNeeded,
        tiledWidthM: round(tiledWidthM),
        wasteWidthM: round(wasteWidthM),
        wasteAreaSqm: round(wasteAreaSqm),
        wasteCharge: round(wasteCharge),
        inkCost: round(inkCost),
        materialCostPerSqm,
        totalLinearMeters: round(totalLinearMeters),
        areaTierUnits,
        printLaborCost: round(printLaborCost),
        preCutLaborCost: round(preCutLaborCost),
        cutLaborCost: round(cutLaborCost),
        cleanLaborCost: round(cleanLaborCost),
        packagingLaborCost: round(packagingLaborCost),
        salesAgentCommissionCost: round(salesAgentCommissionCost),
        marketingCommissionCost: round(marketingCommissionCost),
      },
    };
  }

  // --- PVC / PERSPEX PATH ---
  const T = parseFloat(thicknessMm);
  const materialCostKey = MATERIAL_COST_KEY_BY_PRODUCT_TYPE[productType] || "pvc_white_cost_per_mm";
  const materialCostPerMmPerSqm = parseFloat(config[materialCostKey]) || 0;
  const boardCost = materialCostPerMmPerSqm * T * area;
  const inkCost = (parseFloat(config.ink_cost) || 0) * area;
  const dowelCost = (parseFloat(config.dowel_cost_per_sqm) || 0) * area;
  const packagingCost = parseFloat(config.packaging_cost) || 0;
  const instructionCost = parseFloat(config.instruction_sheet_cost) || 0;
  const mountingCost = parseFloat(config.mounting_board_cost) || 0;
  const printHourCost = parseFloat(config.print_hour_cost) || 0;
  const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
  const prePrintMinutes = parseFloat(config.logo_pre_print_time_minutes) || 0;
  const printMinutesPerSqm = parseFloat(config.logo_print_time_per_sqm_minutes) || 0;
  const totalPrintMinutes = prePrintMinutes + printMinutesPerSqm * area;
  const printLaborCost = (totalPrintMinutes / 60) * printHourCost;
  const isPerspex = productType.startsWith('perspex');
  const thicknessKey = String(thicknessMm).replace(/\.0$/, '');
  const preCutMinutes = parseFloat(config.logo_pre_cut_time_minutes) || 0;
  const preCutLaborCost = (preCutMinutes / 60) * printHourCost;
  const laserCutMinutes = parseFloat(config[`logo_laser_cut_time_minutes_${thicknessKey}`]) || 0;
  const laserLaborCost = isPerspex ? (laserCutMinutes * area / 60) * printHourCost : 0;
  const somaCutMinutes = parseFloat(config[`logo_soma_cut_time_minutes_${thicknessKey}`]) || 0;
  const somaLaborCost = isPerspex ? 0 : (somaCutMinutes * area / 60) * printHourCost;
  const packagingMinutes = parseFloat(config.logo_packaging_time_minutes) || 0;
  const packagingLaborCost = (packagingMinutes / 60) * workerHourCost;
  // paint_room_cost is a direct ₪/m² rate (labeled that way in the admin costs
  // screen and in the tooltip that explains this line) — not minutes, so it's
  // applied straight against area, no hourly-rate conversion.
  const paintRoomCostPerSqm = parseFloat(config.paint_room_cost) || 0;
  const paintRoomLaborCost = paintRoomCostPerSqm * area;
  const spacersPerElement = parseFloat(config.spacers_per_element) || 1;
  const numElements = parseFloat(elements) || 1;
  const totalSpacers = spacersPerElement * numElements;
  const extraSpacersCost = extras.includes('spacers') || extras.includes('hidden_spacers') ? (parseFloat(config.spacers_cost) || 0) * totalSpacers : 0;
  const extraSpacers = extraSpacersCost;
  const extraPaintCost = (extras.includes('paint_single') || extras.includes('paint_double')) ? paintRoomLaborCost : 0;
  const paintRoomCost = extraPaintCost;
  const sprayPerSqm = parseFloat(config.spray_paint_per_sqm) || 0;
  const numSprays = Math.max(sprayPerSqm, sprayPerSqm * area);
  const sprayUnitCost = (parseFloat(config.spray_paint_cost) || 0) * numSprays;
  const extraSprayCost = (extras.includes('paint_single') || extras.includes('paint_double')) ? sprayUnitCost : 0;
  const rawMaterialBeforeWaste = boardCost + inkCost + dowelCost + packagingCost + instructionCost + mountingCost + extraSprayCost + extraSpacers;
  const wastePct = (parseFloat(config.raw_material_waste_percent) || 0) / 100;
  const wasteAmount = rawMaterialBeforeWaste * wastePct;
  const rawMaterialCost = rawMaterialBeforeWaste + wasteAmount;
  const spacersCalc = `${round(parseFloat(config.spacers_cost)||0)} ₪/יחידה × ${round(spacersPerElement)} ספייסרים × ${round(numElements)} אלמנטים = ${round(extraSpacers)} ₪`;
  const sprayPricePerUnit = parseFloat(config.spray_paint_cost) || 0;
  const sprayCalc = `${round(sprayPricePerUnit)} ₪/יח × ${round(numSprays)} יח`;
  // Selling-side surcharge for spacers extras — priced per logo element (not per
  // spacer unit), set in the admin "תוספת ספייסרים" section next to the paint surcharge.
  const spacersSellingPricePerElement = parseFloat(config.spacers_selling_price_per_element) || 0;
  const spacersSellingSurcharge = (extras.includes('spacers') || extras.includes('hidden_spacers'))
    ? spacersSellingPricePerElement * numElements
    : 0;
  const spacersSellingCalc = `${round(spacersSellingPricePerElement)} ₪/אלמנט × ${round(numElements)} אלמנטים`;
  const extrasBreakdown = [];
  if (extras.includes('spacers')) extrasBreakdown.push({ key: 'spacers', label: 'ספייסרים', cost: round(extraSpacers), sellingCost: round(spacersSellingSurcharge), calc: spacersCalc, sellingCalc: spacersSellingCalc, type: 'material' });
  if (extras.includes('hidden_spacers')) extrasBreakdown.push({ key: 'hidden_spacers', label: 'ספייסרים נסתרים', cost: round(extraSpacers), sellingCost: round(spacersSellingSurcharge), calc: spacersCalc, sellingCalc: spacersSellingCalc, type: 'material' });
  const laborCost = printLaborCost + preCutLaborCost + laserLaborCost + somaLaborCost + packagingLaborCost + paintRoomCost;
  const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
  const baseCost = rawMaterialCost + laborCost + overheadCost;
  const tier = priceTiers.find(
    (t) => t.product_type === productType && String(t.thickness_mm) === String(thicknessMm)
  );
  let sellingPricePerUnit;
  let priceMissing = false;
  let paintSellingSurcharge = 0;
  let paintSurchargeCalc = '';
  if (extras.includes('paint_single') || extras.includes('paint_double')) {
    const paintType = extras.includes('paint_single') ? 'single_color' : 'dual_color';
    const relevantTiers = paintSurchargeTiers.filter(t => t.paint_type === paintType).sort((a, b) => a.area_from - b.area_from);
    const baseTier = relevantTiers[0];
    const stepTiers = relevantTiers.slice(1);
    if (baseTier) {
      const baseSurcharge = parseFloat(baseTier.surcharge) || 0;
      if (area <= 0.8) {
        paintSellingSurcharge = baseSurcharge / 0.95;
        paintSurchargeCalc = `בסיס עד 0.8 מ"ר = ${round(baseSurcharge / 0.95)} ₪`;
      } else {
        paintSellingSurcharge = (baseSurcharge / 0.95);
        const excessArea = area - 0.8;
        const numSteps = Math.ceil(excessArea / 0.3);
        const parts = [`בסיס = ${round(baseSurcharge / 0.95)} ₪`];
        const stepTier = stepTiers[0];
        const stepSurcharge = stepTier ? parseFloat(stepTier.surcharge) / 0.95 || 0 : 0;
        for (let i = 0; i < numSteps; i++) {
          paintSellingSurcharge += stepSurcharge;
          parts.push(`מדרגה ${i + 1} = ${round(stepSurcharge)} ₪`);
        }
        paintSurchargeCalc = parts.join(' + ');
      }
    }
    if (extras.includes('paint_single')) extrasBreakdown.push({ key: 'paint_single', label: 'ספריי צביעה - גוון יחיד', cost: round(extraSprayCost), sellingCost: round(paintSellingSurcharge), calc: sprayCalc, type: 'material' });
    if (extras.includes('paint_double')) extrasBreakdown.push({ key: 'paint_double', label: 'ספריי צביעה - 2 גוונים', cost: round(extraSprayCost * 2), sellingCost: round(paintSellingSurcharge * 2), calc: `(${sprayCalc}) × 2`, type: 'material' });
    if (extras.includes('paint_single')) extrasBreakdown.push({ key: 'paint_single_labor', label: 'צביעה - גוון יחיד (עבודה)', cost: round(paintRoomCost), sellingCost: null, calc: `${round(paintRoomCostPerSqm)} ₪/מ"ר × ${round(area)} מ"ר`, type: 'labor' });
    if (extras.includes('paint_double')) extrasBreakdown.push({ key: 'paint_double_labor', label: 'צביעה - 2 גוונים (עבודה)', cost: round(paintRoomCost), sellingCost: null, calc: `${round(paintRoomCostPerSqm)} ₪/מ"ר × ${round(area)} מ"ר`, type: 'labor' });
  }
  if (tier && tier.price_per_sqm) {
    let priceFromTier = tier.price_per_sqm * area;
    if (enforceMinimumPrice && tier.min_price && priceFromTier < tier.min_price) priceFromTier = tier.min_price;
    sellingPricePerUnit = priceFromTier + paintSellingSurcharge + spacersSellingSurcharge;
  } else {
    // No matching price tier for this product/thickness — do NOT silently
    // sell at raw cost. Surface this as an explicit pricing error instead;
    // the UI shows it and blocks the quote until an admin sets a price.
    sellingPricePerUnit = baseCost + paintSellingSurcharge + spacersSellingSurcharge;
    priceMissing = true;
  }
  const salesAgentCommissionCost = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
  const marketingCommissionCost = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
  const totalCostPerUnit = baseCost + salesAgentCommissionCost + marketingCommissionCost;
  const totalCostAll = totalCostPerUnit * Q;
  const shippingCost = delivery === 'pickup' ? 0 : (parseFloat(config.shipping_cost) || 0);
  const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
  const profitPerUnit = sellingPricePerUnit - totalCostPerUnit;
  const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
  const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);
  if (shippingCost > 0) extrasBreakdown.push({ key: 'shipping', label: 'משלוח', cost: round(shippingCost), sellingCost: round(shippingCost), calc: `${round(shippingCost)} ₪ קבוע`, type: 'material' });

  return {
    area: round(area),
    totalArea: round(area * Q),
    paintSellingSurcharge: round(paintSellingSurcharge),
    spacersSellingSurcharge: round(spacersSellingSurcharge),
    rawMaterialCost: round(rawMaterialCost),
    rawMaterialBeforeWaste: round(rawMaterialBeforeWaste),
    wasteAmount: round(wasteAmount),
    laborCost: round(laborCost),
    overheadCost: round(overheadCost),
    baseCost: round(baseCost),
    totalCostPerUnit: round(totalCostPerUnit),
    totalCostAll: round(totalCostAll + shippingCost),
    priceMissing,
    errorMessage: priceMissing ? 'לא הוגדר מחיר מכירה למוצר/עובי זה. יש להגדיר מחיר באדמין לפני יצירת הצעת מחיר.' : null,
    sellingPricePerUnit: priceMissing ? null : round(sellingPricePerUnit),
    sellingPriceAll: priceMissing ? null : round(sellingPriceAll),
    profitPerUnit: round(profitPerUnit),
    profitMarginPct: round(profitMarginPct),
    priceWithVat: priceMissing ? null : round(priceWithVat),
    extrasBreakdown,
    productFamily: 'logo',
    breakdown: {
      boardCost: round(boardCost),
      materialCostPerMmPerSqm: round(materialCostPerMmPerSqm),
      thickness_mm: T,
      inkCost: round(inkCost),
      dowelCost: round(dowelCost),
      packagingCost: round(packagingCost),
      instructionCost: round(instructionCost),
      mountingCost: round(mountingCost),
      printLaborCost: round(printLaborCost),
      preCutLaborCost: round(preCutLaborCost),
      laserLaborCost: round(laserLaborCost),
      somaLaborCost: round(somaLaborCost),
      packagingLaborCost: round(packagingLaborCost),
      paintRoomCost: round(paintRoomCost),
      salesAgentCommissionCost: round(salesAgentCommissionCost),
      marketingCommissionCost: round(marketingCommissionCost),
    }
  };
}

// Lightbox (003) pricing — the one and only place this math should live.
// tier = a LightboxSizeTier row (width_cm/height_cm/frame_cost/transformer_cost/
// selling_base_price/selling_price_per_sqm), config = PricingConfig, quantity = units.
export function calculateLightbox(tier, config, quantity = 1, delivery = 'pickup') {
  if (!tier || !config) return null;
  const area = (parseFloat(tier.width_cm) / 100) * (parseFloat(tier.height_cm) / 100);
  const Q = parseInt(quantity) || 1;

  const frameCost = (parseFloat(tier.frame_cost) || 0) * Q;
  const ledQtyPerSqm = parseFloat(config.lightbox_led_qty_per_sqm) || 0;
  const ledUnitPrice = parseFloat(config.lightbox_led_waterproof_cost) || 0;
  const ledCost = ledQtyPerSqm * ledUnitPrice * area * Q;
  const transformerCost = (parseFloat(tier.transformer_cost) || 0) * Q;

  const perspexCostPerMmPerSqm = parseFloat(config.perspex_cost_per_mm) || 0;
  const perspexFrontCost = perspexCostPerMmPerSqm * 3 * area * Q;

  const printHourCost = parseFloat(config.print_hour_cost) || 0;
  const workerHourCost = parseFloat(config.general_worker_hour_cost) || 0;
  const prePrintMinutes = parseFloat(config.pre_print_time_minutes) || 0;
  const printMinutesPerSqm = parseFloat(config.print_time_per_sqm_minutes) || 0;
  const printLaborCost = ((prePrintMinutes + printMinutesPerSqm * area) / 60) * printHourCost * Q;
  const packagingMinutes = parseFloat(config.packaging_time_minutes) || 0;
  const packagingLaborCost = (packagingMinutes / 60) * workerHourCost * Q;
  const laborCost = printLaborCost + packagingLaborCost;

  const rawMaterialCost = frameCost + ledCost + transformerCost + perspexFrontCost;
  const overheadPct = (parseFloat(config.operational_overhead_percent) || 0) / 100;
  const overheadCost = (rawMaterialCost + laborCost) * overheadPct;
  const totalCost = rawMaterialCost + laborCost + overheadCost;

  const baseSellingPrice = parseFloat(tier.selling_base_price) || 0;
  const perSqmSelling = parseFloat(tier.selling_price_per_sqm) || 0;
  const sellingPricePerUnit = baseSellingPrice + perSqmSelling * area;

  const salesCommission = sellingPricePerUnit * (parseFloat(config.sales_agent_commission_percent) || 0) / 100;
  const marketingCommission = sellingPricePerUnit * (parseFloat(config.marketing_commission_percent) || 0) / 100;
  const shippingCost = parseFloat(config.shipping_cost) || 0;
  const totalCostWithCommission = totalCost + (salesCommission + marketingCommission) * Q + shippingCost;

  const sellingPriceAll = sellingPricePerUnit * Q + shippingCost;
  const profitPerUnit = sellingPricePerUnit - (totalCost / Q) - salesCommission - marketingCommission;
  const profitMarginPct = sellingPricePerUnit > 0 ? (profitPerUnit / sellingPricePerUnit) * 100 : 0;
  const priceWithVat = sellingPriceAll * (1 + (parseFloat(config.vat_percent) || 18) / 100);

  return {
    frameCost: round(frameCost), ledCost: round(ledCost), transformerCost: round(transformerCost),
    perspexFrontCost: round(perspexFrontCost),
    laborCost: round(laborCost), overheadCost: round(overheadCost),
    rawMaterialCost: round(rawMaterialCost), totalCost: round(totalCostWithCommission),
    sellingPricePerUnit: round(sellingPricePerUnit), sellingPriceAll: round(sellingPriceAll),
    profitPerUnit: round(profitPerUnit), profitMarginPct: round(profitMarginPct),
    priceBeforeVat: round(sellingPriceAll),
    priceWithVat: round(priceWithVat),
    salesCommission: round(salesCommission * Q),
    marketingCommission: round(marketingCommission * Q),
  };
}

function round(val) {
  return Math.round(val * 100) / 100;
}