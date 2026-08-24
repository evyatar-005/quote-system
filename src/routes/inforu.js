// InforU (official WhatsApp Business API) integration — credential config,
// live approved-template listing, and a template test-send. Mirrors
// routes/greenapi.js's shape for the credential half.
//
// deps: { requireAuth, requireAdmin }

const client = require('../services/inforu/client');
const { syncInforuChats } = require('../services/channels/whatsapp/inforuChatSync');

module.exports = function registerInforu(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  const credRow = db.prepare(`SELECT * FROM inforu_credentials WHERE id = 1`);

  app.get('/api/inforu/config', requireAdmin, (req, res) => {
    const row = credRow.get();
    const settings = db.prepare(
      `SELECT inforu_pull_enabled, whatsapp_provider,
              inforu_last_pull_at, inforu_last_pull_error, inforu_last_pull_count
         FROM crm_settings WHERE id = 1`
    ).get();
    const configured = !!(row && row.username && row.api_token);
    const pullEnabled = !!(settings && settings.inforu_pull_enabled);
    const isActive = (settings && settings.whatsapp_provider) === 'inforu';

    // The inbound poll is gated on all three of these (see jobs.js
    // inforuPullTick). Any one of them off means messages are silently NOT
    // arriving — the screen has to be able to say which, because from the
    // inbox all three look identical: an empty conversation.
    res.json({
      configured,
      username: (row && row.username) || '',
      api_token_masked: row && row.api_token ? '••••' + row.api_token.slice(-4) : '',
      base_url: (row && row.base_url) || '',
      pull_enabled: pullEnabled,
      pull_status: {
        provider_is_active: isActive,
        gates_pass: pullEnabled && isActive && configured,
        last_pull_at: (settings && settings.inforu_last_pull_at) || null,
        last_error: (settings && settings.inforu_last_pull_error) || null,
        last_count: settings ? settings.inforu_last_pull_count : null,
        ...pullHistory(),
      },
    });
  });

  // A pull that succeeds and returns an empty queue is indistinguishable, from
  // the settings screen, from one that pulled a customer's messages and then
  // lost them in normalizePullItem/handleInboundEvent — both end at "0 הודעות
  // נמשכו", because per-item failures only reach console.error and the pull is
  // DESTRUCTIVE, so the message is already gone from InforU either way.
  //
  // inforu_pull_log exists precisely for this: the raw response is written
  // BEFORE any parsing. This reads it back, which is the difference between
  // "InforU never had the message" and "we received it and dropped it" — and
  // in the second case the message text is still recoverable from raw_json.
  function pullHistory() {
    try {
      const totals = db.prepare(
        `SELECT COUNT(*) AS pulls, COALESCE(SUM(item_count), 0) AS items FROM inforu_pull_log`
      ).get();
      const lastWithItems = db.prepare(
        `SELECT created_at, item_count, raw_json FROM inforu_pull_log
          WHERE item_count > 0 ORDER BY id DESC LIMIT 1`
      ).get();
      // The most recent response whatever it contained. When every pull comes
      // back empty this is the only remaining evidence: it distinguishes a
      // genuinely empty queue ({"List":[],"Count":0}) from InforU answering
      // something else entirely — an unrecognised Type, for instance, which a
      // provider typically reports as an empty success rather than an error,
      // and which would look exactly like "no messages" from here.
      const lastAny = db.prepare(
        `SELECT created_at, item_count, raw_json FROM inforu_pull_log ORDER BY id DESC LIMIT 1`
      ).get();
      return {
        total_pulls: totals ? totals.pulls : 0,
        total_items_ever: totals ? totals.items : 0,
        pull_type_sent: 'IncomingMessagesWhatsapp',
        last_raw: lastAny
          ? { at: lastAny.created_at, count: lastAny.item_count, raw: (lastAny.raw_json || '').slice(0, 2000) }
          : null,
        last_pull_with_items: lastWithItems
          ? {
              at: lastWithItems.created_at,
              count: lastWithItems.item_count,
              raw: (lastWithItems.raw_json || '').slice(0, 4000),
            }
          : null,
      };
    } catch (err) {
      return { pull_history_error: err.message };
    }
  }

  app.put('/api/inforu/config', requireAdmin, (req, res) => {
    const { username, api_token, base_url, pull_enabled } = req.body || {};
    const existing = credRow.get();

    // Every credential field is keep-on-omit, the way api_token already was.
    // Before this, a PUT carrying only {pull_enabled} — which is exactly what
    // a standalone toggle sends — wrote `username || null` and wiped the
    // account name, silently disconnecting InforU while the toggle appeared
    // to save. Partial updates have to be safe here, not just for the token.
    const tokenToStore = (api_token && api_token.trim())
      ? api_token.trim()
      : (existing ? existing.api_token : null);
    const usernameToStore = username !== undefined ? (username || null) : (existing ? existing.username : null);
    const baseUrlToStore = base_url !== undefined ? (base_url || null) : (existing ? existing.base_url : null);

    db.prepare(
      `INSERT INTO inforu_credentials (id, username, api_token, base_url) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET username=excluded.username, api_token=excluded.api_token,
         base_url=excluded.base_url, updated_at=CURRENT_TIMESTAMP`
    ).run(usernameToStore, tokenToStore, baseUrlToStore);

    if (pull_enabled !== undefined) {
      // crm_settings holds exactly one row (id=1, CHECK-constrained). If it is
      // somehow missing, `UPDATE ... WHERE id = 1` matches nothing and SQLite
      // reports success — the write silently evaporates and the toggle springs
      // back to off on the next load, with "נשמר בהצלחה" already on screen.
      // Create-then-update, then verify, so that can't happen quietly.
      db.exec(`INSERT OR IGNORE INTO crm_settings (id) VALUES (1)`);
      const { changes } = db.prepare(
        `UPDATE crm_settings SET inforu_pull_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
      ).run(pull_enabled ? 1 : 0);
      if (!changes) {
        console.error('[PUT /api/inforu/config] crm_settings row missing — pull toggle NOT saved');
        return res.status(500).json({ error: 'שמירת הגדרת המשיכה נכשלה — שורת ההגדרות חסרה במסד' });
      }
    }

    // Read back what is actually stored rather than asserting ok:true, so the
    // client renders the persisted truth and a failed write can't look saved.
    const saved = db.prepare(`SELECT inforu_pull_enabled FROM crm_settings WHERE id = 1`).get();
    const cred = credRow.get();
    console.log(`[PUT /api/inforu/config] username="${cred?.username || ''}" pull_enabled=${saved?.inforu_pull_enabled ?? '?'}`);
    res.json({
      ok: true,
      configured: !!(cred && cred.username && cred.api_token),
      username: (cred && cred.username) || '',
      base_url: (cred && cred.base_url) || '',
      pull_enabled: !!(saved && saved.inforu_pull_enabled),
    });
  });

  // Live proxy to GetTemplateList, filtered to Meta-approved templates only —
  // no local cache/table, see CLAUDE.md CRM plan: a disabled/rejected
  // template must disappear from the composer picker immediately, not once a
  // sync job gets around to it.
  app.get('/api/inforu/templates', requireAuth, async (req, res) => {
    try {
      const list = await client.getTemplateList(db);
      res.json(list.filter(t => t.ApprovalStatus === 1));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // The only way to open a session window for a first end-to-end test —
  // POST /api/whatsapp/test only sends free-form text, which InforU will
  // correctly refuse outside an open window.
  // Read-only probe of GetWhatsAppChats — the chat store behind InforU's own
  // web UI, as opposed to the PullData queue that has returned an empty list
  // 8,276 times. Safe to call repeatedly: unlike the pull it consumes nothing.
  // Exists as its own endpoint so the question "can we read the messages that
  // are visibly sitting in their chat?" can be answered from the admin screen
  // in one click, before any of it is wired into the inbox.
  app.post('/api/inforu/test-chats', requireAdmin, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 7, 1), 90);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    try {
      const data = await client.getWhatsAppChats(db, {
        fromDateTime: from,
        ...(req.body?.phone ? { phoneNumbers: [String(req.body.phone)] } : {}),
      });
      const results = (data && data.Results) || [];
      const messages = results.flatMap(r => r.Messages || []);
      res.json({
        ok: true,
        from,
        chatCount: results.length,
        messageCount: messages.length,
        inbound: messages.filter(m => m.Direction === 'Incoming').length,
        outbound: messages.filter(m => m.Direction === 'Outgoing').length,
        // The first run reported 335 messages but 150 Outgoing + 0 Incoming,
        // so 185 carry a Direction this code doesn't recognise — and those are
        // very likely the inbound ones under a different spelling. Never guess
        // the vocabulary: report exactly which values the account actually
        // returns, with counts, and filter on the real ones.
        directions: Object.entries(
          messages.reduce((acc, m) => {
            const k = m.Direction === undefined ? '(undefined)' : String(m.Direction);
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {})
        ).map(([value, count]) => ({ value, count })),
        // A sample from each direction bucket, so the non-Outgoing ones can be
        // read directly rather than inferred from their label.
        samplePerDirection: Object.values(
          messages.reduce((acc, m) => {
            const k = String(m.Direction);
            if (!acc[k]) {
              acc[k] = {
                direction: k, at: m.TimeSent, phone: m.PhoneNumber,
                text: (m.MessageText || '').slice(0, 120), id: m.WhatsAppMessageId,
              };
            }
            return acc;
          }, {})
        ),
        // A small sample rather than the whole payload: enough to confirm the
        // shape and see real text, without dumping every conversation.
        sample: messages.slice(0, 5).map(m => ({
          at: m.TimeSent, phone: m.PhoneNumber, direction: m.Direction,
          text: (m.MessageText || '').slice(0, 120), id: m.WhatsAppMessageId,
        })),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message, from });
    }
  });

  // One-shot backfill of existing conversations. The background tick only ever
  // looks 30 minutes back, so everything older than the moment InforU became
  // the active provider needs this once. Safe to re-run over any window: the
  // import is keyed on WhatsAppMessageId, so a second pass imports 0.
  app.post('/api/inforu/import-history', requireAdmin, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 30, 1), 365);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    try {
      const result = await syncInforuChats(db, { fromDateTime: from });
      console.log(`[POST /api/inforu/import-history] ${days}d: ${JSON.stringify(result)}`);
      res.json({ ok: true, days, from, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/inforu/test-template', requireAdmin, async (req, res) => {
    const { to, templateId, parameters } = req.body || {};
    if (!to || !templateId) return res.status(400).json({ error: 'to and templateId required' });
    try {
      const inforu = require('../services/channels/whatsapp/inforu');
      const result = await inforu.sendTemplate(db, { toE164: to, templateId, parameters: parameters || [] });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};
