// "מכירות" report — closed (actually ordered) quotes in the reporting period: totals by agent
// AND by product, each with an inline HTML/CSS bar chart (no image
// generation/canvas dependency — plain colored divs render reliably across
// email clients, unlike embedded SVG/canvas charts). Entirely local (no
// Morning call needed): "by agent"/"by product" are our own concepts, not
// Morning's. Plugs into the shared scheduler in scheduledReports.js exactly
// like deliveryNotesReport.js — the report's own period (daily/weekly/
// monthly) always comes from the schedule that triggered it.

const mail = require('../mail');
const { parseRecipients, computeDateRange } = require('./scheduledReports');
const { renderReportEmail, tableShell, tableRow, barCell, formatDateRangeHe } = require('./emailTemplate');

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

// A quote only counts as "closed" once Morning actually issued an ORDER
// document (type 100) for it — see MORNING_ORDER_TYPE in the frontend's
// quoteLabels.js. q.status='approved' is a DIFFERENT thing (an agent's own
// "הנפק הצעת מחיר ללקוח" action, or a manager's review decision) that can be
// true whether or not the client ever actually ordered — using it here used
// to inflate this report's revenue with quotes nobody ever closed, out of
// sync with the in-app "אנליטיקה" screen which was always order-based.
const MORNING_ORDER_TYPE = 100;
function fetchClosedQuoteIds(db) {
  return new Set(
    db.prepare(`SELECT DISTINCT quote_id FROM morning_documents_map WHERE morning_document_type = ?`)
      .all(MORNING_ORDER_TYPE)
      .map((r) => r.quote_id)
  );
}

// One row per agent with at least one quote (any status) in the period,
// ordered highest-selling first. quotesOffered = every quote created,
// regardless of outcome; quotesClosed = the subset that actually became a
// Morning order — revenue/totalBeforeVat only ever come from the closed
// ones, so a pile of never-ordered quotes never inflates the money figures,
// only the offered/closing-rate context around them.
function fetchSalesByAgent(db, fromDate, toDate) {
  return db.prepare(`
    SELECT
      q.created_by AS username,
      COALESCE(u.full_name, q.created_by) AS agentName,
      COUNT(*) AS quotesOffered,
      SUM(CASE WHEN closed.quote_id IS NOT NULL THEN 1 ELSE 0 END) AS quotesClosed,
      SUM(CASE WHEN closed.quote_id IS NOT NULL THEN q.price_before_vat ELSE 0 END) AS totalBeforeVat,
      SUM(CASE WHEN closed.quote_id IS NOT NULL THEN q.price_with_vat ELSE 0 END) AS totalWithVat
    FROM signshop_quotes q
    LEFT JOIN users u ON u.username = q.created_by
    LEFT JOIN (SELECT DISTINCT quote_id FROM morning_documents_map WHERE morning_document_type = ${MORNING_ORDER_TYPE}) closed
      ON closed.quote_id = q.id
    WHERE date(q.created_at) BETWEEN date(?) AND date(?)
    GROUP BY q.created_by
    ORDER BY totalBeforeVat DESC
  `).all(fromDate, toDate);
}

// Per-product rollup across every quote (any status) in the period.
// quotesOffered/quotesClosed count DISTINCT QUOTES that included this
// product (a quote referencing the same product twice via extra-size rows
// still counts once) — revenue/units stay LINE-level and closed-only, same
// as before, deliberately excluding VAT/shipping/installation which don't
// live on a line.
function fetchSalesByProduct(db, fromDate, toDate) {
  const quotes = db.prepare(`
    SELECT id, calculation_data FROM signshop_quotes
    WHERE date(created_at) BETWEEN date(?) AND date(?)
  `).all(fromDate, toDate);
  const closedQuoteIds = fetchClosedQuoteIds(db);

  const map = {};
  const get = (type) => map[type] || (map[type] = { type, name: productLabel(type), revenue: 0, units: 0, quotesOffered: 0, quotesClosed: 0 });

  for (const q of quotes) {
    const closed = closedQuoteIds.has(q.id);
    const typesInThisQuote = new Set();
    for (const l of linesOf(q)) {
      const type = l.productType || '—';
      typesInThisQuote.add(type);
      if (closed) {
        const p = get(type);
        p.revenue += l.result?.sellingPriceAll || 0;
        p.units += l.quantity || 1;
      }
    }
    for (const type of typesInThisQuote) {
      const p = get(type);
      p.quotesOffered += 1;
      if (closed) p.quotesClosed += 1;
    }
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function fmtMoney(n) {
  return `₪ ${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function closingRatePct(closed, offered) {
  return offered > 0 ? `${Math.round((closed / offered) * 100)}%` : '—';
}

function agentSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.totalBeforeVat || 0), 0);
  const tableRows = rows.map((r) => tableRow([
    r.agentName, r.quotesOffered, r.quotesClosed, closingRatePct(r.quotesClosed, r.quotesOffered),
    fmtMoney(r.totalBeforeVat), barCell(r.totalBeforeVat, max),
  ]));
  return tableShell(
    ['סוכן', 'מס׳ הצעות', 'מס׳ סגירות', 'אחוז סגירה', 'סה״כ (לפני מע״מ)', 'חלק יחסי'],
    tableRows,
    'אין הצעות בתקופה זו.'
  );
}

function productSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.revenue || 0), 0);
  const tableRows = rows.map((r) => tableRow([
    r.name, r.quotesOffered, r.quotesClosed, closingRatePct(r.quotesClosed, r.quotesOffered),
    r.units, fmtMoney(r.revenue), barCell(r.revenue, max, '#2563eb'),
  ]));
  return tableShell(
    ['מוצר', 'מס׳ הצעות', 'מס׳ סגירות', 'אחוז סגירה', 'יחידות (סגורות)', 'מחזור (לפני מע״מ)', 'חלק יחסי'],
    tableRows,
    'אין נתוני מוצרים בתקופה זו.'
  );
}

function buildEmail(agentRows, productRows, frequencyLabel, fromDate, toDate) {
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const totalOffered = agentRows.reduce((sum, r) => sum + r.quotesOffered, 0);
  const totalClosed = agentRows.reduce((sum, r) => sum + r.quotesClosed, 0);
  const totalBeforeVat = agentRows.reduce((sum, r) => sum + (r.totalBeforeVat || 0), 0);
  const subject = `דוח מכירות ${frequencyLabel} — ${periodLabel} (${totalClosed}/${totalOffered} הצעות)`;

  const html = renderReportEmail({
    title: 'דוח מכירות',
    periodLabel: `${frequencyLabel} · ${formatDateRangeHe(fromDate, toDate)}`,
    kpis: [
      { label: 'הצעות שהוצאו', value: totalOffered },
      { label: 'הצעות שנסגרו', value: totalClosed },
      { label: 'אחוז סגירה', value: closingRatePct(totalClosed, totalOffered) },
      { label: 'סה״כ לפני מע״מ', value: fmtMoney(totalBeforeVat) },
    ],
    sections: [
      { heading: 'לפי סוכן', tableHtml: agentSectionHtml(agentRows) },
      { heading: 'לפי מוצר', tableHtml: productSectionHtml(productRows) },
    ],
    footerNote: 'נשלח אוטומטית ממערכת הצעות מחיר.',
  });

  const text = `דוח מכירות ${frequencyLabel} — ${periodLabel}\n\n` +
    `${totalClosed}/${totalOffered} הצעות נסגרו (${closingRatePct(totalClosed, totalOffered)}), סה"כ ${fmtMoney(totalBeforeVat)} לפני מע"מ\n\n` +
    `לפי סוכן:\n` + agentRows.map((r) => `${r.agentName}: ${r.quotesClosed}/${r.quotesOffered} הצעות, ${fmtMoney(r.totalBeforeVat)}`).join('\n') +
    `\n\nלפי מוצר:\n` + productRows.map((r) => `${r.name}: ${r.quotesClosed}/${r.quotesOffered} הצעות, ${r.units} יחידות, ${fmtMoney(r.revenue)}`).join('\n');

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
  return { sent: true, count: agentRows.reduce((sum, r) => sum + r.quotesOffered, 0) };
}

module.exports = { REPORT_TYPE, sendReport, fetchSalesByAgent, fetchSalesByProduct };
