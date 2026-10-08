/**
 * Chart images. The app sends a resized image (and its thumbnail) as base64;
 * the server stores both in Drive under ALPHA JOURNAL/charts/YYYY/MM/, shares
 * them "anyone with the link can view" so the app can show thumbnails, and
 * writes the ChartImages row. Only the Drive file ids go into the sheet.
 *
 * Request: { action: "uploadImage", id, position_id, slot, sort?, mime,
 *            data: <base64>, thumb: <base64>, created_at, updated_at }
 * Response: { ok, row }  — the stored ChartImages row.
 */

var CHART_FOLDER = 'charts'
var IMAGE_MIMES = ['image/webp', 'image/jpeg', 'image/png']
var MAX_IMAGE_BYTES = 15 * 1024 * 1024

function uploadImage_(req) {
  if (!req || typeof req.id !== 'string' || !req.id) throw apiError_('bad_request', 'id is required.')
  if (IMAGE_MIMES.indexOf(req.mime) < 0) throw apiError_('bad_request', 'mime must be one of ' + IMAGE_MIMES.join(', '))
  if (typeof req.data !== 'string' || !req.data) throw apiError_('bad_request', 'data is required.')

  return withLock_(function () {
    var ss = getSpreadsheet_()
    var table = openTable_(ss, 'ChartImages')

    // A retry after a timeout must not create a second copy.
    if (req.id in table.index) {
      var already = rowAt_(table, req.id)
      if (already.file_id) return { ok: true, row: already, duplicate: true }
    }

    var check = validateRow('ChartImages', {
      id: req.id,
      created_at: req.created_at,
      updated_at: req.updated_at,
      position_id: req.position_id,
      slot: req.slot,
      sort: req.sort == null ? null : req.sort,
      file_id: 'pending',
    })
    if (!check.ok) throw apiError_('bad_request', JSON.stringify(check.errors))
    if (!(check.row.position_id in openTable_(ss, 'Positions').index)) throw apiError_('bad_request', 'position_id does not exist.')

    var bytes = Utilities.base64Decode(req.data)
    if (bytes.length > MAX_IMAGE_BYTES) throw apiError_('too_large', '이미지가 너무 큽니다 (15MB 초과).')
    var thumbBytes = req.thumb ? Utilities.base64Decode(req.thumb) : null

    var now = new Date()
    var folder = getOrCreateFolderPath_([ROOT_FOLDER, CHART_FOLDER, Utilities.formatDate(now, 'Asia/Seoul', 'yyyy'), Utilities.formatDate(now, 'Asia/Seoul', 'MM')])
    var ext = req.mime.split('/')[1].replace('jpeg', 'jpg')
    var base = check.row.position_id.slice(0, 8) + '_' + check.row.slot + '_' + req.id.slice(0, 8)
    var file = saveShared_(folder, bytes, req.mime, base + '.' + ext)
    var thumb = thumbBytes ? saveShared_(folder, thumbBytes, req.mime, base + '_thumb.' + ext) : null

    var row = check.row
    row.file_id = file.getId()
    row.thumb_file_id = thumb ? thumb.getId() : null
    row.synced_at = nowIso_()
    var existing = {}
    if (req.id in table.index) existing[req.id] = rowAt_(table, req.id)
    var plan = planUpsert(existing, [row])
    // A pending row the client re-sent with the same updated_at still needs its file ids.
    if (plan.unchanged.length) plan.updates.push(row)
    applyPlan_(table, plan)
    return { ok: true, row: rowAt_(openTable_(ss, 'ChartImages'), req.id) }
  })
}

function saveShared_(folder, bytes, mime, name) {
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name))
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
  return file
}

/**
 * Called from upsert_ when ChartImages rows change: an image the app marked
 * deleted goes to the Drive trash (never permanently deleted).
 */
function trashDeletedCharts_(existing, updates) {
  updates.forEach(function (row) {
    var before = existing[row.id]
    if (row.deleted !== true || !before || before.deleted === true) return
    ;[before.file_id, before.thumb_file_id].forEach(function (fid) {
      if (!fid || fid === 'pending') return
      try {
        DriveApp.getFileById(fid).setTrashed(true)
      } catch (e) {
        Logger.log('Could not trash ' + fid + ': ' + e)
      }
    })
  })
}
