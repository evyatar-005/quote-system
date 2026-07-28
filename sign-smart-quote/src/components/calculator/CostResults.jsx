import { Package, Wrench } from "lucide-react";

const fmt = (val) => val != null ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

function Row({ label, value, bold, muted, calc }) {
  return (
    <div className={`relative group flex justify-between items-baseline gap-4 py-1 px-2 ${
      bold ? "mt-1 pt-2 border-t border-white/25"
      : "border-b border-white/25"
    }`}>
      <span className={`text-base font-semibold ${bold ? "text-white" : muted ? "text-zinc-200" : "text-zinc-100"}`}>{label}</span>
      <span className={`tabular-nums whitespace-nowrap ${bold ? "text-lg font-bold text-white" : "text-base font-semibold text-zinc-50"}`}>{value}</span>
      {calc && (
        <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
          <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">
            {calc}
          </div>
        </div>
      )}
    </div>
  );
}

const n = (v) => v != null ? Number(v).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "?"

export default function CostResults({ result, quantity, config }) {
  if (!result) {
    return <div className="flex items-center justify-center h-40 text-base text-zinc-600">הזן מידות כדי לראות את חישוב העלויות</div>;
  }

  const wasteBeforeBase = result.isSticker ? result.breakdown?.stickerMaterialBeforeWaste : result.rawMaterialBeforeWaste;
  const wasteAmountBase = result.isSticker ? result.breakdown?.stickerWasteAmount : result.wasteAmount;
  const wastePct = wasteBeforeBase > 0 ? Math.round((wasteAmountBase / wasteBeforeBase) * 100) : 0;

  const c = config || {};
  const printHourCost = n(c.print_hour_cost);
  const workerHourCost = n(c.general_worker_hour_cost);
  const prePrint = n(c.logo_pre_print_time_minutes);
  const printPerSqm = n(c.logo_print_time_per_sqm_minutes);
  const thicknessKey = result.breakdown?.thickness_mm != null ? String(result.breakdown.thickness_mm).replace(/\.0$/, '') : null;
  const laserTime = n(c[`logo_laser_cut_time_minutes_${thicknessKey}`]);
  const somaTime = n(c[`logo_soma_cut_time_minutes_${thicknessKey}`]);
  const packTime = n(c.logo_packaging_time_minutes);
  const dowelRate = n(c.dowel_cost_per_sqm);
  // The engine (useCalculator.jsx) reports which material rate it actually used —
  // no need to reverse-engineer it here by comparing costs back against config.
  const materialRate = n(result.breakdown?.materialCostPerMmPerSqm);

  const kapaPrePrint = n(c.kapa_pre_print_time_minutes);
  const kapaPrintTime = result.breakdown?.kapaSheetIsSmall ? n(c.kapa_print_time_small_minutes) : n(c.kapa_print_time_large_minutes);
  const kapaPreCut = n(c.kapa_pre_cut_time_minutes);
  const kapaCutTimeKey = `kapa_cut_time_${result.breakdown?.kapaSheetIsSmall ? 'small' : 'large'}_${result.breakdown?.kapaIsDieCut ? 'diecut' : 'straight'}_minutes`;
  const kapaCutTime = n(c[kapaCutTimeKey]);
  const kapaPackTime = n(c.kapa_packaging_time_minutes);
  const kapaSheetRate = n(result.breakdown?.kapaSheetIsSmall ? c.kapa_sheet_cost_122x244 : c.kapa_sheet_cost_150x300);

  const stickerPrefix = result.isSticker
    ? (result.breakdown?.stickerMaterialCost != null ? (c.vinyl_sticker_material_cost_per_sqm != null ? 'vinyl' : 'texture') : 'vinyl')
    : null;
  const prePrintSticker = stickerPrefix ? n(c[`${stickerPrefix}_sticker_pre_print_time_minutes`]) : null;
  const printPerSqmSticker = stickerPrefix ? n(c[`${stickerPrefix}_sticker_print_time_per_sqm`]) : null;
  const preCutSticker = stickerPrefix ? n(c[`${stickerPrefix}_sticker_pre_cut_time_minutes`]) : null;
  const cutPerSqmSticker = stickerPrefix ? n(c[`${stickerPrefix}_sticker_cut_time_per_sqm`]) : null;
  const preCutFoamex = n(c.foamex_pre_cut_time_minutes);
  const preCutPerspexBoard = n(c.perspex_board_pre_cut_time_minutes);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

      {/* גלם */}
      <div className="bg-[#111118] rounded-2xl border border-white/20 p-4 space-y-0">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/25">
          <Package className="w-4 h-4 text-blue-400" />
          <span className="text-lg font-semibold text-zinc-100">פרוט גלם</span>
        </div>
        {result.isKapa ? (
          <>
            <Row label="לוח קאפה" value={fmt(result.breakdown.kapaSheetCost)} muted calc={`${kapaSheetRate} ₪ ליחידה (מידה ${result.breakdown.kapaSheetIsSmall ? "קטנה 122×244" : "גדולה 150×300"})`} />
            <Row label="דיו" value={fmt(result.breakdown.inkCost)} muted calc={`${n(c.ink_cost)} ₪/מ"ר * ${n(result.breakdown.kapaSheetIsSmall ? 1.22 * 2.44 : 1.5 * 3.0)} מ"ר (גיליון) * ${quantity} יח'`} />
            <Row label={`פחת (${wastePct}%)`} value={fmt(result.wasteAmount)} muted />
            {(() => {
              const shelvesEx = (result.extrasBreakdown || []).find(ex => ex.key === 'shelves');
              const shelvesCostReal = shelvesEx?.cost || 0;
              return (
                <>
                  {shelvesEx && (
                    <div className="relative group flex justify-between items-baseline gap-4 py-1 px-2 border-b border-white/25 bg-[#C9A84C]/10 border border-[#C9A84C]/20">
                      <span className="text-base text-[#C9A84C] font-semibold">{shelvesEx.label}</span>
                      <span className="text-base font-semibold text-[#C9A84C] tabular-nums whitespace-nowrap">{fmt(shelvesCostReal)}</span>
                      {shelvesEx.calc && (
                        <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
                          <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">{shelvesEx.calc}</div>
                        </div>
                      )}
                    </div>
                  )}
                  <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost + shelvesCostReal)} bold />
                </>
              );
            })()}
          </>
        ) : result.isSticker ? (
          <>
            <Row label="חומר גלם" value={fmt(result.breakdown.stickerMaterialCost)} muted calc={`${n(c.vinyl_sticker_material_cost_per_sqm || c.texture_sticker_material_cost_per_sqm)} ₪/מ"ר * ${n(result.area)} מ"ר`} />
            <Row label="דיו" value={fmt(result.breakdown.stickerInkCost)} muted calc={`${n(c.vinyl_sticker_ink_cost_per_sqm || c.texture_sticker_ink_cost_per_sqm)} ₪/מ"ר * ${n(result.area)} מ"ר`} />
            {result.breakdown.stickerMaterialBeforeWaste > 0 && <Row label="לפני פחת" value={fmt(result.breakdown.stickerMaterialBeforeWaste)} muted calc="חומר + דיו" />}
            {result.breakdown.stickerWasteAmount > 0 && <Row label={`פחת (${wastePct}%)`} value={fmt(result.breakdown.stickerWasteAmount)} muted />}
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`לפני פחת + פחת (${wastePct}%)`} />
          </>
        ) : (result.productFamily === 'lokobond' || result.productFamily === 'foamex' || result.productFamily === 'perspexBoard') ? (
          <>
            <Row label="לוח חומר" value={fmt(result.breakdown.boardCost)} muted />
            <Row label="דיו" value={fmt(result.breakdown.inkCost)} muted calc={`${n(c.ink_cost)} ₪/מ"ר * ${n(result.area)} מ"ר`} />
            <Row label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} muted calc="לוח חומר + דיו" />
            <Row label={`פחת (${wastePct}%)`} value={fmt(result.wasteAmount)} muted calc={`${n(result.rawMaterialBeforeWaste)} * ${wastePct}%`} />
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`${n(result.rawMaterialBeforeWaste)} + ${n(result.wasteAmount)}`} />
          </>
        ) : result.productFamily === 'pvcCarpet' ? (
          <>
            <Row label="חומר גלם (שטח שהוזמן)" value={fmt(result.breakdown.materialCostPerSqm * result.area)} muted calc={`${n(result.breakdown.materialCostPerSqm)} ₪/מ"ר * ${n(result.area)} מ"ר`} />
            <Row label="דיו" value={fmt(result.breakdown.inkCost)} muted calc={`${n(c.ink_cost)} ₪/מ"ר * ${n(result.area)} מ"ר`} />
            <Row
              label={`פחת גליל (${result.breakdown.rollWidthsNeeded} × ${n(result.breakdown.rollWidthM)} מ' = ${n(result.breakdown.tiledWidthM)} מ' רוחב בפועל)`}
              value={fmt(result.wasteAmount)}
              muted
              calc={`רוחב פחת ${n(result.breakdown.wasteWidthM)} מ' * גובה * ${n(result.breakdown.materialCostPerSqm)} ₪/מ"ר = ${n(result.breakdown.wasteAreaSqm)} מ"ר`}
            />
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`${n(result.rawMaterialBeforeWaste)} + ${n(result.wasteAmount)}`} />
          </>
        ) : result.productFamily === 'rollup' ? (
          <>
            <Row
              label="נייר"
              value={fmt(result.breakdown.paperCost)}
              muted
              calc={result.breakdown.paperAreaMultiplier > 1
                ? `${n(result.breakdown.paperCostPerSqm)} ₪/מ"ר * ${n(result.totalArea)} מ"ר * 2 (מגנטי — 2 צדדים)`
                : `${n(result.breakdown.paperCostPerSqm)} ₪/מ"ר * ${n(result.totalArea)} מ"ר`}
            />
            <Row label="מתקן" value={fmt(result.breakdown.standCost)} muted />
            <Row label="דיו" value={fmt(result.breakdown.inkCost)} muted calc={`${n(c.ink_cost)} ₪/מ"ר * ${n(result.totalArea)} מ"ר`} />
            <Row label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} muted calc="נייר + מתקן + דיו" />
            <Row label={`פחת (${wastePct}%)`} value={fmt(result.wasteAmount)} muted calc={`${n(result.rawMaterialBeforeWaste)} * ${wastePct}%`} />
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`${n(result.rawMaterialBeforeWaste)} + ${n(result.wasteAmount)}`} />
          </>
        ) : result.productFamily === 'glass' ? (
          <>
            <Row label="גיליון זכוכית" value={fmt(result.breakdown.sheetCost)} muted />
            <Row label="ספייסרים" value={fmt(result.breakdown.spacersCost)} muted calc={`4 × ${n(c.spacers_cost)} ₪/יחידה`} />
            <Row label="דיו" value={fmt(result.breakdown.inkCost)} muted calc={`${n(c.ink_cost)} ₪/מ"ר * ${n(result.totalArea)} מ"ר`} />
            <Row label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} muted calc="גיליון + ספייסרים + דיו" />
            <Row label={`פחת (${wastePct}%)`} value={fmt(result.wasteAmount)} muted calc={`${n(result.rawMaterialBeforeWaste)} * ${wastePct}%`} />
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`${n(result.rawMaterialBeforeWaste)} + ${n(result.wasteAmount)}`} />
          </>
        ) : (
          <>
            <Row label="לוח חומר" value={fmt(result.breakdown.boardCost)} muted calc={`${materialRate} ₪/מ"מ/מ"ר * ${result.breakdown.thickness_mm} מ"מ * ${result.area} מ"ר`} />
            {result.breakdown.dowelCost > 0 && <Row label="דוץ" value={fmt(result.breakdown.dowelCost)} muted calc={`${dowelRate} ₪/מ"ר * ${result.area} מ"ר`} />}
            {result.breakdown.packagingCost > 0 && <Row label="אריזה (חומרים)" value={fmt(result.breakdown.packagingCost)} muted calc={`${n(c.packaging_cost)} ₪ קבוע ליחידה`} />}
            {result.breakdown.instructionCost > 0 && <Row label="דף הוראות" value={fmt(result.breakdown.instructionCost)} muted calc={`${n(c.instruction_sheet_cost)} ₪ קבוע ליחידה`} />}
            {result.breakdown.mountingCost > 0 && <Row label="לוח התקנה" value={fmt(result.breakdown.mountingCost)} muted calc={`${n(c.mounting_board_cost)} ₪ קבוע ליחידה`} />}
            {(result.extrasBreakdown || []).filter(ex => ex.type === 'material').map((ex, i) => (
              <div key={i} className="relative group flex justify-between items-baseline gap-4 py-1 px-2 border-b border-white/25 bg-[#C9A84C]/10 border border-[#C9A84C]/20">
                <span className="text-base text-[#C9A84C] font-semibold">{ex.label}</span>
                <span className="text-base font-semibold text-[#C9A84C] tabular-nums whitespace-nowrap">{fmt(ex.cost)}</span>
                {ex.calc && (
                  <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
                    <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">{ex.calc}</div>
                  </div>
                )}
              </div>
            ))}
            <Row label="לפני פחת" value={fmt(result.rawMaterialBeforeWaste)} muted />
            <Row label={`פחת (${wastePct}%)`} value={fmt(result.wasteAmount)} muted calc={`${n(result.rawMaterialBeforeWaste)} * ${wastePct}%`} />
            <Row label="סה״כ גלם כולל פחת" value={fmt(result.rawMaterialCost)} bold calc={`${n(result.rawMaterialBeforeWaste)} + ${n(result.wasteAmount)}`} />
          </>
        )}
      </div>

      {/* עבודה */}
      <div className="bg-[#111118] rounded-2xl border border-white/20 p-4 space-y-0">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/25">
          <Wrench className="w-4 h-4 text-orange-400" />
          <span className="text-lg font-semibold text-zinc-100">עלות עבודה</span>
        </div>
        {result.isKapa ? (
          <>
            <Row label="קדם דפוס" value={fmt(result.breakdown.kapaPrePrintLaborCost)} muted calc={`${kapaPrePrint} דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="הדפסה" value={fmt(result.breakdown.kapaPrintLaborCost)} muted calc={`${kapaPrintTime} דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="קדם חיתוך" value={fmt(result.breakdown.kapaPreCutLaborCost)} muted calc={`${kapaPreCut} דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="חיתוך CNC (סומא)" value={fmt(result.breakdown.kapaCncCutLaborCost)} muted calc={`${kapaCutTime} דק / 60 * ${printHourCost} ₪/שעה — ${result.breakdown.kapaIsDieCut ? "עם" : "ללא"} חיתוך צורני`} />
            <Row label="אריזה" value={fmt(result.breakdown.kapaPackagingLaborCost)} muted calc={`${kapaPackTime} דק / 60 * ${workerHourCost} ₪/שעה`} />
            <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="קדם דפוס + הדפסה + קדם חיתוך + חיתוך CNC + אריזה" />
          </>
        ) : result.isSticker ? (
          <>
            <Row label="הדפסה" value={fmt(result.breakdown.stickerPrintLaborCost)} muted calc={`(${prePrintSticker} + ${printPerSqmSticker} * ${result.totalArea} מ"ר) / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="חיתוך" value={fmt(result.breakdown.stickerCutLaborCost)} muted calc={`(${preCutSticker} + ${cutPerSqmSticker} * ${result.totalArea} מ"ר) / 60 * ${printHourCost} ₪/שעה`} />
            {result.breakdown.stickerInstallCost > 0 && (
              <div className="relative group flex justify-between items-baseline gap-4 py-1 px-2 border-b border-white/25 bg-[#C9A84C]/10 border border-[#C9A84C]/20">
                <span className="text-base text-[#C9A84C] font-semibold">התקנה (עלות)</span>
                <span className="text-base font-semibold text-[#C9A84C] tabular-nums whitespace-nowrap">{fmt(result.breakdown.stickerInstallCost)}</span>
                <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
                  <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">עלות התקנה למ"ר × שטח, רצפת מינימום עלות</div>
                </div>
              </div>
            )}
            <Row label="סה״כ עבודה" value={fmt(result.breakdown.stickerPrintLaborCost + result.breakdown.stickerCutLaborCost)} bold calc="הדפסה + חיתוך (לא כולל התקנה)" />
          </>
        ) : (result.productFamily === 'lokobond' || result.productFamily === 'foamex' || result.productFamily === 'perspexBoard') ? (
          <>
            <Row label="הדפסה" value={fmt(result.breakdown.printLaborCost)} muted calc={`קדם דפוס × ${result.breakdown.areaTierUnits} מדרגות (כל 3 מ"ר) + הדפסה למ"ר`} />
            <Row
              label="קדם חיתוך"
              value={fmt(result.breakdown.preCutLaborCost)}
              muted
              calc={result.productFamily === 'foamex'
                ? `${preCutFoamex} דק / 60 * ${printHourCost} ₪/שעה`
                : result.productFamily === 'perspexBoard'
                ? `${preCutPerspexBoard} דק / 60 * ${printHourCost} ₪/שעה`
                : `${n(c.lokobond_pre_cut_time_minutes)} דק / 60 * ${printHourCost} ₪/שעה`}
            />
            <Row
              label={`חיתוך (${n(result.breakdown.totalLinearMeters)} מ"א)`}
              value={fmt(result.breakdown.cutLaborCost)}
              muted
              calc={result.productFamily === 'foamex'
                ? `${n(c[`foamex_cut_time_per_linear_meter_minutes_${String(result.breakdown.thickness_mm).replace(/\.0$/, '')}`])} דק/מ"א * ${n(result.breakdown.totalLinearMeters)} מ"א / 60 * ${printHourCost} ₪/שעה`
                : result.productFamily === 'perspexBoard'
                ? `${n(c[`perspex_board_cut_time_per_linear_meter_minutes_${String(result.breakdown.thickness_mm).replace(/\.0$/, '')}`])} דק/מ"א * ${n(result.breakdown.totalLinearMeters)} מ"א / 60 * ${printHourCost} ₪/שעה`
                : `${n(c[result.breakdown.isDiecut ? 'lokobond_cut_time_per_linear_meter_minutes_diecut' : 'lokobond_cut_time_per_linear_meter_minutes_plain'])} דק/מ"א * ${n(result.breakdown.totalLinearMeters)} מ"א / 60 * ${printHourCost} ₪/שעה`}
            />
            <Row label="ניקוי" value={fmt(result.breakdown.cleanLaborCost)} muted />
            <Row label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} muted calc={`× ${result.breakdown.areaTierUnits} מדרגות (כל 3 מ"ר)`} />
            <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="הדפסה + קדם חיתוך + חיתוך + ניקוי + אריזה" />
          </>
        ) : result.isRollup ? (
          <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="מוצר קטלוגי במחיר קבוע — ללא עלות עבודה נפרדת" />
        ) : result.productFamily === 'pvcCarpet' ? (
          <>
            <Row label="הכנה ועיבוד" value={fmt(result.breakdown.printLaborCost)} muted calc={`הכנה × ${result.breakdown.areaTierUnits} מדרגות (כל 3 מ"ר) + עיבוד למ"ר`} />
            <Row label="קדם חיתוך" value={fmt(result.breakdown.preCutLaborCost)} muted calc={`${n(c.pvc_carpet_pre_cut_time_minutes)} דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row
              label={`חיתוך (${n(result.breakdown.totalLinearMeters)} מ"א)`}
              value={fmt(result.breakdown.cutLaborCost)}
              muted
              calc={`${n(c.pvc_carpet_cut_time_per_linear_meter_minutes)} דק/מ"א * ${n(result.breakdown.totalLinearMeters)} מ"א / 60 * ${printHourCost} ₪/שעה`}
            />
            <Row label="ניקוי" value={fmt(result.breakdown.cleanLaborCost)} muted />
            <Row label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} muted calc={`× ${result.breakdown.areaTierUnits} מדרגות (כל 3 מ"ר)`} />
            <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="הכנה ועיבוד + קדם חיתוך + חיתוך + ניקוי + אריזה" />
          </>
        ) : result.productFamily === 'glass' ? (
          <>
            <Row label="קדם דפוס + הדפסה" value={fmt(result.breakdown.printLaborCost)} muted calc={`(${n(c.glass_pre_print_time_minutes)} + ${n(c.glass_print_time_minutes)}) דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="קדם דפוס + הדפסה — אין חיתוך (זכוכית מגיעה חתוכה למידה)" />
          </>
        ) : (
          <>
            <Row label="הדפסה" value={fmt(result.breakdown.printLaborCost)} muted calc={`(${prePrint} + ${printPerSqm} * ${result.area} מ"ר) / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="קדם חיתוך" value={fmt(result.breakdown.preCutLaborCost)} muted calc={`${n(c.logo_pre_cut_time_minutes)} דק / 60 * ${printHourCost} ₪/שעה`} />
            <Row label="חיתוך לייזר" value={fmt(result.breakdown.laserLaborCost)} muted calc={`${laserTime} דק * ${result.area} מ"ר / 60 * ${printHourCost} ₪/שעה`} />
            {result.breakdown.somaLaborCost > 0 && <Row label="חיתוך סומה" value={fmt(result.breakdown.somaLaborCost)} muted calc={`${somaTime} דק * ${result.area} מ"ר / 60 * ${printHourCost} ₪/שעה`} />}
            <Row label="אריזה" value={fmt(result.breakdown.packagingLaborCost)} muted calc={`${packTime} דק / 60 * ${workerHourCost} ₪/שעה`} />
            {(result.extrasBreakdown || []).filter(ex => ex.type === 'labor').map((ex, i) => (
              <div key={i} className="relative group flex justify-between items-baseline gap-4 py-1 px-2 border-b border-white/25 bg-[#C9A84C]/10 border border-[#C9A84C]/20">
                <span className="text-base text-[#C9A84C] font-semibold">{ex.label}</span>
                <span className="text-base font-semibold text-[#C9A84C] tabular-nums whitespace-nowrap">{fmt(ex.cost)}</span>
                {ex.calc && (
                  <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
                    <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">{ex.calc}</div>
                  </div>
                )}
              </div>
            ))}
            {result.breakdown.paintRoomCost > 0 && !(result.extrasBreakdown || []).some(ex => ex.type === 'labor') && (
              <div className="relative group flex justify-between items-baseline gap-4 py-1 px-2 border-b border-white/25 bg-[#C9A84C]/10 border border-[#C9A84C]/20">
                <span className="text-base text-[#C9A84C] font-semibold">חדר צבע</span>
                <span className="text-base font-semibold text-[#C9A84C] tabular-nums whitespace-nowrap">{fmt(result.breakdown.paintRoomCost)}</span>
                <div className="absolute bottom-full right-0 mb-1 z-50 hidden group-hover:block">
                  <div dir="ltr" className="bg-[#1A1A25] border border-white/25 text-zinc-300 text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap max-w-xs text-left">{n(c.paint_room_cost)} ₪/מ"ר * {n(result.area)} מ"ר</div>
                </div>
              </div>
            )}
            <Row label="סה״כ עבודה" value={fmt(result.laborCost)} bold calc="הדפסה + קדם חיתוך + לייזר + סומה + אריזה" />
          </>
        )}
      </div>

    </div>
  );
}