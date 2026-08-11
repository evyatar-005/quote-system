// Provider registry — the single place that resolves crm_settings.whatsapp_provider
// to a concrete adapter module. Everything else (routes, jobs, outbox) calls
// getActiveWhatsApp(db) instead of require()-ing an adapter by name, so
// switching providers is a crm_settings row update, not a code change.

const greenapi = require('./whatsapp/greenapi');

const WHATSAPP_PROVIDERS = { greenapi };

function getActiveWhatsApp(db) {
  const settings = db.prepare(`SELECT whatsapp_provider FROM crm_settings WHERE id = 1`).get();
  const name = (settings && settings.whatsapp_provider) || 'greenapi';
  const provider = WHATSAPP_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown WhatsApp provider: ${name}`);
  return provider;
}

module.exports = { getActiveWhatsApp, WHATSAPP_PROVIDERS };
