// Builds the WHERE clause + params for a דיוור audience from wizard filters,
// and the base+exclusion-count query. ONE function used by both
// POST /api/campaigns/audience/preview and POST /api/campaigns/:id/build so
// the preview and what actually gets sent can never diverge — see CLAUDE.md
// CRM plan Phase 4 §7.

// filters: { lead_campaign_ids?, lead_status?, product_category?, last_quote_from?,
//            last_quote_to?, never_quoted?, owner_username?, source?, tags?, customer_ids? }
function buildWhere(filters) {
  const where = [`c.merged_into_id IS NULL`, `c.status = 'active'`];
  const params = [];

  if (filters.lead_campaign_ids?.length || filters.lead_status?.length) {
    const sub = [`l.customer_id = c.id`];
    const subParams = [];
    if (filters.lead_campaign_ids?.length) {
      sub.push(`l.campaign_id IN (${filters.lead_campaign_ids.map(() => '?').join(',')})`);
      subParams.push(...filters.lead_campaign_ids);
    }
    if (filters.lead_status?.length) {
      sub.push(`l.status IN (${filters.lead_status.map(() => '?').join(',')})`);
      subParams.push(...filters.lead_status);
    }
    where.push(`EXISTS (SELECT 1 FROM crm_leads l WHERE ${sub.join(' AND ')})`);
    params.push(...subParams);
  }
  if (filters.product_category?.length) {
    where.push(`EXISTS (SELECT 1 FROM signshop_quotes q WHERE q.customer_id = c.id AND q.product_category IN (${filters.product_category.map(() => '?').join(',')}))`);
    params.push(...filters.product_category);
  }
  if (filters.last_quote_from || filters.last_quote_to) {
    where.push(`(SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) BETWEEN ? AND ?`);
    params.push(filters.last_quote_from || '0000-01-01', filters.last_quote_to || '9999-12-31');
  }
  if (filters.never_quoted) {
    where.push(`NOT EXISTS (SELECT 1 FROM signshop_quotes q WHERE q.customer_id = c.id)`);
  }
  if (filters.owner_username) {
    where.push(`c.owner_username = ?`);
    params.push(filters.owner_username);
  }
  if (filters.source?.length) {
    where.push(`c.source IN (${filters.source.map(() => '?').join(',')})`);
    params.push(...filters.source);
  }
  if (filters.tags?.length) {
    // c.tags is a plain TEXT column — substring match. A tag that is a
    // prefix of another (e.g. "VIP" vs "VIP2") over-matches; acceptable for
    // this deployment's small, hand-curated tag vocabulary.
    where.push(`(${filters.tags.map(() => `c.tags LIKE ?`).join(' OR ')})`);
    params.push(...filters.tags.map(t => `%${t}%`));
  }
  if (filters.customer_ids?.length) {
    where.push(`c.id IN (${filters.customer_ids.map(() => '?').join(',')})`);
    params.push(...filters.customer_ids);
  }

  return { whereSql: where.join(' AND '), params };
}

// Returns { matched, sendable, excluded: {no_phone, opted_out, no_consent}, sample }.
// Exclusion reasons are mutually exclusive and priority-ordered
// (no_phone > opted_out > no_consent) so matched === sum of all four.
function previewAudience(db, filters) {
  const { whereSql, params } = buildWhere(filters);
  const sql = `
    WITH matched AS (
      SELECT c.id, c.display_name, c.phone_e164, c.company, c.marketing_consent,
             (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at,
             EXISTS (SELECT 1 FROM crm_opt_outs o WHERE o.phone_e164 = c.phone_e164 AND o.revoked_at IS NULL) AS opted_out
      FROM customers c
      WHERE ${whereSql}
    )
    SELECT
      COUNT(*) AS matched,
      SUM(CASE WHEN phone_e164 IS NULL OR phone_e164 = '' THEN 1 ELSE 0 END) AS excluded_no_phone,
      SUM(CASE WHEN (phone_e164 IS NOT NULL AND phone_e164 != '') AND opted_out = 1 THEN 1 ELSE 0 END) AS excluded_opted_out,
      SUM(CASE WHEN (phone_e164 IS NOT NULL AND phone_e164 != '') AND opted_out = 0 AND marketing_consent = 0 THEN 1 ELSE 0 END) AS excluded_no_consent,
      SUM(CASE WHEN (phone_e164 IS NOT NULL AND phone_e164 != '') AND opted_out = 0 AND marketing_consent = 1 THEN 1 ELSE 0 END) AS sendable
    FROM matched`;
  const counts = db.prepare(sql).get(...params);
  const sampleSql = `
    SELECT c.id, c.display_name, c.phone_e164, c.company,
           (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at
    FROM customers c WHERE ${whereSql} ORDER BY c.updated_at DESC LIMIT 20`;
  const sample = db.prepare(sampleSql).all(...params);
  return {
    matched: counts.matched || 0,
    sendable: counts.sendable || 0,
    excluded: {
      no_phone: counts.excluded_no_phone || 0,
      opted_out: counts.excluded_opted_out || 0,
      no_consent: counts.excluded_no_consent || 0,
    },
    sample,
  };
}

// Full resolved list of {customer_id, display_name, phone_e164, last_quote_at,
// owner_username} for every SENDABLE customer — used at build time.
function resolveAudience(db, filters) {
  const { whereSql, params } = buildWhere(filters);
  const sql = `
    SELECT c.id AS customer_id, c.display_name, c.phone_e164, c.company, c.owner_username,
           (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at
    FROM customers c
    WHERE ${whereSql}
      AND c.phone_e164 IS NOT NULL AND c.phone_e164 != ''
      AND c.marketing_consent = 1
      AND NOT EXISTS (SELECT 1 FROM crm_opt_outs o WHERE o.phone_e164 = c.phone_e164 AND o.revoked_at IS NULL)`;
  return db.prepare(sql).all(...params);
}

module.exports = { buildWhere, previewAudience, resolveAudience };
