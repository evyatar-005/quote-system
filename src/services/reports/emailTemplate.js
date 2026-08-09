// Shared HTML shell for every scheduled report email — one place that owns
// "what a report email looks like" so delivery-notes and sales (and any
// future report) render as the same product instead of drifting apart with
// their own ad hoc <div> wrappers. All inline CSS, table-based layout only
// (no flexbox/grid, no external stylesheet or web fonts) — Outlook's HTML
// renderer doesn't support flex/grid, and email clients strip <style> tags
// from separate stylesheets/head sections unreliably.

const BRAND_GOLD = '#C9A84C';
const INK = '#1e293b';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';
const PANEL = '#f8fafc';

// "9 באוגוסט" instead of "2026-08-09" — no year (redundant for an
// operational report someone reads the same week), and day-before-month-name
// reads correctly right-to-left on its own. A raw "YYYY-MM-DD — YYYY-MM-DD"
// range, by contrast, is exactly the kind of LTR-punctuation string the bidi
// algorithm reorders unpredictably inside an RTL paragraph (the "later"
// date can visually end up first) — this format avoids that failure mode
// entirely rather than fighting it with dir="ltr" spans.
function formatDateHe(isoDateStr) {
  return new Date(`${isoDateStr}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
}

function formatDateRangeHe(fromDate, toDate) {
  return fromDate === toDate ? formatDateHe(toDate) : `${formatDateHe(fromDate)} – ${formatDateHe(toDate)}`;
}

// A single stat box — big number, small label underneath. `kpis` is an
// array of these, laid out as one <table> row of equal-width cells so it
// reads as a clean row of cards in every client, including Outlook.
function kpiCell(kpi) {
  return `
    <td style="padding:4px;">
      <div style="background:${PANEL};border:1px solid ${BORDER};border-radius:10px;padding:14px 16px;">
        <div style="font-size:22px;font-weight:700;color:${INK};">${kpi.value}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:2px;">${kpi.label}</div>
      </div>
    </td>`;
}

function kpiRow(kpis) {
  if (!kpis || !kpis.length) return '';
  return `
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:16px;">
      <tr>${kpis.map(kpiCell).join('')}</tr>
    </table>`;
}

function sectionBlock(section) {
  return `
    <div style="margin-top:24px;">
      <h3 style="margin:0 0 8px;font-size:15px;font-weight:700;color:${INK};border-bottom:2px solid ${BRAND_GOLD};display:inline-block;padding-bottom:4px;">
        ${section.heading}
      </h3>
      ${section.tableHtml}
    </div>`;
}

// A plain HTML/CSS horizontal bar (a background-colored div sized by % of
// the row set's max value) instead of a rendered chart image — no canvas/
// image-generation dependency, and unlike embedded SVG or <canvas>, a
// colored div inside a table cell renders consistently across virtually
// every email client (Gmail, Outlook, Apple Mail included). Exported so
// each report builds its own table rows with a consistent-looking bar.
function barCell(value, max, color = BRAND_GOLD) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<div style="background:${PANEL};border-radius:4px;overflow:hidden;width:140px;">
    <div style="background:${color};width:${pct}%;height:10px;"></div>
  </div>`;
}

function tableShell(headers, rows, emptyMessage) {
  if (!rows.length) return `<p style="color:${MUTED};font-size:14px;margin-top:8px;">${emptyMessage}</p>`;
  return `
    <table role="presentation" style="border-collapse:collapse;margin-top:8px;width:100%;">
      <thead>
        <tr style="background:${PANEL};">
          ${headers.map((h) => `<th style="padding:8px 10px;text-align:right;font-size:13px;color:${MUTED};">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function tableRow(cells) {
  return `<tr>${cells.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid ${BORDER};font-size:14px;color:${INK};">${c}</td>`).join('')}</tr>`;
}

// title/periodLabel go in the branded header; kpis is an array of
// {label, value}; sections is an array of {heading, tableHtml} (build each
// tableHtml with tableShell/tableRow/barCell above); footerNote is small
// muted text at the very bottom.
function renderReportEmail({ title, periodLabel, kpis, sections, footerNote }) {
  return `
    <div dir="rtl" style="font-family: Arial, Helvetica, sans-serif; max-width:640px; margin:0 auto;">
      <div style="background:${INK};border-radius:12px 12px 0 0;padding:20px 24px;">
        <div style="color:${BRAND_GOLD};font-size:12px;font-weight:700;letter-spacing:0.5px;">מערכת הצעות מחיר</div>
        <div style="color:#fff;font-size:19px;font-weight:700;margin-top:4px;">${title}</div>
        <div style="color:#cbd5e1;font-size:13px;margin-top:2px;">${periodLabel}</div>
      </div>
      <div style="border:1px solid ${BORDER};border-top:none;border-radius:0 0 12px 12px;padding:20px 24px;">
        ${kpiRow(kpis)}
        ${(sections || []).map(sectionBlock).join('')}
        ${footerNote ? `<p style="margin-top:24px;padding-top:12px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">${footerNote}</p>` : ''}
      </div>
    </div>`;
}

module.exports = { renderReportEmail, tableShell, tableRow, barCell, formatDateHe, formatDateRangeHe };
