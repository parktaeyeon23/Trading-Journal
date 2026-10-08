/**
 * Header-based access to entity sheets. Never depends on column order:
 * every read maps by the header row, every write builds rows from it.
 */

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  if (!id) throw apiError_('not_setup', 'Run setupSheets() first.')
  return SpreadsheetApp.openById(id)
}

/**
 * Loads one entity sheet into memory.
 * @return {{ entity, sheet, headers: string[], raw: any[][], rows: Object[], index: Object<string, number> }}
 *   rows are API-shaped objects (blank rows skipped); index maps id → 0-based position in raw.
 */
function openTable_(ss, entity) {
  var sheet = ss.getSheetByName(entity)
  if (!sheet) throw apiError_('not_setup', 'Missing sheet ' + entity + '. Run setupSheets().')
  var values = sheet.getDataRange().getValues()
  var headers = (values[0] || []).map(String)
  var fields = fieldsOf(entity)
  // raw keeps blank rows so raw[i] is always sheet row i + 2.
  var raw = values.slice(1)
  var rows = []
  var index = {}
  raw.forEach(function (r, i) {
    var blank = !r.some(function (c) {
      return c !== '' && c !== null
    })
    if (blank) return
    var obj = {}
    headers.forEach(function (h, c) {
      if (fields[h]) obj[h] = fromCell(fields[h], r[c])
    })
    rows.push(obj)
    if (obj.id) index[obj.id] = i
  })
  return { entity: entity, sheet: sheet, headers: headers, raw: raw, rows: rows, index: index }
}

function toCellValue_(v) {
  if (v === null || v === undefined) return ''
  return v
}

/** Applies a planUpsert() result to the sheet in as few range writes as possible. */
function applyPlan_(table, plan) {
  var width = table.headers.length
  plan.updates.forEach(function (row) {
    var i = table.index[row.id]
    var next = table.raw[i].slice()
    table.headers.forEach(function (h, c) {
      if (Object.prototype.hasOwnProperty.call(row, h)) next[c] = toCellValue_(row[h])
    })
    table.sheet.getRange(i + 2, 1, 1, width).setValues([next])
  })
  if (plan.inserts.length) {
    var block = plan.inserts.map(function (row) {
      return table.headers.map(function (h) {
        return toCellValue_(row[h])
      })
    })
    var start = table.raw.length + 2
    table.sheet.getRange(start, 1, block.length, width).setValues(block)
  }
}
