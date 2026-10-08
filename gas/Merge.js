/**
 * Last-write-wins merge by updated_at. Pure function.
 *
 * @param {Object<string, Object>} existing  id → stored row (API values)
 * @param {Object[]} incoming  validated rows
 * @return {{ inserts: Object[], updates: Object[], unchanged: string[], conflicts: Object[] }}
 *   conflicts: [{ id, server: <stored row> }] — the incoming row was older than the server's.
 */
function planUpsert(existing, incoming) {
  var plan = { inserts: [], updates: [], unchanged: [], conflicts: [] }
  var seen = {}
  incoming.forEach(function (row) {
    // Within one batch the last occurrence of an id wins.
    seen[row.id] = row
  })
  Object.keys(seen).forEach(function (id) {
    var row = seen[id]
    var cur = existing[id]
    if (!cur) {
      plan.inserts.push(row)
    } else if (row.updated_at > cur.updated_at) {
      var merged = {}
      Object.keys(row).forEach(function (k) {
        merged[k] = row[k]
      })
      merged.created_at = cur.created_at || row.created_at
      plan.updates.push(merged)
    } else if (row.updated_at === cur.updated_at) {
      plan.unchanged.push(id)
    } else {
      plan.conflicts.push({ id: id, server: cur })
    }
  })
  return plan
}
