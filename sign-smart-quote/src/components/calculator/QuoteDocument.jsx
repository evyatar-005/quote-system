import { useState } from "react";
import { FileText, Printer, X, Plus, Trash2 } from "lucide-react";

const fmt = (val) =>
  val != null
    ? `₪ ${Number(val).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";

const VAT_RATE = 0.18;

let nextLineId = 1;

export default function QuoteDocument({ lineItems: initialLineItems, clientName, quoteNumber, notes, paymentType, onClose }) {
  const [lineItems, setLineItems] = useState(
    initialLineItems.map(item => ({ ...item, _id: nextLineId++, freeText: item.freeText || "" }))
  );
  const [discountType, setDiscountType] = useState("amount");
  const [discountValue, setDiscountValue] = useState(0);

  const updateItem = (id, field, val) => {
    setLineItems(prev => prev.map(item => item._id === id ? { ...item, [field]: val } : item));
  };

  const removeItem = (id) => {
    setLineItems(prev => prev.filter(item => item._id !== id));
  };

  const addManualRow = () => {
    setLineItems(prev => [...prev, {
      _id: nextLineId++,
      productCode: "",
      description: "",
      freeText: "",
      quantity: 1,
      unitPrice: 0,
      isGroupStart: false,
      groupLabel: null,
    }]);
  };

  const subtotal = lineItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0), 0);

  const discountAmount =
    discountType === "percentage"
      ? subtotal * (parseFloat(discountValue) || 0) / 100
      : parseFloat(discountValue) || 0;

  const afterDiscount = subtotal - discountAmount;
  const vatAmount = afterDiscount * VAT_RATE;
  const total = afterDiscount + vatAmount;

  // paymentType עשוי להגיע כ-"installments:5" — מפרקים את מספר התשלומים
  const [payKey, payCount] = (paymentType || "").split(":");
  const paymentLabels = {
    full: "תשלום אחד באשראי",
    cash: "מזומן / העברה בנקאית",
    installments: payCount ? `${payCount} תשלומים` : "תשלומים",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-2" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[95vh] flex flex-col"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <span className="font-bold text-slate-800 text-lg">הצעת מחיר</span>
            {quoteNumber && <span className="text-slate-400 font-mono text-sm">#{quoteNumber}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" /> הדפסה
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-6 gap-4">
          {/* Meta */}
          <div className="grid grid-cols-3 gap-4 flex-shrink-0">
            <div className="space-y-1">
              <div className="text-sm text-slate-400 font-semibold">שם הלקוח</div>
              <div className="font-semibold text-slate-800 text-lg">{clientName || "—"}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-slate-400 font-semibold">תאריך מסמך</div>
              <div className="font-semibold text-slate-700 text-base">{new Date().toLocaleDateString("he-IL")}</div>
            </div>
            {notes && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-2">
                <div className="text-sm font-semibold text-amber-700 mb-0.5">הערות</div>
                <div className="text-base text-slate-700 truncate">{notes}</div>
              </div>
            )}
          </div>

          {/* Main body: table + sidebar */}
          <div className="flex-1 overflow-hidden flex gap-4">
            {/* Left: table */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="text-base font-bold text-slate-700 mb-2 flex-shrink-0">רשימת פריטים</div>
              <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="overflow-y-auto flex-1">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0 z-10">
                      <tr>
                        <th className="text-right px-3 py-2.5 font-semibold w-24">מק״ט</th>
                        <th className="text-right px-3 py-2.5 font-semibold">פירוט</th>
                        <th className="text-center px-3 py-2.5 font-semibold w-16">כמות</th>
                        <th className="text-left px-3 py-2.5 font-semibold w-32">מחיר ליח׳</th>
                        <th className="text-left px-3 py-2.5 font-semibold w-28">מע״מ</th>
                        <th className="text-left px-3 py-2.5 font-semibold w-32">סה״כ</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item) => {
                        const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
                        const lineVat = lineTotal * VAT_RATE;
                        return (
                          <>
                            {item.isGroupStart && item.groupLabel && (
                              <tr key={`group-${item._id}`} className="bg-amber-50 border-t border-amber-200">
                                <td colSpan={7} className="px-3 py-2 text-xs font-bold text-amber-700 uppercase tracking-wider">
                                  {item.groupLabel}
                                </td>
                              </tr>
                            )}
                            <tr key={item._id} className="border-t border-slate-100 hover:bg-slate-50/50 group">
                              <td className="px-2 py-2 align-middle">
                                <input type="text" value={item.productCode} onChange={(e) => updateItem(item._id, "productCode", e.target.value)}
                                  className="w-full font-mono text-xs text-slate-500 bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 focus:bg-white rounded px-1.5 py-1 focus:outline-none transition-colors"
                                  placeholder="מק״ט" dir="ltr" />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <input type="text" value={item.description} onChange={(e) => updateItem(item._id, "description", e.target.value)}
                                  className="w-full text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 focus:bg-white rounded px-1.5 py-1 focus:outline-none transition-colors text-sm"
                                  placeholder="הקלד תיאור שירות או מוצר" />
                                <input type="text" value={item.freeText} onChange={(e) => updateItem(item._id, "freeText", e.target.value)}
                                  placeholder="הערה נוספת..."
                                  className="w-full text-xs text-slate-400 bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-300 focus:bg-white rounded px-1.5 py-0.5 focus:outline-none transition-colors mt-0.5" />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(item._id, "quantity", e.target.value)}
                                  className="w-full text-center text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 focus:bg-white rounded px-1.5 py-1 focus:outline-none transition-colors text-sm" dir="ltr" />
                              </td>
                              <td className="px-2 py-2 align-middle">
                                <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(item._id, "unitPrice", e.target.value)}
                                  className="w-full text-left text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-amber-400 focus:bg-white rounded px-1.5 py-1 focus:outline-none transition-colors text-sm" dir="ltr" />
                              </td>
                              <td className="px-2 py-2 align-middle text-left text-slate-500 text-sm whitespace-nowrap">{lineTotal > 0 ? fmt(lineVat) : "—"}</td>
                              <td className="px-2 py-2 align-middle text-left font-semibold text-slate-800 text-sm whitespace-nowrap">{lineTotal > 0 ? fmt(lineTotal + lineVat) : "—"}</td>
                              <td className="px-1 py-2 align-middle">
                                <button onClick={() => removeItem(item._id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-red-400 transition-all">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Add row — inside the border, at the bottom */}
                <div className="border-t border-slate-100 flex-shrink-0">
                  <button onClick={addManualRow}
                    className="w-full flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-600 transition-colors px-3 py-2 hover:bg-amber-50">
                    <Plus className="w-3.5 h-3.5" /> הוסף שורה
                  </button>
                </div>
              </div>
            </div>

            {/* Right: discount + totals */}
            <div className="w-72 flex-shrink-0 flex flex-col gap-4">
              {/* Discount */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-500">הנחה</div>
                <div className="flex flex-col gap-2">
                  <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}
                    className="text-base border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 w-full">
                    <option value="amount">סכום קבוע (₪)</option>
                    <option value="percentage">אחוזים (%)</option>
                  </select>
                  <div className="flex gap-2 items-center">
                    <input type="number" min="0" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                      className="flex-1 text-base border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 text-left"
                      dir="ltr" placeholder="0" />
                    {discountAmount > 0 && (
                      <span className="text-base text-emerald-600 font-semibold whitespace-nowrap">− {fmt(discountAmount)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-base">
                <div className="flex justify-between text-slate-500">
                  <span>סכום לפני הנחה</span>
                  <span>{fmt(subtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>הנחה</span>
                    <span>− {fmt(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>מע״מ (18%)</span>
                  <span>{fmt(vatAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 text-2xl pt-2 border-t border-slate-200">
                  <span>סה״כ לתשלום</span>
                  <span className="text-amber-600">{fmt(total)}</span>
                </div>
                {paymentType && (
                  <div className="text-sm text-slate-400 text-right mt-1">{paymentLabels[payKey]}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}