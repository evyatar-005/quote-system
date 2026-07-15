// Base44-compatible generic entities API: /api/entities/:name
// Serves .list(), .filter(), .create(), .update(), .delete(), .bulkCreate().
//
// deps: { loadConfig, upsertConfig, requireAuth, requireAdmin }
//   - loadConfig()  → flat { key: value } object from signshop_config
//   - upsertConfig  → prepared stmt taking { key, value, label }

// Entities backed by a plain table (generic CRUD).
const REGISTRY = {
  PriceTier:            { table: 'signshop_price_tiers',    cols: ['product_type', 'thickness_mm', 'price_per_sqm', 'min_price', 'agent_min_price_per_sqm'] },
  StickerPriceTier:     { table: 'signshop_sticker_tiers',  cols: ['product_type', 'area_sqm', 'sticker_price', 'installation_price_center', 'installation_price_south'] },
  PaintSurchargeTier:   { table: 'signshop_paint_tiers',    cols: ['paint_type', 'area_from', 'area_to', 'surcharge', 'tier_description'] },
  LightboxSizeTier:     { table: 'signshop_lightbox_tiers', cols: ['size_label', 'width_cm', 'height_cm', 'frame_cost', 'led_cost', 'transformer_cost', 'selling_base_price', 'selling_price_per_sqm'] },
  LightboxSellingPrice: { table: 'signshop_lightbox_selling_prices', cols: ['sub_type', 'size_label', 'selling_base_price', 'selling_price_per_sqm'] },
  KapaPriceTier:        { table: 'signshop_kapa_tiers',      cols: ['sku', 'description', 'max_width_m', 'max_height_m', 'cut_type', 'price'] },
  RollupPriceTier:      { table: 'signshop_rollup_tiers',    cols: ['product_type', 'sku', 'description', 'width_m', 'height_m', 'paper_cost_per_sqm', 'stand_cost', 'price_unit_1', 'price_unit_2', 'price_unit_3_plus'] },
  LokobondAreaTier:     { table: 'signshop_lokobond_area_tiers', cols: ['product_type', 'area_from', 'price_per_sqm', 'min_price', 'agent_min_price_per_sqm'] },
  GlassPriceTier:       { table: 'signshop_glass_tiers', cols: ['product_type', 'sku', 'description', 'width_cm', 'height_cm', 'cost_price', 'selling_price'] },
};

// Which entities require admin for writes.
const ADMIN_WRITE = new Set([
  'PriceTier', 'StickerPriceTier', 'PaintSurchargeTier',
  'LightboxSizeTier', 'LightboxSellingPrice', 'PricingConfig', 'KapaPriceTier', 'RollupPriceTier', 'LokobondAreaTier', 'GlassPriceTier',
]);

const CONFIG_META = new Set(['id', 'config_name', 'created_date', 'created_by', 'updated_date']);

module.exports = function registerEntities(app, db, deps) {
  const { loadConfig, upsertConfig, requireAuth, requireAdmin } = deps;

  // real column list per backing table (trusted constant names), plus which
  // ones are NOT NULL — needed so "user cleared this field" (null) maps to 0
  // for NOT NULL numeric columns instead of either crashing or being silently
  // dropped (both were real bugs we hit before this).
  const tableCols = {};
  const notNullCols = {};
  for (const [name, reg] of Object.entries(REGISTRY)) {
    const info = db.prepare(`PRAGMA table_info(${reg.table})`).all();
    tableCols[name] = info.map(c => c.name);
    notNullCols[name] = new Set(info.filter(c => c.notnull).map(c => c.name));
  }
  // body[c] as actually sent (null → cleared field) resolved against column
  // nullability: NOT NULL columns get 0 instead of null; nullable columns and
  // real values pass through unchanged. Returns undefined only when the field
  // was never provided at all (create: omit → DB default; update: skip → keep existing).
  function resolveValue(name, c, body) {
    if (!(c in body)) return undefined;
    const v = body[c];
    if (v === null || v === undefined) return notNullCols[name].has(c) ? 0 : null;
    return v;
  }
  // Quote columns (signshop_quotes) — resolved after ALTER at boot
  const quoteCols = db.prepare(`PRAGMA table_info(signshop_quotes)`).all().map(c => c.name);

  // ── auth dispatch helpers ────────────────────────────────────────────────
  const writeMw = (name) => (ADMIN_WRITE.has(name) ? requireAdmin : requireAuth);

  // ═══════════════════════════════════════════════════════════════════════
  // Generic table CRUD
  // ═══════════════════════════════════════════════════════════════════════
  function genList(name, req, res) {
    const reg = REGISTRY[name];
    const cols = tableCols[name];
    const { sort, limit, ...filters } = req.query;
    const where = [];
    const params = [];
    for (const [k, v] of Object.entries(filters)) {
      if (cols.includes(k)) { where.push(`${k} = ?`); params.push(v); }
    }
    let sql = `SELECT * FROM ${reg.table}`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (sort) {
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      if (cols.includes(field)) sql += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    }
    if (limit && Number.isInteger(+limit)) sql += ` LIMIT ${parseInt(limit, 10)}`;
    res.json(db.prepare(sql).all(...params));
  }

  function genCreate(name, body) {
    const reg = REGISTRY[name];
    // Columns not present in body at all are omitted so SQLite's own DEFAULT
    // applies. Columns present but cleared (null) resolve via resolveValue:
    // 0 for NOT NULL columns, real null for nullable ones — never a raw NULL
    // forced into a NOT NULL column (that crashes), and never silently dropped
    // (that made "clear this field" a no-op).
    const row = {};
    for (const c of reg.cols) {
      const v = resolveValue(name, c, body);
      if (v !== undefined) row[c] = v;
    }
    const providedCols = Object.keys(row);
    const ins = providedCols.length
      ? db.prepare(`INSERT INTO ${reg.table} (${providedCols.join(', ')}) VALUES (${providedCols.map(c => '@' + c).join(', ')})`)
      : db.prepare(`INSERT INTO ${reg.table} DEFAULT VALUES`);
    const { lastInsertRowid } = ins.run(row);
    return db.prepare(`SELECT * FROM ${reg.table} WHERE id = ?`).get(lastInsertRowid);
  }

  function genUpdate(name, id, body, res) {
    const reg = REGISTRY[name];
    const existing = db.prepare(`SELECT * FROM ${reg.table} WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: `${name} not found` });
    const row = { id };
    const setCols = [];
    for (const c of reg.cols) {
      const v = resolveValue(name, c, body);
      if (v !== undefined) { row[c] = v; setCols.push(c); }
    }
    if (setCols.length) {
      const sql = `UPDATE ${reg.table} SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`;
      db.prepare(sql).run(row);
    }
    res.json(db.prepare(`SELECT * FROM ${reg.table} WHERE id = ?`).get(id));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PricingConfig — KV adapter over signshop_config
  // ═══════════════════════════════════════════════════════════════════════
  function configObject() {
    return { id: 'default', config_name: 'default', ...loadConfig() };
  }

  function configUpsert(body) {
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        if (CONFIG_META.has(key)) continue;
        const num = value === '' || value == null ? null : Number(value);
        upsertConfig.run({ key, value: num, label: null });
      }
    });
    tx();
    return configObject();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Quote — signshop_quotes (line_items already a JSON string from client)
  // ═══════════════════════════════════════════════════════════════════════
  function quoteCreate(body, user) {
    if (!body.client_name?.toString().trim()) throw Object.assign(new Error('client_name required'), { status: 400 });
    for (const priceCol of ['price_before_vat', 'price_with_vat']) {
      const v = body[priceCol];
      if (v != null && (typeof v !== 'number' || v < 0)) {
        throw Object.assign(new Error(`${priceCol} must be a non-negative number`), { status: 400 });
      }
    }
    // quote_number is always assigned by the server — never trust a client-typed
    // value — so every quote is unmistakably numbered by "ממשק סוכני מכירות".
    const provided = quoteCols.filter(c => c !== 'id' && c !== 'quote_number' && c in body);
    const row = {};
    for (const c of provided) row[c] = body[c];
    // username, not email — email is optional on a user account in this
    // internal system (several accounts have it blank), but username never is,
    // so this is the only field guaranteed to tie a quote back to its author.
    row.created_by = user.username;                     // override client value
    if (!provided.includes('created_by')) provided.push('created_by');
    const ins = db.prepare(
      `INSERT INTO signshop_quotes (${provided.join(', ')}) VALUES (${provided.map(c => '@' + c).join(', ')})`
    );
    const { lastInsertRowid } = ins.run(row);
    const quoteNumber = `מכירות-${String(lastInsertRowid).padStart(2, '0')}`;
    db.prepare(`UPDATE signshop_quotes SET quote_number = ? WHERE id = ?`).run(quoteNumber, lastInsertRowid);
    return quoteRowById(lastInsertRowid);
  }

  function quoteRowById(id) {
    const r = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(id);
    if (r) r.created_date = r.created_at;
    return r;
  }

  function quoteList(req, res) {
    const { sort, limit, ...filters } = req.query;
    const where = [];
    const params = [];
    for (const [k, v] of Object.entries(filters)) {
      if (quoteCols.includes(k)) { where.push(`${k} = ?`); params.push(v); }
    }
    let sql = `SELECT * FROM signshop_quotes`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    if (sort) {
      const desc = sort.startsWith('-');
      const field = (desc ? sort.slice(1) : sort) === 'created_date' ? 'created_at' : (desc ? sort.slice(1) : sort);
      if (quoteCols.includes(field)) sql += ` ORDER BY ${field} ${desc ? 'DESC' : 'ASC'}`;
    }
    if (limit && Number.isInteger(+limit)) sql += ` LIMIT ${parseInt(limit, 10)}`;
    const rows = db.prepare(sql).all(...params);
    for (const r of rows) r.created_date = r.created_at;
    res.json(rows);
  }

  function quoteUpdate(id, body, res) {
    const existing = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    // Backstop against a client-side discount bug producing a negative price
    // (e.g. an unclamped percent discount) — reject rather than silently save.
    for (const priceCol of ['price_before_vat', 'price_with_vat']) {
      const v = body[priceCol];
      if (v != null && (typeof v !== 'number' || v < 0)) {
        return res.status(400).json({ error: `${priceCol} must be a non-negative number` });
      }
    }
    // Same protection as quoteCreate: quote_number and created_by are server-
    // assigned identity/attribution, never client-settable, on update either.
    const setCols = quoteCols.filter(c => c !== 'id' && c !== 'created_at' && c !== 'quote_number' && c !== 'created_by' && c in body);
    if (setCols.length) {
      const row = { id };
      for (const c of setCols) row[c] = body[c];
      db.prepare(`UPDATE signshop_quotes SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
    }
    res.json(quoteRowById(id));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // User — read-only over users table
  // ═══════════════════════════════════════════════════════════════════════
  function userList(req, res) {
    const { email, username } = req.query;
    let sql = `SELECT id, username, full_name, email, role FROM users`;
    const params = [];
    if (username !== undefined) { sql += ` WHERE username = ?`; params.push(username); }
    else if (email !== undefined) { sql += ` WHERE email = ?`; params.push(email); }
    res.json(db.prepare(sql).all(...params));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Route registration
  // ═══════════════════════════════════════════════════════════════════════

  // GET list/filter — all reads require auth
  app.get('/api/entities/:name', (req, res) => {
    requireAuth(req, res, () => {
      const name = req.params.name;
      if (name === 'PricingConfig') return res.json([configObject()]);
      if (name === 'Quote')         return quoteList(req, res);
      if (name === 'User')          return userList(req, res);
      if (REGISTRY[name])           return genList(name, req, res);
      res.status(404).json({ error: `unknown entity: ${name}` });
    });
  });

  // POST bulk — must precede /:name catch for create semantics (distinct path)
  app.post('/api/entities/:name/bulk', (req, res) => {
    const name = req.params.name;
    writeMw(name)(req, res, () => {
      if (name === 'User')  return res.status(405).json({ error: 'read-only' });
      if (!REGISTRY[name])  return res.status(400).json({ error: `bulk unsupported for ${name}` });
      const items = Array.isArray(req.body) ? req.body : (req.body?.items || []);
      const created = db.transaction(() => items.map(it => genCreate(name, it)))();
      res.status(201).json(created);
    });
  });

  // POST create
  app.post('/api/entities/:name', (req, res) => {
    const name = req.params.name;
    if (name === 'User') {
      return requireAuth(req, res, () => res.status(405).json({ error: 'read-only' }));
    }
    if (name === 'Quote') {
      return requireAuth(req, res, () => {
        try {
          res.status(201).json(quoteCreate(req.body || {}, req.user));
        } catch (err) {
          res.status(err.status || 400).json({ error: err.message });
        }
      });
    }
    if (name === 'PricingConfig') {
      return requireAdmin(req, res, () => res.json(configUpsert(req.body || {})));
    }
    if (REGISTRY[name]) {
      return writeMw(name)(req, res, () => res.status(201).json(genCreate(name, req.body || {})));
    }
    res.status(404).json({ error: `unknown entity: ${name}` });
  });

  // PUT update
  app.put('/api/entities/:name/:id', (req, res) => {
    const name = req.params.name;
    const rawId = req.params.id;
    if (name === 'User') {
      return requireAuth(req, res, () => res.status(405).json({ error: 'read-only' }));
    }
    if (name === 'PricingConfig') {
      return requireAdmin(req, res, () => res.json(configUpsert(req.body || {})));
    }
    if (name === 'Quote') {
      // Admin-only: reachable in the app only from the manager's QuotesHistory
      // screen (approve/reject/status/edit). Agents only ever call Quote.create.
      return requireAdmin(req, res, () => quoteUpdate(parseInt(rawId, 10), req.body || {}, res));
    }
    if (REGISTRY[name]) {
      return writeMw(name)(req, res, () => genUpdate(name, parseInt(rawId, 10), req.body || {}, res));
    }
    res.status(404).json({ error: `unknown entity: ${name}` });
  });

  // DELETE
  app.delete('/api/entities/:name/:id', (req, res) => {
    const name = req.params.name;
    const id = parseInt(req.params.id, 10);
    if (name === 'User') {
      return requireAuth(req, res, () => res.status(405).json({ error: 'read-only' }));
    }
    if (name === 'Quote') {
      // Admin-only — same reasoning as PUT above.
      return requireAdmin(req, res, () => {
        db.prepare(`DELETE FROM signshop_quotes WHERE id = ?`).run(id);
        // Cascade-clean notifications referencing this quote so an approved
        // notification's "הנפק ללקוח" button never points at a deleted quote.
        db.prepare(`DELETE FROM notifications WHERE quote_id = ?`).run(id);
        res.json({ ok: true, id });
      });
    }
    if (REGISTRY[name]) {
      return writeMw(name)(req, res, () => {
        db.prepare(`DELETE FROM ${REGISTRY[name].table} WHERE id = ?`).run(id);
        res.json({ ok: true, id });
      });
    }
    res.status(404).json({ error: `unknown entity: ${name}` });
  });
};
