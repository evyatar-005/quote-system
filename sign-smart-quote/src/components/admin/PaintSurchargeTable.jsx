import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeDecimal } from "@/lib/utils";

// Defined at module scope (not inside PaintSurchargeTable) — a component defined
// inside another component's render body gets a new identity every render, which
// makes React unmount/remount it (and its <Input> DOM nodes) on every keystroke,
// kicking focus out of the field the user is typing in.
function InitialTierSection({ title, tier, onUpdate }) {
  const [value, setValue] = useState(tier?.surcharge?.toString() || "");

  useEffect(() => {
    setValue(tier?.surcharge?.toString() || "");
  }, [tier?.id, tier?.surcharge]);

  return (
    <div className="bg-muted/20 rounded-lg border border-border/30 p-4 space-y-3">
      <div>
        <h4 className="text-base font-semibold mb-2">{title} - תוספת ראשונה (עד 0.8 מ״ר)</h4>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700 w-24">שטח עד:</span>
          <Input type="text" value="0.8" disabled className="h-8 w-20 text-base" />
          <span className="text-sm font-semibold text-slate-700 w-20">מחיר (₪):</span>
          <Input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(sanitizeDecimal(e.target.value))}
            onBlur={() => value && onUpdate(value)}
            className="h-8 w-24 text-base"
          />
          <span className="text-sm text-muted-foreground">₪</span>
        </div>
      </div>
    </div>
  );
}

function StepTiersSection({
  title, tiers, newTier, setNewTier, onAdd, onDelete,
  editingId, editData, setEditData, onStartEdit, onSaveEdit, onCancelEdit,
}) {
  return (
    <div className="bg-card rounded-lg border border-black p-4 space-y-3">
      <h4 className="text-base font-semibold">{title} - מדרגות נוספות</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/30 text-sm font-semibold text-slate-700">
            <th className="text-right pb-2 px-2">כל (מ״ר)</th>
            <th className="text-right pb-2 px-2">מחיר לכל מ״ר (₪)</th>
            <th className="text-center pb-2 px-2">פעולות</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier) => (
            <tr key={tier.id} className="border-b border-border/20 hover:bg-muted/30">
              <td className="py-2 px-2">
                {editingId === tier.id ? (
                  <Input
                    type="text" inputMode="decimal" value={editData.area_from}
                    onChange={(e) => setEditData({ ...editData, area_from: sanitizeDecimal(e.target.value) })}
                    className="h-7 text-base w-20"
                  />
                ) : (
                  <span onClick={() => onStartEdit(tier)} className="cursor-pointer hover:underline">
                    {Number(tier.area_from).toFixed(2)}
                  </span>
                )}
              </td>
              <td className="py-2 px-2">
                {editingId === tier.id ? (
                  <Input
                    type="text" inputMode="decimal" value={editData.surcharge}
                    onChange={(e) => setEditData({ ...editData, surcharge: sanitizeDecimal(e.target.value) })}
                    className="h-7 text-base w-20"
                  />
                ) : (
                  <span onClick={() => onStartEdit(tier)} className="cursor-pointer hover:underline">
                    ₪ {Number(tier.surcharge).toFixed(0)}
                  </span>
                )}
              </td>
              <td className="py-2 px-2 text-center">
                {editingId === tier.id ? (
                  <div className="flex gap-1 justify-center">
                    <Button size="sm" onClick={() => onSaveEdit(tier.id)} className="h-6 px-1.5 text-sm font-semibold">שמור</Button>
                    <Button size="sm" variant="ghost" onClick={onCancelEdit} className="h-6 px-1.5 text-sm font-semibold">בטל</Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(tier.id)}
                    className="h-6 w-6 p-0"
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border/30">
            <td className="py-2 px-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0.3"
                value={newTier.area_sqm}
                onChange={(e) => setNewTier({ ...newTier, area_sqm: sanitizeDecimal(e.target.value) })}
                className="h-8 text-base w-24"
              />
            </td>
            <td className="py-2 px-2">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="מחיר"
                value={newTier.price}
                onChange={(e) => setNewTier({ ...newTier, price: sanitizeDecimal(e.target.value) })}
                className="h-8 text-base w-24"
              />
            </td>
            <td className="py-2 px-2 text-center">
              <Button
                size="sm"
                onClick={() => onAdd(newTier)}
                disabled={!newTier.area_sqm || !newTier.price}
                className="h-6 px-2 text-sm font-semibold gap-1"
              >
                <Plus className="w-3 h-3" /> הוסף
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function PaintSurchargeTable() {
  const [singleInitial, setSingleInitial] = useState(null);
  const [dualInitial, setDualInitial] = useState(null);
  const [singleSteps, setSingleSteps] = useState([]);
  const [dualSteps, setDualSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSingleStep, setNewSingleStep] = useState({ area_sqm: "", price: "" });
  const [newDualStep, setNewDualStep] = useState({ area_sqm: "", price: "" });
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ area_from: "", surcharge: "" });

  useEffect(() => {
    loadTiers();
  }, []);

  const loadTiers = async () => {
    setLoading(true);
    const [single, dual] = await Promise.all([
      base44.entities.PaintSurchargeTier.filter({ paint_type: "single_color" }),
      base44.entities.PaintSurchargeTier.filter({ paint_type: "dual_color" })
    ]);

    // Initial tier = area_from is 0, Step tiers = area_from > 0
    setSingleInitial(single.find(t => t.area_from === 0) || null);
    setSingleSteps(single.filter(t => t.area_from > 0).sort((a, b) => a.area_from - b.area_from));
    setDualInitial(dual.find(t => t.area_from === 0) || null);
    setDualSteps(dual.filter(t => t.area_from > 0).sort((a, b) => a.area_from - b.area_from));
    setLoading(false);
  };

  const updateInitialTier = async (type, surcharge) => {
    const current = type === "single_color" ? singleInitial : dualInitial;
    if (current) {
      await base44.entities.PaintSurchargeTier.update(current.id, { surcharge: parseFloat(surcharge) });
    } else {
      await base44.entities.PaintSurchargeTier.create({
        paint_type: type,
        area_from: 0,
        surcharge: parseFloat(surcharge),
        tier_description: "תוספת ראשונה עד 0.8 מ״ר"
      });
    }
    loadTiers();
  };

  const addStepTier = async (type, data) => {
    if (!data.area_sqm || !data.price) return;
    await base44.entities.PaintSurchargeTier.create({
      paint_type: type,
      area_from: parseFloat(data.area_sqm),
      surcharge: parseFloat(data.price),
      tier_description: `כל ${data.area_sqm} מ״ר`
    });
    loadTiers();
    if (type === "single_color") setNewSingleStep({ area_sqm: "", price: "" });
    else setNewDualStep({ area_sqm: "", price: "" });
  };

  const deleteStepTier = async (id) => {
    await base44.entities.PaintSurchargeTier.delete(id);
    loadTiers();
  };

  const startEdit = (tier) => {
    setEditingId(tier.id);
    setEditData({ area_from: tier.area_from, surcharge: tier.surcharge });
  };

  const saveEdit = async (id) => {
    await base44.entities.PaintSurchargeTier.update(id, {
      area_from: parseFloat(editData.area_from),
      surcharge: parseFloat(editData.surcharge)
    });
    setEditingId(null);
    loadTiers();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">טוען...</div>;
  }

  return (
    <>
      <InitialTierSection
        title="גוון יחיד"
        tier={singleInitial}
        onUpdate={(surcharge) => updateInitialTier("single_color", surcharge)}
      />
      <StepTiersSection
        title="גוון יחיד"
        tiers={singleSteps}
        newTier={newSingleStep}
        setNewTier={setNewSingleStep}
        onAdd={(data) => addStepTier("single_color", data)}
        onDelete={deleteStepTier}
        editingId={editingId}
        editData={editData}
        setEditData={setEditData}
        onStartEdit={startEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={() => setEditingId(null)}
      />
      <InitialTierSection
        title="2 גוונים"
        tier={dualInitial}
        onUpdate={(surcharge) => updateInitialTier("dual_color", surcharge)}
      />
      <StepTiersSection
        title="2 גוונים"
        tiers={dualSteps}
        newTier={newDualStep}
        setNewTier={setNewDualStep}
        onAdd={(data) => addStepTier("dual_color", data)}
        onDelete={deleteStepTier}
        editingId={editingId}
        editData={editData}
        setEditData={setEditData}
        onStartEdit={startEdit}
        onSaveEdit={saveEdit}
        onCancelEdit={() => setEditingId(null)}
      />
    </>
  );
}
