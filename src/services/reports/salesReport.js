// "מכירות" report — closed (actually ordered) quotes in the reporting period: totals by agent
// AND by product, each with an inline HTML/CSS bar chart (no image
// generation/canvas dependency — plain colored divs render reliably across
// email clients, unlike embedded SVG/canvas charts). Entirely local (no
// Morning call needed): "by agent"/"by product" are our own concepts, not
// Morning's. Plugs into the shared scheduler in scheduledReports.js exactly
// like deliveryNotesReport.js — the report's own period (daily/weekly/
// monthly) always comes from the schedule that triggered it.

const mail = require('../mail');
const { request } = require('../morning/client');
const { fetchMorningOnlyDocuments } = require('../morning/directDocuments');
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

// 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD', for comparing against fromDate/toDate.
const dateStr = (ts) => (ts || '').slice(0, 10);

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

// A revision/duplicate ("שכפול") is saved as a NEW quote row carrying
// parent_quote_number — so a quote sent for review and then re-issued with a
// manager's discount exists twice, and summing both counted the same real
// deal twice. Only the row nothing else supersedes is the live version.
// Mirrors latestRevisionsOnly() in the frontend's quoteEconomics.js.
const NOT_SUPERSEDED = (alias) => `
  NOT EXISTS (
    SELECT 1 FROM signshop_quotes r
    WHERE r.parent_quote_number IS NOT NULL
      AND r.parent_quote_number = ${alias}.quote_number
  )`;
// Earliest order-document date per quote — a quote can be drafted days
// before it actually turns into a Morning order, so the report period must
// go by WHEN IT WAS ORDERED (this timestamp), never by the quote's original
// created_at. Filtering by created_at instead misattributes an order to the
// day its quote was first drafted, so "today's" report silently misses
// orders that were only confirmed today from an older quote — the exact gap
// that showed up between this report and Morning's own daily document list.
function fetchOrderedDates(db) {
  const map = new Map();
  for (const row of db.prepare(
    `SELECT quote_id, MIN(created_at) AS ordered_at FROM morning_documents_map
     WHERE morning_document_type = ? GROUP BY quote_id`
  ).all(MORNING_ORDER_TYPE)) {
    map.set(row.quote_id, row.ordered_at);
  }
  return map;
}

// Local sync only records that an order document was created — it never
// learns afterwards that Morning cancelled or manually-closed-out that same
// document, so a quote whose order got cancelled kept counting as a sale
// forever. Cross-checks each order still in the reporting period against
// Morning's live status (0=פתוח/1=סגור keep it, 2=סומן ידנית כסגור/3=מבטל/
// 4=בוטל drop it) — same rule requested for the delivery-notes report.
async function fetchCancelledOrderQuoteIds(db, fromDate, toDate) {
  const orders = db.prepare(
    `SELECT quote_id, morning_document_id FROM morning_documents_map
     WHERE morning_document_type = ? AND date(created_at) BETWEEN date(?) AND date(?)`
  ).all(MORNING_ORDER_TYPE, fromDate, toDate);

  const excluded = new Set();
  await Promise.all(orders.map(async (o) => {
    try {
      const doc = await request(db, 'GET', `/documents/${o.morning_document_id}`);
      if (doc && [2, 3, 4].includes(doc.status)) excluded.add(o.quote_id);
    } catch {
      // Morning unreachable / doc gone — leave the order counted rather than
      // silently dropping real sales because of a transient API failure.
    }
  }));
  return excluded;
}

// Not every order document in Morning was created through our interface —
// an office/accounting user can issue one directly in Morning, with no
// signshop_quotes row and no morning_documents_map entry, so the report was
// silently blind to those. Pulls every order (type 100) actually issued
// (open/closed — same 0/1 rule as everywhere else in this report) in the
// period straight from Morning, then keeps only the ones NOT already
// represented locally — those go on a synthetic "מורנינג" row instead of a
// real agent's name, since no agent in our system created them.
async function fetchMorningOnlyOrders(db, fromDate, toDate) {
  const docs = await fetchMorningOnlyDocuments(db, {
    type: MORNING_ORDER_TYPE, fromDate, toDate, withDetails: true,
  });
  return docs.map((d) => ({ totalBeforeVat: d.amount, income: d.income || [] }));
}

// One row per agent with at least one actual ORDER (a quote that got a real
// Morning order document) in the period, ordered highest-selling first. Only
// closed/ordered quotes are counted at all here — never-ordered quotes don't
// appear in this report, not even as an "offered" count, per explicit
// request: this report is about orders, not quotes.
function fetchSalesByAgent(db, fromDate, toDate, excludeQuoteIds = new Set()) {
  const rows = db.prepare(`
    SELECT
      q.id AS quoteId,
      q.created_by AS username,
      COALESCE(u.full_name, q.created_by) AS agentName,
      q.price_before_vat AS priceBeforeVat,
      q.price_with_vat AS priceWithVat
    FROM signshop_quotes q
    LEFT JOIN users u ON u.username = q.created_by
    INNER JOIN (
      SELECT quote_id, MIN(created_at) AS ordered_at FROM morning_documents_map
      WHERE morning_document_type = ${MORNING_ORDER_TYPE}
      GROUP BY quote_id
    ) closed ON closed.quote_id = q.id
    WHERE date(closed.ordered_at) BETWEEN date(?) AND date(?)
      AND ${NOT_SUPERSEDED('q')}
  `).all(fromDate, toDate).filter((r) => !excludeQuoteIds.has(r.quoteId));

  const map = new Map();
  for (const r of rows) {
    const agent = map.get(r.username) || { username: r.username, agentName: r.agentName, ordersCount: 0, totalBeforeVat: 0, totalWithVat: 0 };
    agent.ordersCount += 1;
    agent.totalBeforeVat += r.priceBeforeVat || 0;
    agent.totalWithVat += r.priceWithVat || 0;
    map.set(r.username, agent);
  }
  return Array.from(map.values()).sort((a, b) => b.totalBeforeVat - a.totalBeforeVat);
}

// Per-product rollup across every ORDERED quote in the period — never-ordered
// quotes are skipped entirely (not counted, not shown), same "orders only"
// rule as fetchSalesByAgent. ordersCount counts DISTINCT ORDERS that included
// this product (a quote referencing the same product twice via extra-size
// rows still counts once); revenue/units stay LINE-level, deliberately
// excluding VAT/shipping/installation which don't live on a line.
function fetchSalesByProduct(db, fromDate, toDate, excludeQuoteIds = new Set()) {
  const orderedDates = fetchOrderedDates(db);
  const quotes = db.prepare(`
    SELECT id, calculation_data FROM signshop_quotes q
    WHERE ${NOT_SUPERSEDED('q')}
  `).all().filter((q) => {
    if (excludeQuoteIds.has(q.id)) return false;
    const orderedAt = orderedDates.get(q.id);
    return orderedAt && dateStr(orderedAt) >= fromDate && dateStr(orderedAt) <= toDate;
  });

  const map = {};
  const get = (type) => map[type] || (map[type] = { type, name: productLabel(type), revenue: 0, units: 0, ordersCount: 0 });

  for (const q of quotes) {
    const typesInThisQuote = new Set();
    for (const l of linesOf(q)) {
      const type = l.productType || '—';
      typesInThisQuote.add(type);
      const p = get(type);
      p.revenue += l.result?.sellingPriceAll || 0;
      p.units += l.quantity || 1;
    }
    for (const type of typesInThisQuote) {
      get(type).ordersCount += 1;
    }
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function fmtMoney(n) {
  return `₪ ${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function agentSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.totalBeforeVat || 0), 0);
  const tableRows = rows.map((r) => tableRow([
    r.agentName, r.ordersCount, fmtMoney(r.totalBeforeVat), barCell(r.totalBeforeVat, max),
  ]));
  return tableShell(
    ['סוכן', 'מס׳ הזמנות', 'סה״כ (לפני מע״מ)', 'חלק יחסי'],
    tableRows,
    'אין הזמנות בתקופה זו.'
  );
}

function productSectionHtml(rows) {
  const max = Math.max(...rows.map((r) => r.revenue || 0), 0);
  const tableRows = rows.map((r) => tableRow([
    r.name, r.ordersCount, r.units, fmtMoney(r.revenue), barCell(r.revenue, max, '#2563eb'),
  ]));
  return tableShell(
    ['מוצר', 'מס׳ הזמנות', 'יחידות', 'מחזור (לפני מע״מ)', 'חלק יחסי'],
    tableRows,
    'אין נתוני מוצרים בתקופה זו.'
  );
}

function buildEmail(agentRows, productRows, frequencyLabel, fromDate, toDate) {
  const periodLabel = fromDate === toDate ? toDate : `${fromDate} — ${toDate}`;
  const totalOrders = agentRows.reduce((sum, r) => sum + r.ordersCount, 0);
  const totalBeforeVat = agentRows.reduce((sum, r) => sum + (r.totalBeforeVat || 0), 0);
  const subject = `דוח מכירות ${frequencyLabel} — ${periodLabel} (${totalOrders} הזמנות)`;

  const html = renderReportEmail({
    title: 'דוח מכירות',
    periodLabel: `${frequencyLabel} · ${formatDateRangeHe(fromDate, toDate)}`,
    kpis: [
      { label: 'הזמנות', value: totalOrders },
      { label: 'סה״כ לפני מע״מ', value: fmtMoney(totalBeforeVat) },
    ],
    sections: [
      { heading: 'לפי סוכן', tableHtml: agentSectionHtml(agentRows) },
      { heading: 'לפי מוצר', tableHtml: productSectionHtml(productRows) },
    ],
    footerNote: 'נשלח אוטומטית ממערכת הצעות מחיר.',
  });

  const text = `דוח מכירות ${frequencyLabel} — ${periodLabel}\n\n` +
    `${totalOrders} הזמנות, סה"כ ${fmtMoney(totalBeforeVat)} לפני מע"מ\n\n` +
    `לפי סוכן:\n` + agentRows.map((r) => `${r.agentName}: ${r.ordersCount} הזמנות, ${fmtMoney(r.totalBeforeVat)}`).join('\n') +
    `\n\nלפי מוצר:\n` + productRows.map((r) => `${r.name}: ${r.ordersCount} הזמנות, ${r.units} יחידות, ${fmtMoney(r.revenue)}`).join('\n');

  return { subject, html, text };
}

// Folds orders issued directly in Morning (no local agent) into the two
// breakdowns: one synthetic "מורנינג" row in the agent table, and their line
// items grouped into the product table by description (Morning has no
// concept of our productType slugs, so the raw description is the best
// available grouping key there).
function mergeMorningOnlyOrders(agentRows, productRows, morningOnlyOrders) {
  if (!morningOnlyOrders.length) return { agentRows, productRows };

  const morningAgent = {
    username: 'morning', agentName: 'מורנינג',
    ordersCount: morningOnlyOrders.length,
    totalBeforeVat: morningOnlyOrders.reduce((sum, o) => sum + o.totalBeforeVat, 0),
    // Morning's search gives us the pre-VAT figure only, and nothing in this
    // report renders totalWithVat — kept at 0 so the row still has the same
    // shape as a real agent's rather than carrying a wrong number.
    totalWithVat: 0,
  };
  const mergedAgentRows = [...agentRows, morningAgent].sort((a, b) => b.totalBeforeVat - a.totalBeforeVat);

  const productMap = new Map(productRows.map((r) => [r.type, { ...r }]));
  for (const order of morningOnlyOrders) {
    for (const line of order.income) {
      const key = line.description || 'לא ידוע';
      const p = productMap.get(key) || { type: key, name: key, revenue: 0, units: 0, ordersCount: 0 };
      p.revenue += (line.price || 0) * (line.quantity || 1);
      p.units += line.quantity || 1;
      p.ordersCount += 1;
      productMap.set(key, p);
    }
  }
  const mergedProductRows = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);

  return { agentRows: mergedAgentRows, productRows: mergedProductRows };
}

// Shared by sendReport and the "דוחות" tab's preview endpoint — fetches the
// data and renders the email, but never sends anything, so a preview never
// has a side effect.
async function buildReport(db, cfg) {
  // The report's own period always matches the schedule that triggered it —
  // a daily schedule reports on today, a monthly one on the last 30 days,
  // etc. (computeDateRange). An on-demand generation (the "דוחות" tab's
  // manual generator) instead passes an explicit fromDate/toDate with no
  // frequency — that wins whenever present, so a manually-picked range is
  // never silently overridden.
  const { fromDate, toDate } = cfg.fromDate && cfg.toDate
    ? { fromDate: cfg.fromDate, toDate: cfg.toDate }
    : computeDateRange(cfg.frequency, new Date());
  const excludeQuoteIds = await fetchCancelledOrderQuoteIds(db, fromDate, toDate);
  const morningOnlyOrders = await fetchMorningOnlyOrders(db, fromDate, toDate);
  const localAgentRows = fetchSalesByAgent(db, fromDate, toDate, excludeQuoteIds);
  const localProductRows = fetchSalesByProduct(db, fromDate, toDate, excludeQuoteIds);
  const { agentRows, productRows } = mergeMorningOnlyOrders(localAgentRows, localProductRows, morningOnlyOrders);
  const periodLabel = FREQUENCY_LABELS[cfg.frequency] || cfg.frequency || 'ידני';
  const count = agentRows.reduce((sum, r) => sum + r.ordersCount, 0);
  return { ...buildEmail(agentRows, productRows, periodLabel, fromDate, toDate), count };
}

async function sendReport(db, cfg) {
  const recipients = parseRecipients(cfg.recipients);
  if (!recipients.length) return { sent: false };

  const { subject, html, text, count } = await buildReport(db, cfg);
  const info = await mail.sendMail(db, { to: recipients.join(', '), subject, html, text, context: `report:${REPORT_TYPE}` });
  console.log(`[salesReport] sent sales report (${count} orders) to ${recipients.join(', ')}`);
  return { sent: true, count, accepted: info?.accepted || [], rejected: info?.rejected || [], response: info?.response || '' };
}

module.exports = { REPORT_TYPE, sendReport, buildReport, fetchSalesByAgent, fetchSalesByProduct, fetchCancelledOrderQuoteIds, fetchMorningOnlyOrders };
