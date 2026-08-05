import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUp, ArrowDown, Plus, Trash2, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import LogoutButton from "@/components/LogoutButton";
import printellaLogo from "@/assets/printella-logo.png";
import { toast } from "sonner";
import { CATALOG, PRODUCT_NAMES } from "@/components/calculator/CalculatorForm.jsx";

// Blank row for a brand-new step — mirrors the production_recipe_steps
// columns 1:1 (see src/db/schema.sql) so genCreate on the server needs no
// translation.
const blankStep = (seq) => ({
  seq,
  operation_key: "",
  station_key: "",
  performer: "in_house",
  is_optional: 0,
  condition_text: "",
  alt_group: "",
  notes: "",
});

export default function RecipesAdmin() {
  const [stations, setStations] = useState([]);
  const [operations, setOperations] = useState([]);
  const [productType, setProductType] = useState("");
  const [recipe, setRecipe] = useState(null); // { id, product_type, notes } | null (no recipe yet)
  const [steps, setSteps] = useState([]);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    base44.entities.Station.list().then(setStations);
    base44.entities.Operation.list().then(setOperations);
  }, []);

  const loadRecipeFor = useCallback(async (pt) => {
    setLoadingRecipe(true);
    try {
      const found = await base44.entities.Recipe.filter({ product_type: pt });
      if (found.length) {
        setRecipe(found[0]);
        const stepRows = await base44.entities.RecipeStep.filter({ recipe_id: found[0].id });
        setSteps(stepRows.sort((a, b) => a.seq - b.seq));
      } else {
        setRecipe(null);
        setSteps([]);
      }
    } finally {
      setLoadingRecipe(false);
    }
  }, []);

  const handleSelectProduct = (pt) => {
    setProductType(pt);
    if (pt) loadRecipeFor(pt);
    else { setRecipe(null); setSteps([]); }
  };

  const createRecipe = async () => {
    setBusy(true);
    try {
      const created = await base44.entities.Recipe.create({ product_type: productType, notes: "" });
      setRecipe(created);
      toast.success("המתכון נוצר — אפשר להוסיף שלבים");
    } catch (err) {
      toast.error(err.message || "יצירת המתכון נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const addStep = async () => {
    if (!recipe) return;
    setBusy(true);
    try {
      const nextSeq = steps.length ? Math.max(...steps.map((s) => s.seq)) + 1 : 1;
      const created = await base44.entities.RecipeStep.create({ ...blankStep(nextSeq), recipe_id: recipe.id });
      setSteps((prev) => [...prev, created]);
    } catch (err) {
      toast.error(err.message || "הוספת השלב נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const updateStep = async (id, field, value) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    try {
      await base44.entities.RecipeStep.update(id, { [field]: value });
    } catch (err) {
      toast.error(err.message || "שמירת השינוי נכשלה");
      loadRecipeFor(productType); // roll back to server state
    }
  };

  const deleteStep = async (id) => {
    setBusy(true);
    try {
      await base44.entities.RecipeStep.delete(id);
      setSteps((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error(err.message || "מחיקת השלב נכשלה");
    } finally {
      setBusy(false);
    }
  };

  // Swaps seq between two adjacent steps and persists both — simpler and
  // more robust than drag-and-drop for a handful of rows per recipe, and
  // avoids pulling in a DnD library for this one screen.
  const moveStep = async (index, direction) => {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= steps.length) return;
    const a = steps[index];
    const b = steps[otherIndex];
    const reordered = [...steps];
    reordered[index] = { ...b, seq: a.seq };
    reordered[otherIndex] = { ...a, seq: b.seq };
    reordered.sort((x, y) => x.seq - y.seq);
    setSteps(reordered);
    try {
      await Promise.all([
        base44.entities.RecipeStep.update(a.id, { seq: b.seq }),
        base44.entities.RecipeStep.update(b.id, { seq: a.seq }),
      ]);
    } catch (err) {
      toast.error(err.message || "שינוי הסדר נכשל");
      loadRecipeFor(productType);
    }
  };

  const stationOptions = useMemo(() => stations, [stations]);
  const operationOptions = useMemo(() => operations, [operations]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-xl border-b border-black">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={printellaLogo} alt="Printella" className="h-16 object-contain" />
            <h1 className="font-semibold text-lg">מתכוני ייצור (תפ"י)</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/production"
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-amber-600 transition-colors px-3 py-1.5 rounded-lg border border-black hover:border-amber-300"
            >
              <ArrowRight className="w-3.5 h-3.5" /> לוח הזמנות תפ"י
            </Link>
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 space-y-6">
        <div className="bg-white rounded-xl border border-black p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-700">מוצר</div>
          <Select value={productType} onValueChange={handleSelectProduct}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder="בחר מוצר..." />
            </SelectTrigger>
            <SelectContent>
              {CATALOG.map((cat) => (
                <SelectGroup key={cat.parent}>
                  <SelectLabel>{cat.parent} — {cat.label}</SelectLabel>
                  {cat.subs.map((pt) => (
                    <SelectItem key={pt} value={pt}>
                      {PRODUCT_NAMES[pt] || pt}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {productType && loadingRecipe && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> טוען מתכון...
          </div>
        )}

        {productType && !loadingRecipe && !recipe && (
          <div className="bg-white rounded-xl border border-black p-4 flex items-center justify-between">
            <div className="text-sm text-slate-600">אין עדיין מתכון למוצר "{PRODUCT_NAMES[productType] || productType}"</div>
            <Button onClick={createRecipe} disabled={busy} className="gap-2">
              <Plus className="w-4 h-4" /> צור מתכון
            </Button>
          </div>
        )}

        {recipe && (
          <div className="bg-white rounded-xl border border-black p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">
                שלבי הייצור — {PRODUCT_NAMES[productType] || productType}
              </div>
              <Button onClick={addStep} disabled={busy} size="sm" className="gap-2">
                <Plus className="w-4 h-4" /> הוסף שלב
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-right text-slate-500 border-b border-slate-200">
                    <th className="py-2 pl-2 w-16">סדר</th>
                    <th className="py-2 pl-2">פעולה</th>
                    <th className="py-2 pl-2">תחנה</th>
                    <th className="py-2 pl-2">מבצע</th>
                    <th className="py-2 pl-2 w-20">אופציונלי</th>
                    <th className="py-2 pl-2">תנאי</th>
                    <th className="py-2 pl-2">קבוצת חלופות</th>
                    <th className="py-2 pl-2">הערות</th>
                    <th className="py-2 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, i) => (
                    <tr key={step.id} className="border-b border-slate-100 align-middle">
                      <td className="py-2 pl-2">
                        <div className="flex items-center gap-1">
                          <span className="tabular-nums w-6">{step.seq}</span>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              disabled={i === 0}
                              onClick={() => moveStep(i, -1)}
                              className="disabled:opacity-20 text-slate-500 hover:text-slate-900"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={i === steps.length - 1}
                              onClick={() => moveStep(i, 1)}
                              className="disabled:opacity-20 text-slate-500 hover:text-slate-900"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pl-2 min-w-[140px]">
                        <Select value={step.operation_key} onValueChange={(v) => updateStep(step.id, "operation_key", v)}>
                          <SelectTrigger><SelectValue placeholder="בחר..." /></SelectTrigger>
                          <SelectContent>
                            {operationOptions.map((op) => (
                              <SelectItem key={op.key} value={op.key}>{op.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pl-2 min-w-[160px]">
                        <Select
                          value={step.station_key || "__none__"}
                          onValueChange={(v) => updateStep(step.id, "station_key", v === "__none__" ? null : v)}
                        >
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {stationOptions.map((st) => (
                              <SelectItem key={st.key} value={st.key}>{st.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pl-2 min-w-[110px]">
                        <Select value={step.performer} onValueChange={(v) => updateStep(step.id, "performer", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in_house">בית</SelectItem>
                            <SelectItem value="external">חוץ</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pl-2 text-center">
                        <Checkbox
                          checked={!!step.is_optional}
                          onCheckedChange={(v) => updateStep(step.id, "is_optional", v ? 1 : 0)}
                        />
                      </td>
                      <td className="py-2 pl-2 min-w-[160px]">
                        <Input
                          value={step.condition_text || ""}
                          placeholder='למשל "רק בדייקאט"'
                          onChange={(e) => updateStep(step.id, "condition_text", e.target.value)}
                        />
                      </td>
                      <td className="py-2 pl-2 min-w-[120px]">
                        <Input
                          value={step.alt_group || ""}
                          placeholder="למשל order"
                          onChange={(e) => updateStep(step.id, "alt_group", e.target.value)}
                        />
                      </td>
                      <td className="py-2 pl-2 min-w-[160px]">
                        <Input
                          value={step.notes || ""}
                          onChange={(e) => updateStep(step.id, "notes", e.target.value)}
                        />
                      </td>
                      <td className="py-2 text-center">
                        <button
                          type="button"
                          onClick={() => deleteStep(step.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!steps.length && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-400">
                        אין עדיין שלבים — לחצו "הוסף שלב"
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
