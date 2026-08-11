// Backfills marketing_consent=1 for customers with an existing business
// relationship (at least one quote) — see CLAUDE.md CRM plan Phase 4 §1.
// consent_source is what makes this idempotent: it only ever touches a
// customer row that was never explicitly decided (by a human or an opt-out).
// Without it, a customer with quotes who later opts out would get flipped
// back to consent=1 on the very next boot.
function backfillMarketingConsent(db) {
  const { changes } = db.prepare(`
    UPDATE customers SET marketing_consent = 1, consent_source = 'quote_history',
           consent_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE marketing_consent = 0
      AND merged_into_id IS NULL
      AND phone_e164 IS NOT NULL
      AND consent_source IS NULL
      AND EXISTS (SELECT 1 FROM signshop_quotes q WHERE q.customer_id = customers.id)
      AND NOT EXISTS (SELECT 1 FROM crm_opt_outs o
                      WHERE o.phone_e164 = customers.phone_e164 AND o.revoked_at IS NULL)
  `).run();
  return { granted: changes };
}

module.exports = { backfillMarketingConsent };
