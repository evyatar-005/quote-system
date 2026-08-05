// Sliders driving the trace/offset pass — the automated equivalent of the
// Illustrator Image Trace / Expand / Smooth Line / Offset Path parameters.
// This is the ONLY correction mechanism (per the agreed design — no manual
// Bézier point editing): if the traced line looks wrong, the fix is a slider,
// not a click-and-drag on a node.

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

function Row({ label, value, unit, children }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <Label className="text-slate-700">{label}</Label>
        <span className="text-slate-500 tabular-nums">{value}{unit}</span>
      </div>
      {children}
    </div>
  );
}

export default function TraceControls({ params, onChange, hasAlpha }) {
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
        <p className="text-xs text-slate-400">קובע את קנה המידה — כל המרחקים (כולל מרחק ההזזה) מחושבים ביחס אליו.</p>
      </div>

      {!hasAlpha && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
          <div>
            <Label className="text-slate-700">זיהוי חורים פנימיים</Label>
            <p className="text-xs text-slate-400 max-w-[220px]">
              לתמונה בלי שקיפות: מופעל = חורים סגורים (כמו אות O) ייחתכו, אך אזורים בהירים בתוך העצם (כמו חולצה לבנה) עלולים להיחתך בטעות.
            </p>
          </div>
          <Switch
            checked={params.holeMode === 'detect'}
            onCheckedChange={(checked) => set('holeMode')(checked ? 'detect' : 'protect')}
          />
        </div>
      )}

      <Row label="סף רגישות (Threshold)" value={params.threshold}>
        <Slider min={1} max={254} step={1} value={[params.threshold]} onValueChange={([v]) => set('threshold')(v)} />
      </Row>

      <Row label="ניקוי רעש (Speckle)" value={params.turdSize} unit=" px²">
        <Slider min={0} max={40} step={1} value={[params.turdSize]} onValueChange={([v]) => set('turdSize')(v)} />
      </Row>

      <Row label="עיגול פינות (Smooth Line)" value={params.alphaMax.toFixed(2)}>
        <Slider min={0} max={1.33} step={0.05} value={[params.alphaMax]} onValueChange={([v]) => set('alphaMax')(v)} />
      </Row>

      <Row label="החלקת קו נוספת" value={params.smoothing} unit=" מעברים">
        <Slider min={0} max={4} step={1} value={[params.smoothing]} onValueChange={([v]) => set('smoothing')(v)} />
      </Row>

      <Row label="מרחק קו החיתוך (Offset)" value={params.offsetMm} unit=" מ״מ">
        <Slider min={-10} max={10} step={0.1} value={[params.offsetMm]} onValueChange={([v]) => set('offsetMm')(v)} />
      </Row>
    </div>
  );
}
