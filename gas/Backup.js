/**
 * Daily backups of the database spreadsheet.
 * Run installBackupTrigger() once from the editor; it schedules backupDaily()
 * every day around 03:00 Asia/Seoul (the project time zone).
 */

var BACKUP_FOLDER = 'backup'
var BACKUP_KEEP_DAYS = 30
var BACKUP_HOUR = 3

/** Trigger target: copy the database, then trash old copies. */
function backupDaily() {
  backupSpreadsheet()
  return pruneBackups_()
}

/**
 * Creates the daily trigger. Safe to run again: it removes any earlier
 * backupDaily trigger first, so there is always exactly one.
 */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDaily') ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('backupDaily').timeBased().everyDays(1).atHour(BACKUP_HOUR).create()
  Logger.log('매일 ' + BACKUP_HOUR + '시 무렵 백업이 예약됐습니다.')
}

/** Moves backups that are past their keep window to the Drive trash (never permanently deletes). */
function pruneBackups_() {
  var folder = getOrCreateFolderPath_([ROOT_FOLDER, BACKUP_FOLDER])
  var files = []
  var byId = {}
  var it = folder.getFiles()
  while (it.hasNext()) {
    var f = it.next()
    files.push({ id: f.getId(), created: f.getDateCreated().getTime() })
    byId[f.getId()] = f
  }
  var trash = selectBackupsToTrash(files, Date.now(), BACKUP_KEEP_DAYS)
  trash.forEach(function (id) {
    byId[id].setTrashed(true)
  })
  Logger.log('Old backups trashed: ' + trash.length)
  return trash.length
}

/**
 * Pure: which backups to drop. Keeps every copy younger than keepDays, and for
 * older months keeps the last copy of each month (Asia/Seoul calendar), so a
 * month-end snapshot survives forever.
 * @param {Array<{id: string, created: number}>} files  created = epoch ms
 * @return {string[]} ids to trash
 */
function selectBackupsToTrash(files, nowMs, keepDays) {
  var cutoff = nowMs - keepDays * 24 * 3600 * 1000
  var lastInMonth = {}
  files.forEach(function (f) {
    var key = kstMonthKey_(f.created)
    if (!lastInMonth[key] || f.created > lastInMonth[key].created) lastInMonth[key] = f
  })
  return files
    .filter(function (f) {
      if (f.created >= cutoff) return false
      return lastInMonth[kstMonthKey_(f.created)].id !== f.id
    })
    .map(function (f) {
      return f.id
    })
}

function kstMonthKey_(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 7)
}
