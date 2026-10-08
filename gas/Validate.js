/**
 * Row validation and cell conversion. Pure functions (no Apps Script services),
 * so they run unchanged in Node tests.
 */

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isEmpty_(v) {
  return v === null || v === undefined || v === ''
}

/** Parses an ISO-ish timestamp to canonical UTC ISO ('2026-10-08T06:40:00.000Z'), or null. */
function normalizeTs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v !== 'string' || v.length < 10) return null
  var d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Validates one incoming row and returns it converted for storage.
 * @return {{ ok: boolean, row: Object, errors: Array<{field: string, code: string}> }}
 */
function validateRow(entity, input) {
  var fields = fieldsOf(entity)
  var errors = []
  if (!fields) return { ok: false, row: null, errors: [{ field: '', code: 'unknown_entity' }] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, row: null, errors: [{ field: '', code: 'not_an_object' }] }
  }

  Object.keys(input).forEach(function (k) {
    if (!fields[k]) errors.push({ field: k, code: 'unknown_field' })
  })

  var out = {}
  Object.keys(fields).forEach(function (name) {
    var spec = fields[name]
    var v = input[name]
    if (isEmpty_(v)) {
      if (spec.required) errors.push({ field: name, code: 'required' })
      out[name] = null
      return
    }
    var conv = toStorage_(spec, v)
    if (conv.error) {
      errors.push({ field: name, code: conv.error })
      out[name] = null
    } else {
      out[name] = conv.value
    }
  })

  if (out.schema_version === null) out.schema_version = SCHEMA_VERSION
  if (out.deleted === null) out.deleted = false
  if (out.created_at && out.updated_at && out.updated_at < out.created_at) {
    errors.push({ field: 'updated_at', code: 'before_created_at' })
  }
  return { ok: errors.length === 0, row: out, errors: errors }
}

function toStorage_(spec, v) {
  switch (spec.type) {
    case 'string':
      if (typeof v !== 'string' && typeof v !== 'number') return { error: 'type' }
      return { value: String(v) }
    case 'number':
    case 'int': {
      var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
      if (!isFinite(n)) return { error: 'type' }
      if (spec.type === 'int' && Math.floor(n) !== n) return { error: 'type' }
      if (spec.min !== undefined && (spec.exclusiveMin ? n <= spec.min : n < spec.min)) return { error: 'range' }
      return { value: n }
    }
    case 'boolean':
      if (v === true || v === 'true' || v === 'TRUE') return { value: true }
      if (v === false || v === 'false' || v === 'FALSE') return { value: false }
      return { error: 'type' }
    case 'enum':
      return spec.values.indexOf(v) >= 0 ? { value: v } : { error: 'enum' }
    case 'json':
      if (typeof v === 'string') {
        try {
          JSON.parse(v)
          return { value: v }
        } catch (e) {
          return { error: 'json' }
        }
      }
      return { value: JSON.stringify(v) }
    case 'date':
      return typeof v === 'string' && DATE_RE.test(v) ? { value: v } : { error: 'date' }
    case 'ts': {
      var ts = normalizeTs_(v)
      return ts ? { value: ts } : { error: 'ts' }
    }
    default:
      return { error: 'type' }
  }
}

/** Converts a raw sheet cell back to its API value. */
function fromCell(spec, v) {
  if (!spec) return v
  if (v === '' || v === null || v === undefined) return spec.type === 'boolean' ? false : null
  switch (spec.type) {
    case 'number':
    case 'int':
      return typeof v === 'number' ? v : Number(v)
    case 'boolean':
      return v === true || v === 'TRUE' || v === 'true'
    case 'json':
      try {
        return typeof v === 'string' ? JSON.parse(v) : v
      } catch (e) {
        return null
      }
    case 'date':
      if (v instanceof Date) return Utilities_formatDate_(v)
      return String(v)
    case 'ts':
      return normalizeTs_(v) || String(v)
    default:
      return v instanceof Date ? v.toISOString() : String(v)
  }
}

/** YYYY-MM-DD in Asia/Seoul for a Date cell that Sheets auto-converted. */
function Utilities_formatDate_(d) {
  var kst = new Date(d.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}
