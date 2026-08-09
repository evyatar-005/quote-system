// "מכירות" report — approved quotes in the reporting period, summed by
// agent (created_by). Entirely local (no Morning call needed): "by agent" is
// our own concept, not Morning's, and price_before_vat/price_with_vat are
// already saved on every quote at approval time. Plugs into the shared
// scheduler in scheduledReports.js exactly like deliveryNotesReport.js.

const mail = require('../mail');
const { getReportConfig, parseRecipients, computeDateRange } = require('./scheduledReports');

const REPORT_TYPE = 'sales';
const FREQUENCY_LABELS = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

// One row per agent who has at least one approved quote in the period,
// ordered highest-selling first — the sums an admin actually opens this
// report to see.
function fetchSalesByAgent(db, fromDate, toDate) {
  return db.prepare(`
    SELECT
      q.created_by AS username,
      COALESCE(u.full_name, q.created_by) AS agentName,
      COUNT(*) AS quoteCount,
      SUM(q.price_before_vat) AS totalBeforeVat,
      SUM(q.price_with_vat) AS totalWithVat
    FROM signshop_quotes q
    LEFT JOIN users u ON u.username = q.created_by
    WHERE q.status = 'approved'
      AND date(q.created_at) BETWEEN date(?) AND date(?)
    GROUP BY q.created_by
    ORDER BY totalBeforeVat DESC
  `).all(fromDate, toDate);
}

function buildEmail(rows, frequencyLabel, fromDate, toDate) {
  const fmt = (n) => `₪ ${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const totalQuotes = rows.reduce((sum, r) => sum + r.quoteCount, 0);
  const totalBeforeVat = rows.reduce((sum, r) => sum + (r.totalBeforeVat || 0), 0);
  const subject = `דוח מכירות ${frequencyLabel} — ${periodLabel} (${totalQuotes} הצעות)`;

  const tableRows = rows
    .map((r) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${r.agentName}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${r.quoteCount}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${fmt(r.totalBeforeVat)}</td></tr>`)
    .join('');

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; color: #1e293b;">
      <p>שלום,</p>
      <p>בתקופה ${periodLabel} אושרו <strong>${totalQuotes}</strong> הצעות, בסך כולל (לפני מע״מ) של <strong>${fmt(totalBeforeVat)}</strong>.</p>
      ${rows.length ? `
      <table style="border-collapse:collapse; margin-top:12px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:6px 10px; text-align:right;">סוכן</th>
            <th style="padding:6px 10px; text-align:right;">מס׳ הצעות</th>
            <th style="padding:6px 10px; text-align:right;">סה״כ (לפני מע״מ)</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>` : '<p>לא אושרו הצעות בתקופה זו.</p>'}
    </div>`;

  const text = `דוח מכירות ${frequencyLabel} — ${periodLabel}\n\n` +
    `${totalQuotes} הצעות, סה"כ ${fmt(totalBeforeVat)} לפני מע"מ\n\n` +
    rows.map((r) => `${r.agentName}: ${r.quoteCount} הצעות, ${fmt(r.totalBeforeVat)}`).join('\n');

  return { subject, html, text };
}

async function sendReport(db, cfg) {
  const recipients = parseRecipients(cfg.recipients);
  if (!recipients.length) return { sent: false };

  const { fromDate, toDate } = computeDateRange(cfg.frequency, new Date());
  const rows = fetchSalesByAgent(db, fromDate, toDate);
  const { subject, html, text } = buildEmail(rows, FREQUENCY_LABELS[cfg.frequency] || cfg.frequency, fromDate, toDate);
  await mail.sendMail(db, { to: recipients.join(', '), subject, html, text });
  console.log(`[salesReport] sent sales for ${rows.length} agent(s), ${fromDate}..${toDate}, to ${recipients.join(', ')}`);
  return { sent: true, count: rows.reduce((sum, r) => sum + r.quoteCount, 0) };
}

async function sendNow(db) {
  const cfg = getReportConfig(db, REPORT_TYPE);
  if (!cfg) return { sent: false };
  return sendReport(db, cfg);
}

module.exports = { REPORT_TYPE, sendReport, sendNow, fetchSalesByAgent };
