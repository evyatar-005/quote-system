// CRM Phase 4 — bulk WhatsApp broadcasts ("דיוור"), message templates, and
// the opt-out register. Dedicated route file (not entities.js's REGISTRY):
// templates/opt-outs need the can_send_campaigns permission, which the
// REGISTRY's ADMIN_WRITE/OPERATIONS_WRITE dispatch has no hook for, and
// campaigns need join-heavy audience queries. See CLAUDE.md CRM plan §6.
//
// deps: { requireAuth, requireAdmin, requireCampaigns }

const { render, usedVariables, unknownVariables, hasOptOutLine } = require('../services/crm/templates');
const { previewAudience, resolveAudience } = require('../services/crm/audience');
const { enqueue } = require('../services/channels/whatsapp/outbox');
const { toE164 } = require('../services/crm/phone');

module.exports = function registerCampaigns(app, db, deps) {
  const { requireAuth, requireAdmin, requireCampaigns } = deps;

  // ═══════════════════════════════════════════════════════════════════════
  // Templates
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/api/campaigns/templates', requireAuth, (req, res) => {
    const { category, active } = req.query;
    const where = [];
    const params = [];
    if (category) { where.push('category = ?'); params.push(category); }
    if (active !== undefined) { where.push('is_active = ?'); params.push(active === '1' ? 1 : 0); }
    let sql = `SELECT * FROM message_templates`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY created_at DESC`;
    res.json(db.prepare(sql).all(...params));
  });

  function validateTemplateBody(body) {
    const unknown = unknownVariables(body || '');
    if (unknown.length) {
      return { error: `משתנים לא מוכרים בגוף ההודעה: ${unknown.join(', ')}`, unknown_variables: unknown };
    }
    return null;
  }

  app.post('/api/campaigns/templates', requireCampaigns, (req, res) => {
    const b = req.body || {};
    if (!b.name?.toString().trim()) return res.status(400).json({ error: 'name required' });
    if (!b.body?.toString().trim()) return res.status(400).json({ error: 'body required' });
    const invalid = validateTemplateBody(b.body);
    if (invalid) return res.status(400).json(invalid);
    const row = {
      name: b.name.trim(), category: b.category || 'marketing', channel: b.channel || 'whatsapp',
      body: b.body, media_url: b.media_url || null, media_filename: b.media_filename || null,
      provider_template_name: b.provider_template_name || null, created_by: req.user.username,
    };
    const cols = Object.keys(row);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO message_templates (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`
    ).run(row);
    res.status(201).json(db.prepare(`SELECT * FROM message_templates WHERE id = ?`).get(lastInsertRowid));
  });

  app.put('/api/campaigns/templates/:id', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM message_templates WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'לא נמצא' });
    const b = req.body || {};
    if ('body' in b) {
      const invalid = validateTemplateBody(b.body);
      if (invalid) return res.status(400).json(invalid);
    }
    const editable = ['name', 'category', 'channel', 'body', 'media_url', 'media_filename', 'provider_template_name', 'is_active'];
    const row = { id };
    const setCols = [];
    for (const c of editable) if (c in b) { row[c] = b[c]; setCols.push(c); }
    if (setCols.length) {
      setCols.push('updated_at'); row.updated_at = new Date().toISOString();
      db.prepare(`UPDATE message_templates SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    res.json(db.prepare(`SELECT * FROM message_templates WHERE id = ?`).get(id));
  });

  app.delete('/api/campaigns/templates/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const inUse = db.prepare(`SELECT COUNT(*) c FROM wa_campaigns WHERE template_id = ?`).get(id).c > 0;
    if (inUse) {
      db.prepare(`UPDATE message_templates SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
      return res.json({ ok: true, soft_deleted: true });
    }
    db.prepare(`DELETE FROM message_templates WHERE id = ?`).run(id);
    res.json({ ok: true, soft_deleted: false });
  });

  app.post('/api/campaigns/templates/preview', requireAuth, (req, res) => {
    const { body, customer_id, agent_is_me } = req.body || {};
    let customer = null;
    if (customer_id) {
      customer = db.prepare(`
        SELECT c.*, (SELECT MAX(created_at) FROM signshop_quotes q WHERE q.customer_id = c.id) AS last_quote_at
        FROM customers c WHERE c.id = ?`).get(customer_id);
    }
    // {{agent}} normally means the customer's account owner, which is right
    // for a דיוור blast. For a 1:1 quick reply it should mean whoever is
    // typing — and owner_* is usually empty on customers auto-created from an
    // inbound WhatsApp, so the default would just render blank. Opt-in per
    // request so campaign previews keep their existing meaning exactly.
    const ctx = agent_is_me
      ? { ...(customer || {}), owner_full_name: req.user.full_name || req.user.username }
      : (customer || {});
    res.json({
      rendered: render(body, ctx),
      variables: usedVariables(body),
      unknown_variables: unknownVariables(body),
      has_optout_line: hasOptOutLine(db, body),
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Audience
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/api/campaigns/audience/preview', requireAuth, (req, res) => {
    try {
      res.json(previewAudience(db, req.body?.filters || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Campaigns (דיוור)
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/api/campaigns', requireAuth, (req, res) => {
    res.json(db.prepare(`SELECT * FROM wa_campaigns ORDER BY created_at DESC`).all());
  });

  app.get('/api/campaigns/:id', requireAuth, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!campaign) return res.status(404).json({ error: 'לא נמצא' });
    const { status, limit } = req.query;
    const where = ['campaign_id = ?'];
    const params = [id];
    if (status) { where.push('status = ?'); params.push(status); }
    const lim = Number.isInteger(+limit) ? Math.min(parseInt(limit, 10), 500) : 200;
    campaign.recipients = db.prepare(
      `SELECT * FROM wa_campaign_recipients WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${lim}`
    ).all(...params);
    campaign.status_rollup = db.prepare(
      `SELECT status, COUNT(*) c FROM wa_campaign_recipients WHERE campaign_id = ? GROUP BY status`
    ).all(id);
    res.json(campaign);
  });

  app.post('/api/campaigns', requireCampaigns, (req, res) => {
    const b = req.body || {};
    if (!b.name?.toString().trim()) return res.status(400).json({ error: 'name required' });
    if (!b.body?.toString().trim()) return res.status(400).json({ error: 'body required' });
    if (!hasOptOutLine(db, b.body)) return res.status(400).json({ error: 'גוף הדיוור חייב לכלול שורת הסרה' });
    const row = {
      name: b.name.trim(), template_id: b.template_id || null, body: b.body,
      media_url: b.media_url || null, media_filename: b.media_filename || null,
      audience_json: JSON.stringify(b.audience || {}), daily_cap: b.daily_cap || null,
      created_by: req.user.username,
    };
    const cols = Object.keys(row);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO wa_campaigns (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`
    ).run(row);
    res.status(201).json(db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(lastInsertRowid));
  });

  app.put('/api/campaigns/:id', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'לא נמצא' });
    if (existing.status !== 'draft') return res.status(409).json({ error: 'ניתן לערוך רק דיוור בטיוטה' });
    const b = req.body || {};
    if ('body' in b && !hasOptOutLine(db, b.body)) return res.status(400).json({ error: 'גוף הדיוור חייב לכלול שורת הסרה' });
    const row = { id };
    const setCols = [];
    for (const [field, col] of [['name', 'name'], ['template_id', 'template_id'], ['body', 'body'], ['media_url', 'media_url'], ['media_filename', 'media_filename'], ['daily_cap', 'daily_cap']]) {
      if (field in b) { row[col] = b[field]; setCols.push(col); }
    }
    if ('audience' in b) { row.audience_json = JSON.stringify(b.audience || {}); setCols.push('audience_json'); }
    if (setCols.length) {
      setCols.push('updated_at'); row.updated_at = new Date().toISOString();
      db.prepare(`UPDATE wa_campaigns SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    res.json(db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id));
  });

  // Resolves the audience -> freezes wa_campaign_recipients. Idempotent:
  // clears any existing 'pending' recipients from a prior build and rebuilds.
  app.post('/api/campaigns/:id/build', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!campaign) return res.status(404).json({ error: 'לא נמצא' });
    if (!['draft', 'ready'].includes(campaign.status)) return res.status(409).json({ error: 'לא ניתן לבנות דיוור שכבר רץ או הסתיים' });

    let filters;
    try { filters = JSON.parse(campaign.audience_json || '{}'); } catch { filters = {}; }
    const audience = resolveAudience(db, filters);
    const settings = db.prepare(`SELECT optout_footer FROM crm_settings WHERE id = 1`).get();
    const footer = settings?.optout_footer || '';

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM wa_campaign_recipients WHERE campaign_id = ? AND status = 'pending'`).run(id);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO wa_campaign_recipients (campaign_id, customer_id, phone_e164, display_name, rendered_body, status)
         VALUES (@campaign_id, @customer_id, @phone_e164, @display_name, @rendered_body, 'pending')`
      );
      let inserted = 0;
      for (const person of audience) {
        let body = render(campaign.body, {
          display_name: person.display_name, company: person.company,
          phone_e164: person.phone_e164, owner_username: person.owner_username,
          last_quote_at: person.last_quote_at,
        });
        if (footer && !hasOptOutLine(db, body)) body = `${body}\n${footer}`;
        const { changes } = insert.run({
          campaign_id: id, customer_id: person.customer_id, phone_e164: person.phone_e164,
          display_name: person.display_name, rendered_body: body,
        });
        inserted += changes;
      }
      const totalCount = db.prepare(`SELECT COUNT(*) c FROM wa_campaign_recipients WHERE campaign_id = ?`).get(id).c;
      db.prepare(`UPDATE wa_campaigns SET status = 'ready', total_count = ?, skipped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(totalCount, Math.max(0, audience.length - inserted), id);
      return totalCount;
    });
    const totalCount = tx();
    res.json({ ok: true, total_count: totalCount, campaign: db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id) });
  });

  // Requires a typed confirm_count matching total_count — a misclick guard,
  // not a security control (the real gate is requireCampaigns above it).
  app.post('/api/campaigns/:id/start', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!campaign) return res.status(404).json({ error: 'לא נמצא' });
    if (campaign.status !== 'ready') return res.status(409).json({ error: 'יש לבנות את הדיוור לפני שליחה' });
    const confirmCount = parseInt(req.body?.confirm_count, 10);
    if (confirmCount !== campaign.total_count) {
      return res.status(400).json({ error: `אימות כמות שגוי: התקבל ${req.body?.confirm_count}, צפוי ${campaign.total_count}` });
    }
    const recipients = db.prepare(`SELECT * FROM wa_campaign_recipients WHERE campaign_id = ? AND status = 'pending'`).all(id);
    const tx = db.transaction(() => {
      for (const r of recipients) {
        const result = enqueue(db, {
          customerId: r.customer_id, toE164: r.phone_e164, kind: 'text', body: r.rendered_body,
          sentBy: req.user.username, priority: 100, campaignId: id, recipientId: r.id, marketing: true,
        });
        if (result.skipped) {
          db.prepare(`UPDATE wa_campaign_recipients SET status = 'skipped', skip_reason = ? WHERE id = ?`).run(result.reason, r.id);
        }
      }
      const skippedNow = db.prepare(`SELECT COUNT(*) c FROM wa_campaign_recipients WHERE campaign_id = ? AND status = 'skipped'`).get(id).c;
      db.prepare(`UPDATE wa_campaigns SET status = 'running', started_at = CURRENT_TIMESTAMP, approved_by = ?, skipped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(req.user.username, skippedNow, id);
    });
    tx();
    res.json({ ok: true, campaign: db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id) });
  });

  app.post('/api/campaigns/:id/pause', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const tx = db.transaction(() => {
      db.prepare(`UPDATE wa_campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'`).run(id);
      db.prepare(`UPDATE wa_send_queue SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'`).run(id);
      db.prepare(`UPDATE wa_campaign_recipients SET status = 'pending' WHERE campaign_id = ? AND status = 'queued'`).run(id);
    });
    tx();
    res.json({ ok: true, campaign: db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id) });
  });

  app.post('/api/campaigns/:id/resume', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!campaign || campaign.status !== 'paused') return res.status(409).json({ error: 'אפשר לחדש רק דיוור מושהה' });
    const recipients = db.prepare(`SELECT * FROM wa_campaign_recipients WHERE campaign_id = ? AND status = 'pending'`).all(id);
    const tx = db.transaction(() => {
      for (const r of recipients) {
        const result = enqueue(db, {
          customerId: r.customer_id, toE164: r.phone_e164, kind: 'text', body: r.rendered_body,
          sentBy: req.user.username, priority: 100, campaignId: id, recipientId: r.id, marketing: true,
        });
        if (result.skipped) db.prepare(`UPDATE wa_campaign_recipients SET status = 'skipped', skip_reason = ? WHERE id = ?`).run(result.reason, r.id);
      }
      db.prepare(`UPDATE wa_campaigns SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    });
    tx();
    res.json({ ok: true, campaign: db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id) });
  });

  app.post('/api/campaigns/:id/cancel', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const tx = db.transaction(() => {
      db.prepare(`UPDATE wa_campaigns SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('draft','ready','running','paused')`).run(id);
      db.prepare(`UPDATE wa_send_queue SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'`).run(id);
      db.prepare(`UPDATE wa_campaign_recipients SET status = 'skipped', skip_reason = 'blocked' WHERE campaign_id = ? AND status IN ('pending','queued')`).run(id);
    });
    tx();
    res.json({ ok: true, campaign: db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id) });
  });

  // The single most important safety valve: sends one message, at priority
  // 5 (bypasses pacing/window/cap entirely, same lane as the opt-out
  // confirmation reply), to a number of the sender's choosing, using the
  // sender's OWN customer-shaped record for {{placeholders}} — never the
  // audience.
  app.post('/api/campaigns/:id/test-send', requireCampaigns, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const campaign = db.prepare(`SELECT * FROM wa_campaigns WHERE id = ?`).get(id);
    if (!campaign) return res.status(404).json({ error: 'לא נמצא' });
    const to = toE164(req.body?.to);
    if (!to) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    const body = render(campaign.body, { display_name: req.user.full_name || req.user.username, owner_username: req.user.username });
    try {
      const result = enqueue(db, { toE164: to, kind: 'text', body, sentBy: req.user.username, priority: 5, marketing: false });
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Opt-out register
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/api/campaigns/optouts', requireAuth, (req, res) => {
    const { q } = req.query;
    let sql = `SELECT o.*, c.display_name FROM crm_opt_outs o LEFT JOIN customers c ON c.id = o.customer_id`;
    const params = [];
    if (q) { sql += ` WHERE o.phone_e164 LIKE ? OR c.display_name LIKE ?`; params.push(`%${q}%`, `%${q}%`); }
    sql += ` ORDER BY o.created_at DESC LIMIT 200`;
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/campaigns/optouts', requireCampaigns, (req, res) => {
    const phone = toE164(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
    const customer = db.prepare(`SELECT id FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL`).get(phone);
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO crm_opt_outs (phone_e164, customer_id, source, actor, keyword) VALUES (?, ?, 'manual', ?, ?)`
      ).run(phone, customer?.id || null, req.user.username, req.body?.reason || null);
      if (customer) {
        db.prepare(
          `UPDATE customers SET marketing_consent = 0, consent_source = 'optout', consent_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(customer.id);
      }
    });
    tx();
    res.status(201).json({ ok: true });
  });

  app.delete('/api/campaigns/optouts/:id', requireAdmin, (req, res) => {
    db.prepare(`UPDATE crm_opt_outs SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });
};
