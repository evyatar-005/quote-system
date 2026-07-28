import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sanitizeDecimal } from '@/lib/utils';

/**
 * @param {{rows: object[], onChange: (id:string, field:string, value:string) => void,
 *   onAdd: () => void, onRemove: (id:string) => void}} props
 */
export default function PartsTable({ rows, onChange, onAdd, onRemove }) {
  const totalPieces = rows.reduce((n, r) => n + (parseInt(r.qty, 10) || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>חלקים לחיתוך</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-[1fr_5rem_5rem_4rem_2rem] gap-2 text-xs text-slate-500 px-1">
          <span>שם</span>
          <span>אורך (מ״מ)</span>
          <span>רוחב (מ״מ)</span>
          <span>כמות</span>
          <span />
        </div>
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_5rem_5rem_4rem_2rem] gap-2 items-center">
            <Input
              value={row.name}
              onChange={(e) => onChange(row.id, 'name', e.target.value)}
              placeholder="לדוגמה: שלט כניסה"
            />
            <Input
              value={row.length}
              dir="ltr"
              inputMode="decimal"
              onChange={(e) => onChange(row.id, 'length', sanitizeDecimal(e.target.value))}
              placeholder="1140"
            />
            <Input
              value={row.width}
              dir="ltr"
              inputMode="decimal"
              onChange={(e) => onChange(row.id, 'width', sanitizeDecimal(e.target.value))}
              placeholder="1950"
            />
            <Input
              value={row.qty}
              dir="ltr"
              inputMode="decimal"
              onChange={(e) => onChange(row.id, 'qty', sanitizeDecimal(e.target.value))}
              placeholder="1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-slate-400 hover:text-red-600"
              onClick={() => onRemove(row.id)}
              aria-label="הסר שורה"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
            <Plus className="w-3.5 h-3.5" /> הוסף חלק
          </Button>
          <span className="text-xs text-slate-500">סה״כ {totalPieces} חתיכות</span>
        </div>
      </CardContent>
    </Card>
  );
}
