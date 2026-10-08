/**
 * Web app entry. Every request is a POST with a JSON body (sent as text/plain
 * by the app to avoid a CORS preflight):
 *   { "secret": "...", "action": "ping|pullAll|upsert|softDelete|batch|getSettings|getQuote|uploadImage", ...params }
 * Every response is JSON: { ok: true, ... } or { ok: false, error: { code, message } }.
 * Apps Script web apps cannot set HTTP status codes, so callers check `ok`.
 */

var MAX_ROWS_PER_OP = 500
var LOCK_WAIT_MS = 20000

function doPost(e) {
  var req
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '')
  } catch (err) {
    return json_(fail_(apiError_('bad_request', 'Body must be JSON.')))
  }
  return json_(handleRequest(req))
}

/** GET only says the service is alive; it never returns data. */
function doGet() {
  return json_({ ok: true, service: 'alpha-journal', schemaVersion: SCHEMA_VERSION })
}

/** Routes one parsed request. Exposed (no underscore) so tests can call it directly. */
function handleRequest(req) {
  try {
    if (!req || typeof req !== 'object') throw apiError_('bad_request', 'Body must be a JSON object.')
    checkSecret_(req.secret)
    switch (req.action) {
      case 'ping':
        return { ok: true, serverTime: nowIso_(), schemaVersion: SCHEMA_VERSION }
      case 'pullAll':
        // Locked too: a read that overlaps a write could otherwise miss a row
        // whose synced_at is earlier than the serverTime handed back.
        return withLock_(function () {
          return pullAll_(req.since)
        })
      case 'getSettings':
        return getSettings_()
      case 'getQuote':
        return getQuote_(req.symbol, req.market)
      case 'getBars':
        return getBars_(req.symbol, req.market, req.from, req.to)
      case 'uploadImage':
        return uploadImage_(req)
      case 'upsert':
        return withLock_(function () {
          return { ok: true, serverTime: nowIso_(), results: [runOp_({ op: 'upsert', entity: req.entity, rows: req.rows })] }
        })
      case 'softDelete':
        return withLock_(function () {
          return { ok: true, serverTime: nowIso_(), results: [runOp_({ op: 'softDelete', entity: req.entity, ids: req.ids })] }
        })
      case 'batch':
        if (!Array.isArray(req.ops)) throw apiError_('bad_request', 'ops must be an array.')
        return withLock_(function () {
          return { ok: true, serverTime: nowIso_(), results: req.ops.map(runOp_) }
        })
      default:
        throw apiError_('unknown_action', 'Unknown action: ' + req.action)
    }
  } catch (err) {
    return fail_(err)
  }
}

// ---------- reads ----------

function pullAll_(since) {
  var sinceIso = null
  if (since !== undefined && since !== null && since !== '') {
    sinceIso = normalizeTs_(since)
    if (!sinceIso) throw apiError_('bad_request', 'since must be an ISO timestamp.')
  }
  // Taken before reading so the client's next `since` never skips a concurrent write.
  var serverTime = nowIso_()
  var ss = getSpreadsheet_()
  var data = {}
  entityNames().forEach(function (entity) {
    var rows = openTable_(ss, entity).rows
    data[entity] = sinceIso
      ? rows.filter(function (r) {
          // Rows written before synced_at existed fall back to updated_at.
          var changed = r.synced_at || r.updated_at
          return changed && changed > sinceIso
        })
      : rows
  })
  return { ok: true, serverTime: serverTime, data: data }
}

function getSettings_() {
  var rows = openTable_(getSpreadsheet_(), 'Settings').rows
  var out = {}
  rows.forEach(function (r) {
    if (!r.deleted && r.key) out[r.key] = r.value
  })
  return { ok: true, settings: out }
}

// ---------- writes ----------

function runOp_(op) {
  if (!op || typeof op !== 'object') throw apiError_('bad_request', 'Each op must be an object.')
  if (!ENTITIES[op.entity]) throw apiError_('unknown_entity', 'Unknown entity: ' + op.entity)
  if (op.op === 'upsert') return upsert_(op.entity, op.rows)
  if (op.op === 'softDelete') return softDelete_(op.entity, op.ids)
  throw apiError_('bad_request', 'op must be upsert or softDelete.')
}

function upsert_(entity, rows) {
  if (!Array.isArray(rows)) throw apiError_('bad_request', 'rows must be an array.')
  if (rows.length > MAX_ROWS_PER_OP) throw apiError_('too_many_rows', 'At most ' + MAX_ROWS_PER_OP + ' rows per op.')
  var ss = getSpreadsheet_()
  var fields = fieldsOf(entity)
  var refIds = {}
  var valid = []
  var rejected = []

  rows.forEach(function (input, i) {
    var res = validateRow(entity, input)
    var errors = res.errors
    if (res.ok) {
      Object.keys(fields).forEach(function (name) {
        var target = fields[name].ref
        var v = res.row[name]
        if (!target || v === null) return
        // Read per op, so a parent written by an earlier op in the same batch is found.
        if (!refIds[target]) refIds[target] = openTable_(ss, target).index
        if (!(v in refIds[target])) errors.push({ field: name, code: 'ref_missing' })
      })
    }
    if (errors.length) {
      rejected.push({ index: i, id: input && input.id ? String(input.id) : null, errors: errors })
    } else {
      valid.push(res.row)
    }
  })

  var table = openTable_(ss, entity)
  var existing = {}
  Object.keys(table.index).forEach(function (id) {
    existing[id] = rowAt_(table, id)
  })
  var plan = planUpsert(existing, valid)
  var stamp = nowIso_()
  plan.inserts.concat(plan.updates).forEach(function (row) {
    row.synced_at = stamp
  })
  applyPlan_(table, plan)
  if (entity === 'ChartImages') trashDeletedCharts_(existing, plan.updates)
  return {
    op: 'upsert',
    entity: entity,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged.length,
    conflicts: plan.conflicts,
    rejected: rejected,
  }
}

function softDelete_(entity, ids) {
  if (!Array.isArray(ids)) throw apiError_('bad_request', 'ids must be an array.')
  if (ids.length > MAX_ROWS_PER_OP) throw apiError_('too_many_rows', 'At most ' + MAX_ROWS_PER_OP + ' ids per op.')
  var table = openTable_(getSpreadsheet_(), entity)
  var now = nowIso_()
  var updates = []
  var notFound = []
  ids.forEach(function (id) {
    if (String(id) in table.index) updates.push({ id: String(id), deleted: true, updated_at: now, synced_at: now })
    else notFound.push(String(id))
  })
  var before = {}
  updates.forEach(function (u) {
    before[u.id] = rowAt_(table, u.id)
  })
  applyPlan_(table, { inserts: [], updates: updates, unchanged: [], conflicts: [] })
  if (entity === 'ChartImages') trashDeletedCharts_(before, updates)
  return { op: 'softDelete', entity: entity, deleted: updates.length, notFound: notFound, updated_at: now }
}

function rowAt_(table, id) {
  var i = table.index[id]
  var fields = fieldsOf(table.entity)
  var obj = {}
  table.headers.forEach(function (h, c) {
    if (fields[h]) obj[h] = fromCell(fields[h], table.raw[i][c])
  })
  return obj
}

// ---------- plumbing ----------

function checkSecret_(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_SECRET')
  if (!expected) throw apiError_('not_setup', 'API_SECRET is not set. Run setupSheets().')
  if (typeof secret !== 'string' || !constantTimeEqual_(secret, expected)) {
    throw apiError_('unauthorized', 'Invalid secret.')
  }
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false
  var diff = 0
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function withLock_(fn) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(LOCK_WAIT_MS)) throw apiError_('busy', 'Another write is in progress. Retry shortly.')
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}

function nowIso_() {
  return new Date().toISOString()
}

function apiError_(code, message) {
  var err = new Error(message)
  err.apiCode = code
  return err
}

function fail_(err) {
  return { ok: false, error: { code: err.apiCode || 'internal', message: String(err.message || err) } }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
