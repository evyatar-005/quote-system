import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function CostInputField({ label, suffix, value, onChange, fieldKey }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldKey} className="text-sm font-semibold text-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={fieldKey}
          type="number"
          step="any"
          min="0"
          value={value ?? ""}
          onChange={(e) => onChange(fieldKey, e.target.value === "" ? null : parseFloat(e.target.value))}
          className="h-10 text-left pr-4 pl-10 bg-background border-slate-400 focus:border-primary/50 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          dir="ltr"
        />
        {suffix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}