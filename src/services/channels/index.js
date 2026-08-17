// Provider registry — the single place that resolves crm_settings.whatsapp_provider
// to a concrete adapter module. Everything else (routes, jobs, outbox) calls
// getActiveWhatsApp(db) instead of require()-ing an adapter by name, so
// switching providers is a crm_settings row update, not a code change.

const greenapi = require('./whatsapp/greenapi');
const inforu = require('./whatsapp/inforu');

const WHATSAPP_PROVIDERS = { greenapi, inforu };

function getActiveWhatsApp(db) {
  const settings = db.prepare(`SELECT whatsapp_provider FROM crm_settings WHERE id = 1`).get();
  const name = (settings && settings.whatsapp_provider) || 'greenapi';
  const provider = WHATSAPP_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown WhatsApp provider: ${name}`);
  return provider;
}

// bulk_provider has existed unused on crm_settings since Phase 1 — Phase 4's
// broadcast drainer is the first consumer. NULL/'' falls back to the 1:1
// provider, which keeps today's behavior for anyone who never touches it.
function getBulkWhatsApp(db) {
  const settings = db.prepare(`SELECT whatsapp_provider, bulk_provider FROM crm_settings WHERE id = 1`).get();
  const name = (settings && settings.bulk_provider) || (settings && settings.whatsapp_provider) || 'greenapi';
  const provider = WHATSAPP_PROVIDERS[name];
  if (!provider) throw new Error(`Unknown bulk WhatsApp provider: ${name}`);
  return provider;
}

module.exports = { getActiveWhatsApp, getBulkWhatsApp, WHATSAPP_PROVIDERS };
