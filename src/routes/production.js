// Production/תפ"י order board — a deliberately price-free view over approved
// quotes. Reachable by 'operations' role staff (graphic operators, floor
// lead, production manager) who should never see selling prices, VAT totals,
// or commission data. /api/entities/Quote returns the full row including
// price_before_vat/price_with_vat/calculation_data — this endpoint exists
// specifically so the production UI never has to fetch that full row at all,
// not even to discard fields client-side (a devtools Network tab would still
// leak it).

module.exports = function registerProduction(app, db, deps) {
  const { requireOperations } = deps;

  app.get('/api/production/orders', requireOperations, (req, res) => {
    const rows = db.prepare(
      `SELECT id, quote_number, client_name, created_at, calculation_data
       FROM signshop_quotes
       WHERE status = 'approved'
       ORDER BY created_at DESC`
    ).all();

    const orders = rows.map(r => {
      let calc;
      try { calc = JSON.parse(r.calculation_data || '{}'); } catch { calc = {}; }
      const items = (calc.items || []).map((it, lineIndex) => ({
        lineIndex,
        productType: it.productType,
        widthM: it.widthM,
        heightM: it.heightM,
        thicknessMm: it.thicknessMm,
        quantity: it.quantity,
      }));
      return {
        id: r.id,
        quote_number: r.quote_number,
        client_name: r.client_name,
        created_at: r.created_at,
        items,
      };
    });

    res.json(orders);
  });
};
