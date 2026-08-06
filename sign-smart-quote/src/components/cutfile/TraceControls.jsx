// Sliders driving the trace/offset pass — the automated equivalent of the
// Illustrator Image Trace / Expand / Smooth Line / Offset Path parameters.
// This is the ONLY correction mechanism (per the agreed design — no manual
// Bézier point editing): if the traced line looks wrong, the fix is a slider,
// not a click-and-drag on a node.
//
// Ordered by what actually decides whether the output is usable. The physical
// millimetre controls come first because a production cut file is defined by
// what a blade can follow, not by pixel fidelity; the pixel-level background
// controls are secondary and collapsed into an "advanced" section.

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronLeft } from "lucide-react";

function Row({ label, value, unit, hint, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <Label className="text-slate-700">{label}</Label>
        <span className="text-slate-500 tabular-nums">{value}{unit}</span>
      </div>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Toggle({ label, hint, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <div>
        <Label className="text-slate-700">{label}</Label>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export default function TraceControls({ params, onChange, measuredWhiteCut }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (key) => (value) => onChange({ ...params, [key]: value });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-slate-700">רוחב סופי (ס״מ)</Label>
        <Input
          type="number"
          min={1}
          step={0.5}
          value={params.widthCm}
          onChange={(e) => set('widthCm')(e.target.value)}
          className="w-32"
        />
        <p className="text-xs text-slate-400">קובע את קנה המידה — כל המרחקים במ״מ מחושבים ביחס אליו.</p>
      </div>

      <Row
        label="איחוד ופישוט"
        value={params.simplifyMm}
        unit=" מ״מ"
        hint="הכי חשוב. מאחד חלקים של אותו אלמנט לקו אחד ומעגל פינות כדי שהסכין תוכל לעקוב. הגדילו אם אלמנט יוצא כמה חתיכות נפרדות, או אם הקו משונן."
      >
        <Slider min={0} max={10} step={0.1} value={[params.simplifyMm]} onValueChange={([v]) => set('simplifyMm')(v)} />
      </Row>

      <Row
        label="מרחק קו החיתוך (Offset)"
        value={params.offsetMm}
        unit=" מ״מ"
        hint="מרווח סביב האלמנט. למדבקות דייקאט בדרך כלל 1–3 מ״מ."
      >
        <Slider min={-10} max={10} step={0.1} value={[params.offsetMm]} onValueChange={([v]) => set('offsetMm')(v)} />
      </Row>

      <Row
        label="גודל חלק מינימלי"
        value={params.minAreaMm2}
        unit=" מ״מ²"
        hint="מוחק חלקים קטנים מדי מכדי להיות אלמנט אמיתי. הגדילו כדי לנקות כתמים שנשארו."
      >
        <Slider min={0} max={500} step={5} value={[params.minAreaMm2]} onValueChange={([v]) => set('minAreaMm2')(v)} />
      </Row>

      <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-slate-700">סף רקע לבן — אוטומטי לפי אלמנט</Label>
            <p className="text-xs text-slate-400 max-w-[230px]">
              בגיליון עם כמה תמונות (מדבקות), לכל אחת רקע משלה — המערכת מודדת ומכיילת בנפרד לכל אלמנט, לא ערך אחד לכולן. כבו רק כדי לכפות ערך ידני אחיד.
            </p>
          </div>
          <Switch
            checked={params.threshold === 'auto'}
            onCheckedChange={(checked) => set('threshold')(checked ? 'auto' : (measuredWhiteCut || 240))}
          />
        </div>
        {params.threshold !== 'auto' && (
          <Row
            label="ערך ידני"
            value={params.threshold}
            hint='נמוך מדי = יאכל גוונים בהירים בתוך האלמנט (חיה מתפרקת לחלקים). גבוה מדי = רקע מלוכלך יישאר.'
          >
            <Slider min={150} max={255} step={1} value={[params.threshold]} onValueChange={([v]) => set('threshold')(v)} />
          </Row>
        )}
      </div>

      <Toggle
        label="הסרת רקע לבן"
        hint="נדרש כשהתמונות מוטמעות כ-JPEG (רקע לבן, לא שקוף). כבו רק אם האלמנט עצמו לבן."
        checked={params.removeWhite !== false}
        onCheckedChange={set('removeWhite')}
      />

      <Toggle
        label="חיתוך חורים פנימיים"
        hint="הדליקו לגרפיקה עם פתחים אמיתיים לחיתוך — פנים של אותיות (O, A, D), חור תלייה. כבוי כברירת מחדל כי בתמונות מצולמות אזורים בהירים בתוך האלמנט (צמר, כתמים לבנים) ייחתכו בטעות ויהרסו את המדבקה."
        checked={params.cutInnerHoles === true}
        onCheckedChange={set('cutInnerHoles')}
      />

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 transition-colors"
      >
        {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        הגדרות מתקדמות
      </button>

      {showAdvanced && (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <Row label="עיגול פינות (Smooth Line)" value={params.alphaMax.toFixed(2)}>
            <Slider min={0} max={1.33} step={0.05} value={[params.alphaMax]} onValueChange={([v]) => set('alphaMax')(v)} />
          </Row>

          <Row label="החלקת קו נוספת" value={params.smoothing} unit=" מעברים">
            <Slider min={0} max={4} step={1} value={[params.smoothing]} onValueChange={([v]) => set('smoothing')(v)} />
          </Row>

          <Row
            label="הסרת קוצים"
            value={params.despikeMm}
            unit=" מ״מ"
            hint="מסיר בליטות דקיקות. השאירו נמוך — ערך גבוה מנתק רגליים ופרטים דקים."
          >
            <Slider min={0} max={3} step={0.1} value={[params.despikeMm]} onValueChange={([v]) => set('despikeMm')(v)} />
          </Row>

          <Row label="איחוי שוליים" value={params.cleanupRadius} unit=" px">
            <Slider min={0} max={12} step={1} value={[params.cleanupRadius]} onValueChange={([v]) => set('cleanupRadius')(v)} />
          </Row>

          <Row label="ניקוי רעש (Speckle)" value={params.speckleArea} unit=" px²">
            <Slider min={0} max={4000} step={50} value={[params.speckleArea]} onValueChange={([v]) => set('speckleArea')(v)} />
          </Row>

          <Row label="טשטוש מקדים" value={params.blurSigma}>
            <Slider min={0} max={15} step={0.5} value={[params.blurSigma]} onValueChange={([v]) => set('blurSigma')(v)} />
          </Row>
        </div>
      )}
    </div>
  );
}
