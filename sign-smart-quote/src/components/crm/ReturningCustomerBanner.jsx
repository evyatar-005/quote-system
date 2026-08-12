import { Link } from "react-router-dom";
import { Award, History } from "lucide-react";

// The "you already know this person" strip. Until now an agent opened a brand
// new lead with no hint that the same phone number bought a sign from us last
// year — the link existed in the data (customers are matched on phone at
// import) but was only ever visible on the customers screen, which an agent
// never visits.
//
// Two distinct states, on purpose:
//   • רוכש חוזר — a Morning ORDER document exists on one of their past quotes.
//     This is a real purchase, and it is the same signal that marks a lead
//     'won', so it can't disagree with the analytics.
//   • פנייה חוזרת — they have earlier leads/quotes but never actually bought.
//     Much weaker, and shown in a quieter colour so the two never blur.
// Nothing at all renders for a genuinely new person, so the banner keeps its
// meaning.

const dateOnly = (s) => (s ? String(s).slice(0, 10) : null);

export default function ReturningCustomerBanner({ history, customerId }) {
  if (!history) return null;
  const { is_returning_buyer, purchases, total_purchased, last_purchase_at, prior_leads, prior_quotes, other_leads } = history;
  if (!is_returning_buyer && !prior_leads && !prior_quotes) return null;

  const tone = is_returning_buyer
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`border rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${tone}`}>
      <span className="flex items-center gap-1.5 font-semibold">
        {is_returning_buyer ? <Award className="w-4 h-4" /> : <History className="w-4 h-4" />}
        {is_returning_buyer ? "לקוח חוזר — כבר קנה מאיתנו" : "פנייה חוזרת — עדיין לא רכש"}
      </span>

      {is_returning_buyer && (
        <span>
          {purchases} הזמנות
          {total_purchased > 0 && <> · ₪{Number(total_purchased).toLocaleString("he-IL", { maximumFractionDigits: 0 })}</>}
          {last_purchase_at && <> · אחרונה {dateOnly(last_purchase_at)}</>}
        </span>
      )}

      {prior_leads > 0 && (
        <span className="text-xs opacity-80">
          {prior_leads} פניות קודמות
          {other_leads?.[0]?.campaign_name && <> (אחרונה: {other_leads[0].campaign_name})</>}
        </span>
      )}
      {prior_quotes > 0 && <span className="text-xs opacity-80">{prior_quotes} הצעות קודמות</span>}

      <Link to={`/crm/customers/${customerId}`} className="mr-auto text-xs font-semibold underline underline-offset-2">
        פתח כרטיס לקוח ←
      </Link>
    </div>
  );
}
