// Base44-compatible generic entities API: /api/entities/:name
// Serves .list(), .filter(), .create(), .update(), .delete(), .bulkCreate().
//
// deps: { loadConfig, upsertConfig, requireAuth, requireAdmin, requireOperations }
//   - loadConfig()  → flat { key: value } object from signshop_config
//   - upsertConfig  → prepared stmt taking { key, value, label }

const { ensureMorningClient } = require('../services/morning/sync');
const { resolveRecipe } = require('../services/production/resolveRecipe');

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
  NumberPriceTier:      { table: 'signshop_number_tiers', cols: ['product_type', 'height_cm', 'thickness_mm', 'price_per_unit', 'min_price'] },
  // Production recipes (תפ"י) — phase 1, template only, no timing.
  Station:              { table: 'production_stations',     cols: ['key', 'name', 'kind'] },
  Operation:             { table: 'production_operations',   cols: ['key', 'name'] },
  Recipe:                { table: 'production_recipes',      cols: ['product_type', 'notes'] },
  RecipeStep:            { table: 'production_recipe_steps', cols: ['recipe_id', 'seq', 'operation_key', 'station_key', 'performer', 'is_optional', 'condition_text', 'alt_group', 'notes'] },
};

// Which entities require admin for writes.
const ADMIN_WRITE = new Set([
  'PriceTier', 'StickerPriceTier', 'PaintSurchargeTier',
  'LightboxSizeTier', 'LightboxSellingPrice', 'PricingConfig', 'KapaPriceTier', 'RollupPriceTier', 'LokobondAreaTier', 'GlassPriceTier', 'NumberPriceTier',
]);

// Production recipe (תפ"י) entities: editable by 'operations' role staff
// (production manager) as well as admin, but NOT by a sales agent — these
// never touch pricing so they don't need full admin, but they're not
// something every authenticated user should write either.
const OPERATIONS_WRITE = new Set(['Station', 'Operation', 'Recipe', 'RecipeStep']);

const CONFIG_META = new Set(['id', 'config_name', 'created_date', 'created_by', 'updated_date']);

module.exports = function registerEntities(app, db, deps) {
  const { loadConfig, upsertConfig, requireAuth, requireAdmin, requireOperations } = deps;

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
    // better-sqlite3 rejects raw JS booleans as bind params — normalize here
    // once rather than relying on every caller to send 0/1 for flag columns
    // (e.g. RecipeStep.is_optional).
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }
  // Quote columns (signshop_quotes) — resolved after ALTER at boot
  const quoteCols = db.prepare(`PRAGMA table_info(signshop_quotes)`).all().map(c => c.name);

  // ── auth dispatch helpers ────────────────────────────────────────────────
  const writeMw = (name) => (ADMIN_WRITE.has(name) ? requireAdmin : OPERATIONS_WRITE.has(name) ? requireOperations : requireAuth);

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
    if (!body.client_phone?.toString().trim()) throw Object.assign(new Error('client_phone required'), { status: 400 });
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

    // Register the client in Morning right away rather than waiting for this
    // quote to be issued as a document — but never let a Morning/network
    // hiccup fail the quote save itself, so this is fire-and-forget.
    if (body.morning_client_id) {
      // Selected from the search box — already exists in Morning, just cache
      // the mapping so issuing later skips a redundant search call. An
      // explicit selection always wins over whatever was cached before (e.g.
      // an earlier quote under the same free-typed name resolved to a
      // different Morning client) — DO UPDATE, not IGNORE.
      try {
        db.prepare(
          `INSERT INTO morning_clients_map (local_client_name, morning_client_id) VALUES (?, ?)
           ON CONFLICT(local_client_name) DO UPDATE SET morning_client_id = excluded.morning_client_id`
        ).run(body.client_name.toString().trim(), body.morning_client_id);
      } catch (_) {}
    } else {
      ensureMorningClient(db, body.client_name, {
        phone: body.client_phone,
        address: body.client_address,
        vatId: body.client_vat_id,
        email: body.client_email,
      }).catch(err => console.error(`[quoteCreate] Morning client registration failed for quote #${lastInsertRowid}:`, err.message));
    }

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
  // Worksheet — production_worksheets(+steps), derived from a saved Quote
  // line item via resolveRecipe(). Create-only from the app's perspective:
  // a worksheet is a frozen proposal a תפ"י operator then edits in place
  // (PUT on individual RecipeStep-shaped rows would defeat the "frozen at
  // creation time" guarantee, so updates go through dedicated fields below).
  // ═══════════════════════════════════════════════════════════════════════
  function worksheetCreate(body, user) {
    const quoteId = parseInt(body.quote_id, 10);
    const lineIndex = parseInt(body.line_index, 10) || 0;
    if (!quoteId) throw Object.assign(new Error('quote_id required'), { status: 400 });

    const quote = db.prepare(`SELECT * FROM signshop_quotes WHERE id = ?`).get(quoteId);
    if (!quote) throw Object.assign(new Error('Quote not found'), { status: 404 });

    let calc;
    try { calc = JSON.parse(quote.calculation_data || '{}'); } catch { calc = {}; }
    const item = (calc.items || [])[lineIndex];
    if (!item) throw Object.assign(new Error(`No calculation_data.items[${lineIndex}] on this quote`), { status: 400 });

    const recipeRow = db.prepare(`SELECT * FROM production_recipes WHERE product_type = ?`).get(item.productType);
    if (!recipeRow) throw Object.assign(new Error(`No recipe defined for productType "${item.productType}"`), { status: 404 });
    const steps = db.prepare(`SELECT * FROM production_recipe_steps WHERE recipe_id = ? ORDER BY seq`).all(recipeRow.id);

    const proposed = resolveRecipe({ product_type: recipeRow.product_type, steps }, item);

    const tx = db.transaction(() => {
      const ins = db.prepare(
        `INSERT INTO production_worksheets (quote_id, line_index, product_type, created_by) VALUES (?, ?, ?, ?)`
      );
      const { lastInsertRowid: worksheetId } = ins.run(quoteId, lineIndex, item.productType, user.username);
      const insStep = db.prepare(
        `INSERT INTO production_worksheet_steps (worksheet_id, seq, operation_key, station_key, performer, included, auto_reason, notes)
         VALUES (@worksheet_id, @seq, @operation_key, @station_key, @performer, @included, @auto_reason, @notes)`
      );
      proposed.forEach((s, i) => insStep.run({
        worksheet_id: worksheetId,
        seq: i + 1,
        operation_key: s.operation_key,
        station_key: s.station_key,
        performer: s.performer,
        included: s.included ? 1 : 0,
        auto_reason: s.autoReason,
        notes: s.notes,
      }));
      return worksheetId;
    });
    const worksheetId = tx();
    return worksheetRowById(worksheetId);
  }

  function worksheetRowById(id) {
    const worksheet = db.prepare(`SELECT * FROM production_worksheets WHERE id = ?`).get(id);
    if (!worksheet) return null;
    worksheet.steps = db.prepare(`SELECT * FROM production_worksheet_steps WHERE worksheet_id = ? ORDER BY seq`).all(id);
    return worksheet;
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

  // GET list/filter — reads require auth generally, but production-recipe
  // entities (including Worksheet, which carries no pricing) are further
  // restricted to operations/admin — a sales agent has no reason to read them.
  const READ_OPERATIONS_ONLY = new Set(['Station', 'Operation', 'Recipe', 'RecipeStep', 'Worksheet']);
  app.get('/api/entities/:name', (req, res) => {
    const name = req.params.name;
    const readMw = READ_OPERATIONS_ONLY.has(name) ? requireOperations : requireAuth;
    readMw(req, res, () => {
      if (name === 'PricingConfig') return res.json([configObject()]);
      if (name === 'Quote')         return quoteList(req, res);
      if (name === 'User')          return userList(req, res);
      if (name === 'Worksheet') {
        const { quote_id } = req.query;
        const rows = quote_id
          ? db.prepare(`SELECT id FROM production_worksheets WHERE quote_id = ? ORDER BY line_index`).all(quote_id)
          : db.prepare(`SELECT id FROM production_worksheets ORDER BY id DESC LIMIT 200`).all();
        return res.json(rows.map(r => worksheetRowById(r.id)));
      }
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
    if (name === 'Worksheet') {
      return requireOperations(req, res, () => {
        try {
          res.status(201).json(worksheetCreate(req.body || {}, req.user));
        } catch (err) {
          res.status(err.status || 400).json({ error: err.message });
        }
      });
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

  // PUT a single worksheet step — the only mutation an operator makes on a
  // frozen worksheet: flip included, or override performer/station.
  app.put('/api/entities/WorksheetStep/:id', (req, res) => {
    requireOperations(req, res, () => {
      const id = parseInt(req.params.id, 10);
      const existing = db.prepare(`SELECT * FROM production_worksheet_steps WHERE id = ?`).get(id);
      if (!existing) return res.status(404).json({ error: 'WorksheetStep not found' });
      const cols = ['included', 'performer', 'station_key', 'notes'];
      const row = { id };
      const setCols = [];
      for (const c of cols) {
        if (c in req.body) {
          let v = req.body[c];
          // better-sqlite3 rejects raw JS booleans as bind params — the
          // client naturally sends included as true/false, so normalize
          // to 0/1 here rather than pushing that awareness onto every caller.
          if (typeof v === 'boolean') v = v ? 1 : 0;
          row[c] = v;
          setCols.push(c);
        }
      }
      if (setCols.length) {
        db.prepare(`UPDATE production_worksheet_steps SET ${setCols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run(row);
      }
      res.json(db.prepare(`SELECT * FROM production_worksheet_steps WHERE id = ?`).get(id));
    });
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
