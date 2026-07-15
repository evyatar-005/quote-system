# חוק עיצוב: גבולות שחורים בולטים (עדכון 2026-07-05)

## הכלל
המשך ישיר ל-[`borders.md`](borders.md) — אביתר דיווח שגם `border-slate-300`/`border-border` עדיין קשה לראות. הסטנדרט עודכן לגבול **שחור בולט**:

- `Card` (ברירת מחדל בקומפוננטה המשותפת) — `border-2 border-slate-900`.
- `CollapsibleSection` — מסגרת חיצונית וגם הקו שמפריד בין הכותרת לתוכן — `border-slate-900`.
- טבלאות בממשק המנהל (רול אפ, מדרגות מחיר וכו') — מסגרת חיצונית `border-2 border-slate-900`, קווי הפרדה בין שורות `border-slate-400` (חזק מספיק לבלוט מול הרקע הבהיר, בלי להיות שחור מלא בתוך הטבלה עצמה).

## למה
`border-slate-300` (התיקון הקודם) עדיין קרוב מדי לרקע הלבן/אפור הבהיר של הכרטיסים — לא מספיק ניגודיות לעין.

## היכן יושם (2026-07-05)
- `src/components/ui/card.jsx`
- `src/components/admin/CollapsibleSection.jsx`
- `src/components/admin/RollupPriceTable.jsx`, `RollupMaterialCostsTable.jsx`, `LokobondAreaPriceTable.jsx`

## כללים לקוד חדש
- כרטיס/קופסה מתקפלת חדשים — גבול חיצוני `border-2 border-slate-900`, לא `border-slate-300`.
- קווי הפרדה פנימיים בטבלה (בין שורות) — `border-slate-400` ומעלה, לא `border-border/30` או פחות.
- עדיין תקף: אף פעם לא `border-white/5`–`border-white/10` על רקע כהה (ראו borders.md).
