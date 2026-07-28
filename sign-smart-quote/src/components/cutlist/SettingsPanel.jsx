import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { sanitizeDecimal } from '@/lib/utils';

const QUALITY_OPTIONS = [
  { value: 'fast', label: 'מהיר' },
  { value: 'normal', label: 'רגיל' },
  { value: 'max', label: 'מקסימלי' },
];

/**
 * @param {{kerf:string, mode:string, quality:string, seed:number, deterministic:boolean,
 *   showLabels:boolean, showCuts:boolean,
 *   onKerfChange, onModeChange, onQualityChange, onSeedChange, onDeterministicChange,
 *   onShowLabelsChange, onShowCutsChange}} props
 */
export default function SettingsPanel({
  kerf,
  mode,
  quality,
  seed,
  deterministic,
  showLabels,
  showCuts,
  onKerfChange,
  onModeChange,
  onQualityChange,
  onSeedChange,
  onDeterministicChange,
  onShowLabelsChange,
  onShowCutsChange,
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>הגדרות חיתוך</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>סוג חיתוך</Label>
          <RadioGroup value={mode} onValueChange={onModeChange} dir="rtl" className="gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="guillotine" id="mode-guillotine" />
              מסור פאנל — חיתוך ישר מקצה לקצה
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <RadioGroupItem value="nest" id="mode-nest" />
              ניסור חופשי — CNC / לייזר
            </label>
          </RadioGroup>
          {mode === 'guillotine' && (
            <p className="text-xs text-slate-500">
              מסור פאנל מחייב חיתוכים ישרים מקצה לקצה, ולכן הניצולת עשויה להיות נמוכה יותר מניסור חופשי.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="kerf">עובי סכין / דיסק (מ״מ)</Label>
          <Input
            id="kerf"
            value={kerf}
            dir="ltr"
            inputMode="decimal"
            onChange={(e) => onKerfChange(sanitizeDecimal(e.target.value))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>איכות חישוב</Label>
          <RadioGroup
            value={quality}
            onValueChange={onQualityChange}
            dir="rtl"
            className="flex flex-row gap-4"
          >
            {QUALITY_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value={o.value} id={`quality-${o.value}`} disabled={deterministic} />
                {o.label}
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="deterministic"
            checked={deterministic}
            onCheckedChange={(v) => onDeterministicChange(Boolean(v))}
          />
          <Label htmlFor="deterministic" className="cursor-pointer font-normal">
            מצב דטרמיניסטי (תוצאה זהה בכל הרצה)
          </Label>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seed">זרע אקראיות</Label>
          <Input
            id="seed"
            value={seed}
            dir="ltr"
            inputMode="numeric"
            onChange={(e) => onSeedChange(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id="showLabels" checked={showLabels} onCheckedChange={(v) => onShowLabelsChange(Boolean(v))} />
          <Label htmlFor="showLabels" className="cursor-pointer font-normal">
            הצג תוויות על החלקים
          </Label>
        </div>

        {mode === 'guillotine' && (
          <div className="flex items-center gap-2">
            <Checkbox id="showCuts" checked={showCuts} onCheckedChange={(v) => onShowCutsChange(Boolean(v))} />
            <Label htmlFor="showCuts" className="cursor-pointer font-normal">
              הצג קווי חיתוך
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
