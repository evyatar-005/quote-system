// One-time (then incremental) backfill of the `customers` table from quote
// history — see CRM plan §8. Safe to call on every boot: after the first
// run it only processes quotes whose customer_id is still NULL, so quotes
// created between deploys get linked too, and re-running is a no-op.
//
// Never breaks existing quote code paths: signshop_quotes.client_* columns
// are only read here, never altered/dropped, and customer_id is written
// out-of-band (a plain UPDATE), not through quoteCreate/quoteUpdate.

const { toE164 } = require('./phone');

function normEmail(email) {
  return (email || '').toString().trim().toLowerCase() || null;
}
function normName(name) {
  return (name || '').toString().trim() || null;
}

// Identity key for grouping quotes into one customer: phone first (most
// reliable join key), then email, then exact trimmed name.
function identityKey(quote) {
  const phone = toE164(quote.client_phone);
  if (phone) return `phone:${phone}`;
  const email = normEmail(quote.client_email);
  if (email) return `email:${email}`;
  const name = normName(quote.client_name);
  if (name) return `name:${name}`;
  return null;
}

function backfillCustomers(db) {
  const existingCount = db.prepare(`SELECT COUNT(*) c FROM customers`).get().c;
  const quotes = existingCount > 0
    ? db.prepare(`SELECT * FROM signshop_quotes WHERE customer_id IS NULL ORDER BY id`).all()
    : db.prepare(`SELECT * FROM signshop_quotes ORDER BY id`).all();

  if (!quotes.length) return { total: existingCount, created: 0, linked: 0 };

  // Group quotes by identity key so multi-quote clients merge into one row
  // and later (more complete) quotes win on conflicting field values.
  const groups = new Map(); // key -> quotes[]
  const unkeyed = [];
  for (const q of quotes) {
    const key = identityKey(q);
    if (!key) { unkeyed.push(q); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const findByPhone = db.prepare(`SELECT * FROM customers WHERE phone_e164 = ? AND merged_into_id IS NULL LIMIT 1`);
  const findByEmail = db.prepare(`SELECT * FROM customers WHERE email = ? AND merged_into_id IS NULL LIMIT 1`);
  const findByName = db.prepare(`SELECT * FROM customers WHERE display_name = ? AND phone_e164 IS NULL AND email IS NULL AND merged_into_id IS NULL LIMIT 1`);
  const insertCustomer = db.prepare(`
    INSERT INTO customers (display_name, phone_e164, phone_raw, email, vat_id, address, company, source, owner_username, morning_client_id, created_by)
    VALUES (@display_name, @phone_e164, @phone_raw, @email, @vat_id, @address, @company, 'quote_backfill', @owner_username, @morning_client_id, @created_by)
  `);
  const updateCustomer = db.prepare(`
    UPDATE customers SET
      display_name = COALESCE(@display_name, display_name),
      phone_e164   = COALESCE(phone_e164, @phone_e164),
      phone_raw    = COALESCE(@phone_raw, phone_raw),
      email        = COALESCE(email, @email),
      vat_id       = COALESCE(@vat_id, vat_id),
      address      = COALESCE(@address, address),
      updated_at   = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const linkQuote = db.prepare(`UPDATE signshop_quotes SET customer_id = ? WHERE id = ?`);
  const morningMapByName = db.prepare(`SELECT morning_client_id FROM morning_clients_map WHERE local_client_name = ?`);
  const setMorningId = db.prepare(`UPDATE customers SET morning_client_id = ? WHERE id = ? AND morning_client_id IS NULL`);

  let created = 0;
  let linked = 0;

  const tx = db.transaction(() => {
    for (const [key, groupQuotes] of groups) {
      // Most recent non-empty value per field, across the group, newest quote wins.
      const sorted = [...groupQuotes].sort((a, b) => a.id - b.id);
      const latest = sorted[sorted.length - 1];
      const phone = toE164(latest.client_phone) || sorted.map(q => toE164(q.client_phone)).filter(Boolean).pop() || null;
      const email = normEmail(latest.client_email) || sorted.map(q => normEmail(q.client_email)).filter(Boolean).pop() || null;
      const name = normName(latest.client_name) || sorted.map(q => normName(q.client_name)).filter(Boolean).pop() || 'לקוח ללא שם';

      let existing = null;
      if (phone) existing = findByPhone.get(phone);
      if (!existing && email) existing = findByEmail.get(email);
      if (!existing && !phone && !email) existing = findByName.get(name);

      let customerId;
      if (existing) {
        updateCustomer.run({
          id: existing.id,
          display_name: name,
          phone_e164: phone,
          phone_raw: latest.client_phone || null,
          email,
          vat_id: latest.client_vat_id || null,
          address: latest.client_address || null,
        });
        customerId = existing.id;
      } else {
        const { lastInsertRowid } = insertCustomer.run({
          display_name: name,
          phone_e164: phone,
          phone_raw: latest.client_phone || null,
          email,
          vat_id: latest.client_vat_id || null,
          address: latest.client_address || null,
          company: null,
          owner_username: latest.created_by || null,
          morning_client_id: null,
          created_by: latest.created_by || null,
        });
        customerId = lastInsertRowid;
        created += 1;
      }

      // Best-effort link to an already-known Morning client id, by name.
      try {
        const mm = morningMapByName.get(name);
        if (mm) setMorningId.run(mm.morning_client_id, customerId);
      } catch (_) {}

      for (const q of groupQuotes) {
        linkQuote.run(customerId, q.id);
        linked += 1;
      }
    }

    // Quotes with no usable identity at all (no phone/email/name) get their
    // own standalone customer row each, rather than being silently skipped —
    // they still need to show up somewhere in the CRM.
    for (const q of unkeyed) {
      const { lastInsertRowid } = insertCustomer.run({
        display_name: 'לקוח ללא שם',
        phone_e164: null,
        phone_raw: q.client_phone || null,
        email: null,
        vat_id: q.client_vat_id || null,
        address: q.client_address || null,
        company: null,
        owner_username: q.created_by || null,
        morning_client_id: null,
        created_by: q.created_by || null,
      });
      created += 1;
      linkQuote.run(lastInsertRowid, q.id);
      linked += 1;
    }
  });
  tx();

  const total = db.prepare(`SELECT COUNT(*) c FROM customers`).get().c;
  return { total, created, linked };
}

module.exports = { backfillCustomers, identityKey };
