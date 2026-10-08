/**
 * In-editor API tests. Run testApi_all() from the Apps Script editor.
 * They run against a throwaway spreadsheet and restore the real one after,
 * so the live database is never touched.
 */

function testApi_all() {
  var props = PropertiesService.getScriptProperties()
  var realId = props.getProperty('SPREADSHEET_ID')
  var realSecret = props.getProperty('API_SECRET')
  var temp = SpreadsheetApp.create('ALPHA JOURNAL test ' + new Date().toISOString())
  props.setProperty('SPREADSHEET_ID', temp.getId())
  props.setProperty('API_SECRET', 'test-secret')
  var results = []
  try {
    ;[testApi_setupIsIdempotent, testApi_roundTrip, testApi_rejectsBadSecret, testApi_rejectsBrokenRef, testApi_conflictOnOlderUpdate, testApi_softDelete, testApi_batchOrder].forEach(function (fn) {
      try {
        fn()
        results.push('PASS ' + fn.name)
      } catch (e) {
        results.push('FAIL ' + fn.name + ': ' + e.message)
      }
    })
  } finally {
    if (realId) props.setProperty('SPREADSHEET_ID', realId)
    else props.deleteProperty('SPREADSHEET_ID')
    if (realSecret) props.setProperty('API_SECRET', realSecret)
    else props.deleteProperty('API_SECRET')
    DriveApp.getFileById(temp.getId()).setTrashed(true)
  }
  Logger.log(results.join('\n'))
  if (results.some(function (r) { return r.indexOf('FAIL') === 0 })) throw new Error('Some API tests failed — see log.')
}

function testApi_setupIsIdempotent() {
  setupSheets()
  var second = setupSheets()
  assert_(second.createdSheets.length === 0, 'second run created sheets')
  assert_(Object.keys(second.addedColumns).length === 0, 'second run added columns')
  assert_(second.addedSettings.length === 0, 'second run added settings')
}

function testApi_roundTrip() {
  var t = '2026-10-01T00:00:00.000Z'
  var res = call_({ action: 'upsert', entity: 'Positions', rows: [testPosition_('rt-p1', t)] })
  assert_(res.ok && res.results[0].inserted === 1, 'insert failed: ' + JSON.stringify(res))
  var pulled = call_({ action: 'pullAll' })
  var p = pulled.data.Positions.filter(function (r) { return r.id === 'rt-p1' })[0]
  assert_(p && p.ticker === '042700', 'ticker lost leading zeros or row missing: ' + JSON.stringify(p))
  var later = call_({ action: 'pullAll', since: t })
  assert_(later.data.Positions.length === 0, 'since filter returned an unchanged row')
}

function testApi_rejectsBadSecret() {
  var res = handleRequest({ secret: 'wrong', action: 'ping' })
  assert_(!res.ok && res.error.code === 'unauthorized', 'bad secret accepted')
}

function testApi_rejectsBrokenRef() {
  var res = call_({ action: 'upsert', entity: 'Fills', rows: [testFill_('bf-f1', 'no-such-position', '2026-10-01T00:00:00Z')] })
  var r = res.results[0]
  assert_(r.inserted === 0 && r.rejected.length === 1 && r.rejected[0].errors[0].code === 'ref_missing', 'broken ref accepted')
}

function testApi_conflictOnOlderUpdate() {
  call_({ action: 'upsert', entity: 'Positions', rows: [testPosition_('cf-p1', '2026-10-05T00:00:00Z')] })
  var res = call_({ action: 'upsert', entity: 'Positions', rows: [testPosition_('cf-p1', '2026-10-04T00:00:00Z')] })
  var r = res.results[0]
  assert_(r.updated === 0 && r.conflicts.length === 1, 'older update not reported as conflict')
}

function testApi_softDelete() {
  call_({ action: 'upsert', entity: 'Positions', rows: [testPosition_('sd-p1', '2026-10-01T00:00:00Z')] })
  var res = call_({ action: 'softDelete', entity: 'Positions', ids: ['sd-p1', 'missing'] })
  assert_(res.results[0].deleted === 1 && res.results[0].notFound[0] === 'missing', 'softDelete counts wrong')
}

function testApi_batchOrder() {
  var res = call_({
    action: 'batch',
    ops: [
      { op: 'upsert', entity: 'Positions', rows: [testPosition_('bo-p1', '2026-10-01T00:00:00Z')] },
      { op: 'upsert', entity: 'Fills', rows: [testFill_('bo-f1', 'bo-p1', '2026-10-01T00:00:00Z')] },
    ],
  })
  assert_(res.results[1].inserted === 1, 'fill in same batch could not see its position')
}

function call_(req) {
  req.secret = 'test-secret'
  return handleRequest(req)
}

function testPosition_(id, t) {
  return { id: id, created_at: '2026-10-01T00:00:00Z', updated_at: t, ticker: '042700', market: 'KR', direction: 'long', status: 'open' }
}

function testFill_(id, positionId, t) {
  return { id: id, created_at: t, updated_at: t, position_id: positionId, ts: t, side: 'buy', price: 98500, qty: 10 }
}

function assert_(cond, msg) {
  if (!cond) throw new Error(msg)
}
