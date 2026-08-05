import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Info } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LogoutButton from "@/components/LogoutButton";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";
import { PRODUCT_NAMES } from "@/components/calculator/CalculatorForm.jsx";

// Deliberately fed by /api/production/orders, NOT /api/entities/Quote — that
// endpoint already strips price_before_vat/price_with_vat/calculation_data
// server-side, so this screen (reachable by 'operations' role staff) never
// even receives selling-price data, let alone has to hide it in the UI.
export default function ProductionBoard() {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [stations, setStations] = useState([]);
  const [operations, setOperations] = useState([]);
  const [selected, setSelected] = useState(null); // { orderId, quoteNumber, clientName, lineIndex, item }
  const [worksheet, setWorksheet] = useState(null);
  const [loadingWorksheet, setLoadingWorksheet] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    base44.production.orders().then((rows) => { setOrders(rows); setLoadingOrders(false); });
    base44.entities.Station.list().then(setStations);
    base44.entities.Operation.list().then(setOperations);
  }, []);

  const operationName = useCallback((key) => operations.find((o) => o.key === key)?.name || key, [operations]);
  const stationName = useCallback((key) => stations.find((s) => s.key === key)?.name || key || "—", [stations]);

  const openItem = async (order, item) => {
    setSelected({ orderId: order.id, quoteNumber: order.quote_number, clientName: order.client_name, lineIndex: item.lineIndex, item });
    setWorksheet(null);
    setLoadingWorksheet(true);
    try {
      const existing = await base44.entities.Worksheet.filter({ quote_id: order.id });
      const match = existing.find((w) => w.line_index === item.lineIndex);
      if (match) {
        setWorksheet(match);
      } else {
        const created = await base44.entities.Worksheet.create({ quote_id: order.id, line_index: item.lineIndex });
        setWorksheet(created);
      }
    } catch (err) {
      toast.error(err.message || "פתיחת דף העבודה נכשלה");
      setSelected(null);
    } finally {
      setLoadingWorksheet(false);
    }
  };

  const updateStep = async (stepId, field, value) => {
    setWorksheet((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === stepId ? { ...s, [field]: value } : s)),
    }));
    try {
      await base44.production.updateStep(stepId, { [field]: value });
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    }
  };

  const itemLabel = (item) => {
    const name = PRODUCT_NAMES[item.productType] || item.productType;
    const dims = item.widthM && item.heightM ? ` — ${item.widthM}×${item.heightM} מ'` : "";
    const qty = item.quantity ? ` × ${item.quantity}` : "";
    return `${name}${dims}${qty}`;
  };

  const groupedByAlt = useMemo(() => {
    if (!worksheet) return [];
    const groups = new Map();
    const standalone = [];
    for (const step of worksheet.steps) {
      if (step.alt_group) {
        if (!groups.has(step.alt_group)) groups.set(step.alt_group, []);
        groups.get(step.alt_group).push(step);
      } else {
        standalone.push({ kind: "single", step });
      }
    }
    const seen = new Set();
    const result = [];
    for (const step of worksheet.steps) {
      if (step.alt_group) {
        if (seen.has(step.alt_group)) continue;
        seen.add(step.alt_group);
        result.push({ kind: "alt", group: step.alt_group, options: groups.get(step.alt_group) });
      } else {
        result.push({ kind: "single", step });
      }
    }
    return result;
  }, [worksheet]);

  const chooseAltOption = async (options, chosenId) => {
    // Only one option in an alt_group can be included at a time — flip the
    // chosen one on and every sibling off, in a single round of requests.
    setWorksheet((prev) => ({
      ...prev,
      steps: prev.steps.map((s) =>
        options.some((o) => o.id === s.id) ? { ...s, included: s.id === chosenId } : s
      ),
    }));
    try {
      await Promise.all(options.map((o) => base44.production.updateStep(o.id, { included: o.id === chosenId })));
    } catch (err) {
      toast.error(err.message || "השמירה נכשלה");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={printellaLogo} alt="Printella" className="h-16 object-contain" />
            <h1 className="font-semibold text-lg">לוח הזמנות תפ"י</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/recipes"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-amber-300"
            >
              <ArrowRight className="w-3.5 h-3.5" /> ניהול מתכונים
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* Order list — approved quotes only, no prices anywhere in this column. */}
        <div className="bg-white rounded-xl border border-black p-4 space-y-3 h-fit">
          <div className="font-semibold">הזמנות מאושרות</div>
          {loadingOrders && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> טוען...
            </div>
          )}
          {!loadingOrders && !orders.length && (
            <div className="text-sm text-slate-400">אין הזמנות מאושרות כרגע</div>
          )}
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {orders.map((order) => (
              <div key={order.id} className="border border-slate-200 rounded-lg p-3">
                <div className="text-sm font-semibold">{order.quote_number} — {order.client_name}</div>
                <div className="text-xs text-slate-400 mb-2">{order.created_at}</div>
                <div className="space-y-1">
                  {order.items.map((item) => (
                    <button
                      key={item.lineIndex}
                      type="button"
                      onClick={() => openItem(order, item)}
                      className={`w-full text-right text-sm px-2 py-1.5 rounded-md border transition-colors ${
                        selected?.orderId === order.id && selected?.lineIndex === item.lineIndex
                          ? "border-amber-400 bg-amber-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {itemLabel(item)}
                    </button>
                  ))}
                  {!order.items.length && <div className="text-xs text-slate-400">אין פריטים</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Worksheet — pre-filled by resolveRecipe() on the server; the תפ"י
            operator here only confirms/overrides, never types a recipe from scratch. */}
        <div className="bg-white rounded-xl border border-black p-4">
          {!selected && <div className="text-slate-400 text-sm">בחרו פריט מהזמנה כדי לפתוח דף עבודה</div>}

          {selected && loadingWorksheet && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> טוען דף עבודה...
            </div>
          )}

          {selected && worksheet && !loadingWorksheet && (
            <div className="space-y-4 production-print-area">
              <div>
                <div className="font-semibold text-lg">{selected.quoteNumber} — {selected.clientName}</div>
                <div className="text-sm text-slate-500">{itemLabel(selected.item)}</div>
              </div>

              <div className="space-y-2">
                {groupedByAlt.map((entry, i) =>
                  entry.kind === "single" ? (
                    <StepRow
                      key={entry.step.id}
                      step={entry.step}
                      operationName={operationName}
                      stationOptions={stations}
                      onToggleIncluded={(v) => updateStep(entry.step.id, "included", v)}
                      onStationChange={(v) => updateStep(entry.step.id, "station_key", v === "__none__" ? null : v)}
                      onPerformerChange={(v) => updateStep(entry.step.id, "performer", v)}
                    />
                  ) : (
                    <div key={entry.group} className="border border-dashed border-slate-300 rounded-lg p-2 space-y-1">
                      <div className="text-xs text-slate-400">בחירת מסלול — {entry.group}</div>
                      {entry.options.map((opt) => (
                        <label key={opt.id} className="flex items-center gap-2 text-sm px-1 py-1 cursor-pointer">
                          <input
                            type="radio"
                            name={`alt-${entry.group}`}
                            checked={!!opt.included}
                            onChange={() => chooseAltOption(entry.options, opt.id)}
                          />
                          <span>{operationName(opt.operation_key)}</span>
                          <span className="text-slate-400">— {stationName(opt.station_key)}</span>
                          {opt.included && opt.auto_reason && (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <Info className="w-3 h-3" /> {opt.auto_reason}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )
                )}
              </div>

              <Button variant="outline" size="sm" onClick={() => window.print()}>הדפסה</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, operationName, stationOptions, onToggleIncluded, onStationChange, onPerformerChange }) {
  return (
    <div className={`flex items-center gap-3 border rounded-lg px-3 py-2 ${step.included ? "border-slate-200" : "border-slate-100 opacity-50"}`}>
      <Checkbox checked={!!step.included} onCheckedChange={onToggleIncluded} />
      <div className="flex-1">
        <div className="text-sm font-medium">{operationName(step.operation_key)}</div>
        {step.auto_reason && (
          <div className="flex items-center gap-1 text-xs text-amber-600">
            <Info className="w-3 h-3" /> {step.auto_reason}
          </div>
        )}
      </div>
      <Select value={step.station_key || "__none__"} onValueChange={onStationChange}>
        <SelectTrigger className="w-40"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {stationOptions.map((st) => (
            <SelectItem key={st.key} value={st.key}>{st.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={step.performer} onValueChange={onPerformerChange}>
        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="in_house">בית</SelectItem>
          <SelectItem value="external">חוץ</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
