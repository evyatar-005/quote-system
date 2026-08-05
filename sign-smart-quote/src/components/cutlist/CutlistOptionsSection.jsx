import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { sanitizeDecimal } from '@/lib/utils';

/** Row helper: label on the right, control on the left - matches the compact options list in the reference. */
function OptionRow({ label, children }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 last:border-0">
      <Label className="text-sm font-normal">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Minimalist collapsible "אופציות" section matching the cutlistoptimizer.com
 * reference: gray header bar + a flat list of labeled toggle rows.
 */
export default function CutlistOptionsSection({
  kerf,
  mode,
  deterministic,
  showLabels,
  showCuts,
  somaPerSheet,
  somaPerPart,
  onKerfChange,
  onModeChange,
  onDeterministicChange,
  onShowLabelsChange,
  onShowCutsChange,
  onSomaPerSheetChange,
  onSomaPerPartChange,
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-slate-300 rounded-md overflow-hidden bg-white">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between bg-slate-100 hover:bg-slate-200 transition-colors px-3 py-2 text-sm font-semibold"
        >
          <span className="flex items-center gap-2">
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? '' : '-rotate-90'}`} />
            אופציות
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <OptionRow label='גודל להב החיתוך (מ"מ)'>
          <input
            value={kerf}
            dir="ltr"
            inputMode="decimal"
            onChange={(e) => onKerfChange(sanitizeDecimal(e.target.value))}
            className="w-16 h-8 px-2 text-sm text-center border border-slate-300 rounded"
          />
        </OptionRow>

        <OptionRow label="ניסור חופשי (CNC / לייזר) במקום מסור פאנל">
          <Switch
            checked={mode === 'nest'}
            onCheckedChange={(v) => onModeChange(v ? 'nest' : 'guillotine')}
            className="data-[state=unchecked]:bg-slate-300"
          />
        </OptionRow>

        <OptionRow label="הצג שמות ומידות על החלקים">
          <Switch checked={showLabels} onCheckedChange={onShowLabelsChange} className="data-[state=unchecked]:bg-slate-300" />
        </OptionRow>

        {mode === 'guillotine' && (
          <OptionRow label="הצג קווי חיתוך">
            <Switch checked={showCuts} onCheckedChange={onShowCutsChange} className="data-[state=unchecked]:bg-slate-300" />
          </OptionRow>
        )}

        <OptionRow label="מצב דטרמיניסטי (תוצאה זהה בכל הרצה)">
          <Switch checked={deterministic} onCheckedChange={onDeterministicChange} className="data-[state=unchecked]:bg-slate-300" />
        </OptionRow>

        <OptionRow label='רוחב פס נקודות סומא לכל הפלטה (מ"מ)'>
          <input
            value={somaPerSheet}
            dir="ltr"
            inputMode="decimal"
            onChange={(e) => onSomaPerSheetChange(sanitizeDecimal(e.target.value))}
            className="w-16 h-8 px-2 text-sm text-center border border-slate-300 rounded"
          />
        </OptionRow>

        <OptionRow label='רוחב פס נקודות סומא לכל חלק (מ"מ)'>
          <input
            value={somaPerPart}
            dir="ltr"
            inputMode="decimal"
            onChange={(e) => onSomaPerPartChange(sanitizeDecimal(e.target.value))}
            className="w-16 h-8 px-2 text-sm text-center border border-slate-300 rounded"
          />
        </OptionRow>
      </CollapsibleContent>
    </Collapsible>
  );
}
