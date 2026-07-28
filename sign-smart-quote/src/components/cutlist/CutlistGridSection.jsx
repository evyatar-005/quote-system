import { useState, useRef } from 'react';
import { ChevronDown, Check, X, Menu, ChevronLeft, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { sanitizeDecimal } from '@/lib/utils';

const UNIT_OPTIONS = [
  { value: 'mm', label: 'מ"מ' },
  { value: 'cm', label: 'ס"מ' },
  { value: 'm', label: "מ'" },
];

// Column order as they sit in the DOM (which, under dir="rtl", renders
// physically right-to-left: name is rightmost, qty is leftmost).
const COLS = ['name', 'length', 'width', 'qty'];

/**
 * Compact, spreadsheet-style input grid (name/length/width/qty rows) inside a
 * collapsible gray-bar section - icon+title on the right of the header bar,
 * chevron on the left; borders on every cell, alternating row stripes, small
 * scroll arrows under a horizontally-scrollable table, and a unit selector
 * (מ"מ/ס"מ/מ') at the top - shared with the other table via `unit`/`onUnitChange`
 * so switching it here also converts the other table's numbers.
 *
 * Arrow keys move focus between cells like a spreadsheet: Up/Down to the
 * same column in the row above/below, Left/Right to the neighboring column
 * (physically - i.e. matching what's visually beside the cursor on an RTL
 * screen, not the DOM array direction).
 * @param {{title:string, icon:React.ComponentType, rows:object[],
 *   unit:'mm'|'cm'|'m', onUnitChange:(u:string)=>void,
 *   onChange:(id:string,field:string,value:string)=>void,
 *   onAdd:()=>void, onRemove:(id:string)=>void, defaultOpen?:boolean}} props
 */
export default function CutlistGridSection({
  title,
  icon: Icon,
  rows,
  unit,
  onUnitChange,
  onChange,
  onAdd,
  onRemove,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const scrollRef = useRef(null);
  const cellRefs = useRef({});
  const scrollBy = (dx) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  const focusCell = (rowIndex, colIndex) => {
    if (rowIndex < 0 || rowIndex >= rows.length || colIndex < 0 || colIndex >= COLS.length) return;
    const el = cellRefs.current[`${rowIndex}_${colIndex}`];
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const handleKeyDown = (e, rowIndex, colIndex) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        focusCell(rowIndex - 1, colIndex);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusCell(rowIndex + 1, colIndex);
        break;
      // DOM/array order renders right-to-left under dir="rtl", so the
      // physically-right neighbor is the PREVIOUS column and the
      // physically-left neighbor is the NEXT column.
      case 'ArrowRight':
        e.preventDefault();
        focusCell(rowIndex, colIndex - 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusCell(rowIndex, colIndex + 1);
        break;
      default:
        break;
    }
  };

  const cellProps = (rowIndex, colIndex) => ({
    ref: (el) => (cellRefs.current[`${rowIndex}_${colIndex}`] = el),
    onKeyDown: (e) => handleKeyDown(e, rowIndex, colIndex),
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-slate-300 rounded-md overflow-hidden bg-white">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between bg-slate-100 hover:bg-slate-200 transition-colors px-3 py-2 text-sm font-semibold"
        >
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="flex items-center gap-2">
            {title}
            {Icon && <Icon className="w-4 h-4 text-primary" />}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex items-center justify-start gap-1.5 px-2 py-1 bg-slate-50 border-b border-slate-200 text-xs">
          <span className="text-slate-400">יחידות:</span>
          <select
            value={unit}
            onChange={(e) => onUnitChange(e.target.value)}
            className="h-6 px-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {UNIT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[380px]">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs">
                <th className="text-right font-normal border border-slate-200 px-2 py-1.5">שם</th>
                <th className="text-right font-normal border border-slate-200 px-2 py-1.5">אורך</th>
                <th className="text-right font-normal border border-slate-200 px-2 py-1.5">רוחב</th>
                <th className="text-right font-normal border border-slate-200 px-2 py-1.5">כמות</th>
                <th className="w-16 border border-slate-200 px-2 py-1.5" />
                <th className="w-9 border border-slate-200 px-1 py-1.5">
                  <Menu className="w-3.5 h-3.5 mx-auto text-slate-400" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td className="border border-slate-200 px-1 py-1">
                    <input
                      {...cellProps(i, 0)}
                      value={row.name}
                      onChange={(e) => onChange(row.id, 'name', e.target.value)}
                      className="w-full h-8 px-1.5 text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded"
                      placeholder="שם"
                    />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input
                      {...cellProps(i, 1)}
                      value={row.length}
                      dir="ltr"
                      inputMode="decimal"
                      onChange={(e) => onChange(row.id, 'length', sanitizeDecimal(e.target.value))}
                      className="w-full h-8 px-1.5 text-sm text-center bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded"
                    />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input
                      {...cellProps(i, 2)}
                      value={row.width}
                      dir="ltr"
                      inputMode="decimal"
                      onChange={(e) => onChange(row.id, 'width', sanitizeDecimal(e.target.value))}
                      className="w-full h-8 px-1.5 text-sm text-center bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded"
                    />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <input
                      {...cellProps(i, 3)}
                      value={row.qty}
                      dir="ltr"
                      inputMode="decimal"
                      onChange={(e) => onChange(row.id, 'qty', sanitizeDecimal(e.target.value))}
                      className="w-full h-8 px-1.5 text-sm text-center bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-primary rounded"
                    />
                  </td>
                  <td className="border border-slate-200 px-1 py-1">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={onAdd}
                        className="flex items-center justify-center w-5 h-5 rounded border border-green-500 text-green-600 hover:bg-green-50"
                        aria-label="הוסף שורה"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(row.id)}
                        className="text-red-500 hover:text-red-600"
                        aria-label="הסר שורה"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                  <td className="border border-slate-200 px-1 py-1" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-center gap-2 py-1 bg-slate-50 border-t border-slate-200">
          <button type="button" onClick={() => scrollBy(120)} className="text-slate-400 hover:text-slate-600" aria-label="גלול ימינה">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => scrollBy(-120)} className="text-slate-400 hover:text-slate-600" aria-label="גלול שמאלה">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
