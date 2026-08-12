import { useState } from "react";
import { ChevronDown, ChevronUp, Mail, Phone, Tag, Loader2, CheckCircle2, Circle } from "lucide-react";
import LastHandledLine from "./LastHandledLine";
import { leadQueue } from "@/api/leadQueueClient";
import { toast } from "sonner";

// The lead's identity strip + "every field the campaign pulls" (CRM plan
// Phase 5 §7/§9). Values come straight from monday_item_map.raw_json via
// leadContext.js — friendly titles when the board has them, the raw column
// id otherwise. A value is never hidden just because it lacks a title.
// Status-type columns (f.labels present) render as an editable dropdown
// sourced from monday's real label bank for that board, and write straight
// back to monday.com — everything else is read-only display.
export default function LeadFieldsPanel({ context, leadId, onUpdated }) {
  const [showSystem, setShowSystem] = useState(false);
  const [savingCol, setSavingCol] = useState(null);
  if (!context) return null;
  const { lead, customer, campaign, last_handled, monday, document_status } = context;

  const updateField = async (columnId, value) => {
    setSavingCol(columnId);
    try {
      const updated = await leadQueue.updateMondayField(leadId, columnId, value);
      onUpdated?.(updated);
      toast.success("עודכן במנדיי");
    } catch (err) {
      toast.error(err.message || "העדכון נכשל");
    } finally {
      setSavingCol(null);
    }
  };
  const fields = monday?.fields || [];
  const visible = fields.filter((f) => !f.system);
  const system = fields.filter((f) => f.system);

  return (
    // h-full + a short floor: the workspace stacks this above the Drive panel in
    // a fixed-height column, so the panel fills its share and scrolls its own
    // fields instead of setting the column's height from its content.
    <div className="border border-black rounded-xl bg-white flex flex-col h-full min-h-[200px]">
      {/* Name and campaign are NOT repeated here — LeadWorkspacePanel's header
          already names the lead right above this column, and the WhatsApp thread
          names it a third time. What's left is the contact detail worth acting
          on (click-to-call, email) plus who touched it last. */}
      <div className="px-4 py-3 border-b border-slate-200 space-y-1">
        {customer?.email && (
          <div className="text-xs text-slate-500 flex items-center gap-1 truncate">
            <Mail className="w-3 h-3 shrink-0" /> {customer.email}
          </div>
        )}
        <LastHandledLine lastHandled={last_handled} />
        {customer?.phone_e164 && (
          // Click-to-call — currently just tel: (opens the OS dialer / any
          // registered softphone); once a PBX (מרכזייה) integration exists
          // this is the hook point to trigger an outbound call through it.
          <a href={`tel:${customer.phone_e164}`} className="text-xs text-primary hover:underline flex items-center gap-1 w-fit" dir="ltr">
            <Phone className="w-3 h-3" /> {customer.phone_e164}
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 && !monday && (
          <div className="text-xs text-slate-400 text-center py-6">ליד ידני — אין שדות קמפיין</div>
        )}
        {visible.map((f) => (
          <div key={f.column_id} className="text-xs">
            <div className="text-slate-400 flex items-center gap-1">
              {f.title}
              {savingCol === f.column_id && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            {f.labels ? (
              <select
                value={f.text || ""}
                disabled={savingCol === f.column_id}
                onChange={(e) => updateField(f.column_id, e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-md px-1.5 py-1 bg-white mt-0.5"
              >
                {!f.labels.includes(f.text) && <option value={f.text || ""}>{f.text || "—"}</option>}
                {f.labels.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            ) : (
              <div className="text-slate-700 break-words">{f.text}</div>
            )}
          </div>
        ))}

        {system.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowSystem((v) => !v)}
              className="text-xs text-slate-400 flex items-center gap-1"
            >
              {showSystem ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showSystem ? "הסתר שדות מערכת" : `הצג שדות מערכת (${system.length})`}
            </button>
            {showSystem && (
              <div className="mt-2 space-y-2">
                {system.map((f) => (
                  <div key={f.column_id} className="text-xs">
                    <div className="text-slate-400">{f.title}</div>
                    <div className="text-slate-500 break-words">{f.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {document_status && (
        // Derived from real Morning document state (morning_documents_map),
        // not manually set — see services/crm/leadOutcome.js. hasDeliveryNote
        // realistically stays false today: no screen yet converts a quote to
        // a delivery-note document per-quote.
        <div className="px-4 py-2 border-t border-slate-200 space-y-1">
          <div className="text-xs text-slate-400 mb-1">מצב מסמכים</div>
          <DocRow ok={document_status.hasQuoteDoc} label="הצעת מחיר" />
          <DocRow ok={document_status.hasOrder} label="הזמנת עבודה" />
          <DocRow ok={document_status.hasDeliveryNote} label="תעודת משלוח" />
        </div>
      )}

      {lead?.status && (
        <div className="px-4 py-2 border-t border-slate-200 text-xs text-slate-400">
          סטטוס: <span className="text-slate-600 font-medium">{lead.status}</span>
        </div>
      )}
    </div>
  );
}

function DocRow({ ok, label }) {
  return (
    <div className={`text-xs flex items-center gap-1.5 ${ok ? "text-emerald-600" : "text-slate-400"}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
      {label}
    </div>
  );
}
