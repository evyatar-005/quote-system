import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

// Same split rule as the backend's parseRecipients (scheduledReports.js) —
// comma/semicolon/newline separated, trimmed, de-duplicated, blanks dropped.
export function parseRecipients(raw) {
  if (!raw) return [];
  const seen = new Set();
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s) && seen.add(s));
}

// Add/remove chip editor for a comma-separated recipient list — shared by
// every report card so each one doesn't reimplement the same input+chips.
export default function RecipientsEditor({ recipients, onChange }) {
  const [input, setInput] = useState("");

  const add = () => {
    const email = input.trim();
    if (!email) return;
    if (!recipients.includes(email)) onChange([...recipients, email]);
    setInput("");
  };
  const remove = (email) => onChange(recipients.filter((r) => r !== email));

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-semibold text-slate-600">נמענים</label>
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recipients.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-full pl-1 pr-3 py-1"
              dir="ltr"
            >
              {email}
              <button
                type="button"
                onClick={() => remove(email)}
                className="p-0.5 rounded-full hover:bg-slate-200 text-slate-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          dir="ltr"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          placeholder="office@printela.co.il"
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={add} className="gap-1.5 shrink-0">
          <Plus className="w-4 h-4" /> הוסף
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">אפשר להוסיף כמה כתובות שרוצים. רשימה ריקה = הדוח לא נשלח.</p>
    </div>
  );
}
