// "מכירות" report — approved quotes in the reporting period: totals by agent
// AND by product, each with an inline HTML/CSS bar chart (no image
// generation/canvas dependency — plain colored divs render reliably across
// email clients, unlike embedded SVG/canvas charts). Entirely local (no
// Morning call needed): "by agent"/"by product" are our own concepts, not
// Morning's. Plugs into the shared scheduler in scheduledReports.js exactly
// like deliveryNotesReport.js — the report's own period (daily/weekly/
// monthly) always comes from the schedule that triggered it.

const mail = require('../mail');
const { parseRecipients, computeDateRange } = require('./scheduledReports');
const { renderReportEmail, tableShell, tableRow, barCell } = require('./emailTemplate');

const REPORT_TYPE = 'sales';
const FREQUENCY_LABELS = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

// Minimal label map for the calculator's productType slugs — good enough for
// an email report; the full PRODUCT_NAMES table lives in the frontend
// calculator (CalculatorForm.jsx) and isn't reachable from the backend.
// Falls back to the raw slug for anything not listed here.
const PRODUCT_LABELS = {
  pvc_white: 'PVC לבן', pvc_black: 'PVC שחור',
  perspex_print: 'פרספקס הדפסה', perspex_print_back: 'פרספקס הדפסה אחורית',
  perspex_black: 'פרספקס שחור', perspex_white: 'פרספקס לבן', perspex_milky: 'פרספקס חלבי',
  perspex_mirror: 'פרספקס מראה', perspex_metallic: 'פרספקס מטאלי',
  vinyl_sticker: 'מדבקת ויניל', texture_sticker: 'מדבקת טקסטורה',
  lokobond_diecut: 'לוקובונד דייקאט', lokobond_plain: 'לוקובונד חלק',
  foamex_white: 'פיוויסי לבן', foamex_black: 'פיוויסי שחור',
  kapa: 'קאפה',
  rollup_magnetic: 'רול אפ מגנטי', rollup_regular: 'רול אפ רגיל',
  perspex_board_clear_print: 'ארגז מואר שקוף', perspex_board_black_matte: 'ארגז מואר שחור מאט',
  perspex_board_black_glossy: 'ארגז מואר שחור מבריק', perspex_board_white: 'ארגז מואר לבן',
  perspex_board_milky: 'ארגז מואר חלבי', perspex_board_back_print: 'ארגז מואר הדפסה אחורית',
  glass_extra_clear: 'זכוכית אקסטרה קלירה',
  free_product: 'מוצר חופשי',
};
const productLabel = (type) => PRODUCT_LABELS[type] || type || '—';

function safeParseJson(json, fallback) {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
}

// Every priced line in a quote's saved calculation_data — parent items plus
// their extra-size rows — mirrors linesOf() in the frontend's
// quoteEconomics.js (kept independent since that file is browser-only:
// imports PRODUCT_NAMES/PRODUCT_CODES from a React component module).
function linesOf(quote) {
  const calc = safeParseJson(quote.calculation_data, null);
  const items = calc?.items || [];
  const out = [];
  for (const it of items) {
    if (it?.result) out.push({ productType: it.productType, result: it.result, quantity: parseFloat(it.quantity) || 1 });
    for (const er of it?.extraRows || []) {
      if (er?.result) out.push({ productType: it.productType, result: er.result, quantity: parseFloat(er.quantity) || 1 });
    }
  }
  return out;
}

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

// Per-product rollup across the same approved quotes, at the LINE level —
// deliberately excludes VAT/shipping/installation, none of which live on a
// line, so "which product earned most" isn't diluted by quote-level extras.
function fetchSalesByProduct(db, fromDate, toDate) {
  const quotes = db.prepare(`
    SELECT calculation_data FROM signshop_quotes
    WHERE status = 'approved' AND date(created_at) BETWEEN date(?) AND date(?)
  `).all(fromDate, toDate);

  const map = {};
  for (const q of quotes) {
    for (const l of linesOf(q)) {
      const type = l.productType || '—';
      if (!map[type]) map[type] = { type, name: productLabel(type), revenue: 0, units: 0, lines: 0 };
      map[type].revenue += l.result?.sellingPriceAll || 0;
      map[type].units += l.quantity || 1;
      map[type].lines += 1;
    }
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function fmtMoney(n) {
  return `₪ ${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function agentSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.totalBeforeVat || 0), 0);
  const tableRows = rows.map((r) => tableRow([r.agentName, r.quoteCount, fmtMoney(r.totalBeforeVat), barCell(r.totalBeforeVat, max)]));
  return tableShell(['סוכן', 'מס׳ הצעות', 'סה״כ (לפני מע״מ)', 'חלק יחסי'], tableRows, 'לא אושרו הצעות בתקופה זו.');
}

function productSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.revenue || 0), 0);
  const tableRows = rows.map((r) => tableRow([r.name, r.units, fmtMoney(r.revenue), barCell(r.revenue, max, '#2563eb')]));
  return tableShell(['מוצר', 'יחידות', 'מחזור (לפני מע״מ)', 'חלק יחסי'], tableRows, 'אין נתוני מוצרים בתקופה זו.');
}

function buildEmail(agentRows, productRows, frequencyLabel, fromDate, toDate) {
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const totalQuotes = agentRows.reduce((sum, r) => sum + r.quoteCount, 0);
  const totalBeforeVat = agentRows.reduce((sum, r) => sum + (r.totalBeforeVat || 0), 0);
  const subject = `דוח מכירות ${frequencyLabel} — ${periodLabel} (${totalQuotes} הצעות)`;

  const html = renderReportEmail({
    title: 'דוח מכירות',
    periodLabel: `${frequencyLabel} · ${periodLabel}`,
    kpis: [
      { label: 'הצעות שאושרו', value: totalQuotes },
      { label: 'סה״כ לפני מע״מ', value: fmtMoney(totalBeforeVat) },
    ],
    sections: [
      { heading: 'לפי סוכן', tableHtml: agentSectionHtml(agentRows) },
      { heading: 'לפי מוצר', tableHtml: productSectionHtml(productRows) },
    ],
    footerNote: 'נשלח אוטומטית ממערכת הצעות מחיר.',
  });

  const text = `דוח מכירות ${frequencyLabel} — ${periodLabel}\n\n` +
    `${totalQuotes} הצעות, סה"כ ${fmtMoney(totalBeforeVat)} לפני מע"מ\n\n` +
    `לפי סוכן:\n` + agentRows.map((r) => `${r.agentName}: ${r.quoteCount} הצעות, ${fmtMoney(r.totalBeforeVat)}`).join('\n') +
    `\n\nלפי מוצר:\n` + productRows.map((r) => `${r.name}: ${r.units} יחידות, ${fmtMoney(r.revenue)}`).join('\n');

  return { subject, html, text };
}

async function sendReport(db, cfg) {
  const recipients = parseRecipients(cfg.recipients);
  if (!recipients.length) return { sent: false };

  // The report's own period always matches the schedule that triggered it —
  // a daily schedule reports on today, a monthly one on the last 30 days,
  // etc. (computeDateRange), never a fixed window independent of frequency.
  const { fromDate, toDate } = computeDateRange(cfg.frequency, new Date());
  const agentRows = fetchSalesByAgent(db, fromDate, toDate);
  const productRows = fetchSalesByProduct(db, fromDate, toDate);
  const { subject, html, text } = buildEmail(agentRows, productRows, FREQUENCY_LABELS[cfg.frequency] || cfg.frequency, fromDate, toDate);
  await mail.sendMail(db, { to: recipients.join(', '), subject, html, text });
  console.log(`[salesReport] sent sales for ${agentRows.length} agent(s)/${productRows.length} product(s), ${fromDate}..${toDate}, to ${recipients.join(', ')}`);
  return { sent: true, count: agentRows.reduce((sum, r) => sum + r.quoteCount, 0) };
}

module.exports = { REPORT_TYPE, sendReport, fetchSalesByAgent, fetchSalesByProduct };
