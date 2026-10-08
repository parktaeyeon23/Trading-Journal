/**
 * One-time and maintenance functions, run from the Apps Script editor.
 */

var DB_TITLE = 'ALPHA JOURNAL DB'
var ROOT_FOLDER = 'ALPHA JOURNAL'
var TEXT_TYPES = { string: true, enum: true, json: true, date: true, ts: true }

/**
 * Creates the spreadsheet (first run), every entity sheet, and any missing
 * header columns. Safe to run any number of times: it only adds what is missing
 * and never reorders, renames or deletes columns or rows.
 * @return {{ spreadsheetId: string, createdSheets: string[], addedColumns: Object<string,string[]>, addedSettings: string[] }}
 */
function setupSheets() {
  var props = PropertiesService.getScriptProperties()
  var ss
  var id = props.getProperty('SPREADSHEET_ID')
  if (id) {
    ss = SpreadsheetApp.openById(id)
  } else {
    ss = SpreadsheetApp.create(DB_TITLE)
    props.setProperty('SPREADSHEET_ID', ss.getId())
    moveToFolder_(ss.getId(), [ROOT_FOLDER])
  }

  var summary = { spreadsheetId: ss.getId(), createdSheets: [], addedColumns: {}, addedSettings: [] }

  entityNames().forEach(function (entity) {
    var sheet = ss.getSheetByName(entity)
    if (!sheet) {
      sheet = ss.insertSheet(entity)
      summary.createdSheets.push(entity)
    }
    var lastCol = sheet.getLastColumn()
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : []
    var missing = columnsOf(entity).filter(function (c) {
      return headers.indexOf(c) < 0
    })
    if (missing.length) {
      sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing])
      summary.addedColumns[entity] = missing
      headers = headers.concat(missing)
    }
    sheet.setFrozenRows(1)
    // Keep text as text: tickers like 042700, dates and JSON must not be auto-converted.
    var fields = fieldsOf(entity)
    var bodyRows = Math.max(sheet.getMaxRows() - 1, 1)
    headers.forEach(function (h, c) {
      if (fields[h] && TEXT_TYPES[fields[h].type]) sheet.getRange(2, c + 1, bodyRows, 1).setNumberFormat('@')
    })
  })

  removeDefaultSheet_(ss)
  summary.addedSettings = seedSettings_(ss)

  if (!props.getProperty('API_SECRET')) {
    props.setProperty('API_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''))
    Logger.log('새 API_SECRET이 만들어졌습니다. 프로젝트 설정 → 스크립트 속성에서 값을 복사해 앱 설정에 넣으세요.')
  }
  Logger.log(JSON.stringify(summary))
  return summary
}

/** Copies the database spreadsheet into ALPHA JOURNAL/backup. Runs daily via backupDaily(). */
function backupSpreadsheet() {
  var ss = getSpreadsheet_()
  var folder = getOrCreateFolderPath_([ROOT_FOLDER, BACKUP_FOLDER])
  var stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HHmm')
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(DB_TITLE + ' backup ' + stamp, folder)
  Logger.log('Backup: ' + copy.getName())
  return copy.getId()
}

function seedSettings_(ss) {
  var table = openTable_(ss, 'Settings')
  var have = {}
  table.rows.forEach(function (r) {
    if (r.key) have[r.key] = true
  })
  var now = new Date().toISOString()
  var inserts = []
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (have[key]) return
    var res = validateRow('Settings', {
      id: 'setting-' + key,
      created_at: now,
      updated_at: now,
      key: key,
      value: DEFAULT_SETTINGS[key],
    })
    inserts.push(res.row)
  })
  applyPlan_(table, { inserts: inserts, updates: [], unchanged: [], conflicts: [] })
  return inserts.map(function (r) {
    return r.key
  })
}

function removeDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName()
    var isDefault = name === 'Sheet1' || name === '시트1'
    if (isDefault && sheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet)
  })
}

function getOrCreateFolderPath_(names) {
  var folder = DriveApp.getRootFolder()
  names.forEach(function (name) {
    var it = folder.getFoldersByName(name)
    folder = it.hasNext() ? it.next() : folder.createFolder(name)
  })
  return folder
}

function moveToFolder_(fileId, names) {
  DriveApp.getFileById(fileId).moveTo(getOrCreateFolderPath_(names))
}
