// CRM Phase 3 — WhatsApp provider selection + inbound webhook. Per-provider
// credentials keep their own routes (GreenAPI: /api/greenapi/config,
// unchanged); this file only owns which provider is active and the inbound
// webhook that any configured provider posts to.
//
// deps: { requireAuth, requireAdmin }

const { getActiveWhatsApp, WHATSAPP_PROVIDERS } = require('../services/channels');
const { handleInboundEvent } = require('../services/channels/whatsapp/inbound');
const { publish } = require('../services/crm/realtime');

module.exports = function registerWhatsapp(app, db, deps) {
  const { requireAuth, requireAdmin } = deps;

  app.get('/api/whatsapp/config', requireAuth, (req, res) => {
    const settings = db.prepare(`SELECT whatsapp_provider FROM crm_settings WHERE id = 1`).get();
    const active = settings?.whatsapp_provider || 'greenapi';
    const provider = WHATSAPP_PROVIDERS[active];
    res.json({
      active_provider: active,
      available_providers: Object.keys(WHATSAPP_PROVIDERS),
      configured: provider ? provider.isConfigured(db) : false,
      capabilities: provider ? provider.capabilities(db) : null,
    });
  });

  app.put('/api/whatsapp/config', requireAdmin, (req, res) => {
    const { active_provider } = req.body || {};
    if (!WHATSAPP_PROVIDERS[active_provider]) return res.status(400).json({ error: `unknown provider: ${active_provider}` });
    db.prepare(`UPDATE crm_settings SET whatsapp_provider = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(active_provider);
    res.json({ ok: true, active_provider });
  });

  app.post('/api/whatsapp/test', requireAdmin, async (req, res) => {
    const { to, body } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: 'to and body required' });
    try {
      const provider = getActiveWhatsApp(db);
      const result = await provider.sendText(db, { toE164: to, body });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Inbound webhook — public, the provider calls this directly ───────────
  // 200-first-then-work, same convention as the Morning payment webhook and
  // the monday.com item webhook: never make the provider's own retry logic
  // fire because our downstream DB work was slow.
  app.get('/api/whatsapp/webhooks/:provider', (req, res) => {
    // Meta Cloud API's verification handshake (not used by GreenAPI, but the
    // route shape is shared so a future Meta adapter needs no new route).
    if (req.query['hub.challenge']) return res.send(req.query['hub.challenge']);
    res.status(200).end();
  });

  app.post('/api/whatsapp/webhooks/:provider', (req, res) => {
    const providerName = req.params.provider;
    const provider = WHATSAPP_PROVIDERS[providerName];
    res.status(200).json({ ok: true });
    if (!provider) return;

    (async () => {
      try {
        if (!provider.verifyWebhook(db, req)) {
          console.error(`[whatsapp webhook] ${providerName}: signature/token verification failed`);
          return;
        }
        // Persist the raw payload BEFORE parsing, exactly like the InforU pull
        // does — a bug in normalizeInboundWebhook must never be able to lose a
        // customer's message, and unlike a pull there is no queue left holding
        // a copy. Also the only way to see a payload whose shape we guessed
        // wrong: a push that parses to zero events is otherwise invisible.
        if (providerName === 'inforu') {
          try {
            const events = (req.body && Array.isArray(req.body.Data)) ? req.body.Data.length : 0;
            db.prepare(`INSERT INTO inforu_pull_log (pull_type, raw_json, item_count) VALUES (?, ?, ?)`)
              .run('PushIncomingWhatsapp', JSON.stringify(req.body || {}), events);
          } catch (err) {
            console.error('[whatsapp webhook] inforu: could not log raw push payload:', err.message);
          }
        }
        const events = provider.normalizeInboundWebhook(req.body, req.headers) || [];
        for (const event of events) {
          const result = handleInboundEvent(db, providerName, event);
          if (result) publish('message.received', result);
        }
      } catch (err) {
        console.error(`[whatsapp webhook] ${providerName} processing failed:`, err.message);
      }
    })();
  });
};
