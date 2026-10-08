import { useRef, useState } from 'react'
import { buildDump, dumpFileName, DumpError, FILL_CSV_COLUMNS, parseDump, POSITION_CSV_COLUMNS, toCsv } from '../../data/backup'
import { useData } from '../../data/dataStore'
import { downloadText } from '../../ui/download'

type Notice = { kind: 'good' | 'bad'; text: string } | null

export function BackupCard() {
  const { repo, engine, status } = useData()
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  async function exportJson() {
    if (!repo) return
    const now = new Date()
    const dump = buildDump(await repo.exportAll(), now.toISOString())
    downloadText(dumpFileName(now), JSON.stringify(dump, null, 2), 'application/json')
    const total = Object.values(dump.counts).reduce((a, b) => a + (b ?? 0), 0)
    setNotice({ kind: 'good', text: `${total.toLocaleString()}건을 내보냈습니다.` })
  }

  async function exportCsv() {
    if (!repo) return
    const now = new Date()
    const data = await repo.exportAll()
    downloadText(dumpFileName(now, 'positions.csv'), toCsv(data.Positions ?? [], POSITION_CSV_COLUMNS), 'text/csv')
    downloadText(dumpFileName(now, 'fills.csv'), toCsv(data.Fills ?? [], FILL_CSV_COLUMNS), 'text/csv')
    setNotice({ kind: 'good', text: '포지션·체결 CSV 2개를 내보냈습니다.' })
  }

  async function restore(file: File) {
    if (!repo || !engine) return
    setNotice(null)
    let dump
    try {
      dump = parseDump(await file.text())
    } catch (err) {
      setNotice({ kind: 'bad', text: err instanceof DumpError ? err.message : '파일을 읽지 못했습니다.' })
      return
    }
    const when = new Date(dump.exportedAt).toLocaleString('ko-KR')
    const pending = status.pending
    const first = window.confirm(
      `${when}에 내보낸 파일로 이 기기의 데이터를 바꿉니다.\n` +
        `포지션 ${dump.counts.Positions ?? 0}건 · 체결 ${dump.counts.Fills ?? 0}건\n` +
        (pending > 0 ? `아직 보내지 않은 변경 ${pending}건은 사라집니다.\n` : '') +
        '서버에 이 파일보다 더 최신인 기록이 있으면 서버 쪽이 유지됩니다.\n\n계속할까요?',
    )
    if (!first || !window.confirm('정말 복원할까요? 이 기기의 현재 데이터는 되돌릴 수 없습니다.')) return
    setBusy(true)
    try {
      const n = await repo.importAll(dump.data)
      await engine.resetCheckpoint()
      void engine.syncNow()
      setNotice({ kind: 'good', text: `${n.toLocaleString()}건을 복원했습니다. 서버와 동기화합니다.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack" aria-labelledby="backup-title">
      <div>
        <h2 id="backup-title" className="section-title">
          데이터 백업
        </h2>
        <p className="help">
          서버(Google Drive)에는 매일 새벽 자동 백업이 쌓입니다. 여기서는 이 기기의 데이터를 파일로 받거나, 받은 파일로 되돌릴 수 있습니다. 차트 이미지는 Drive에 그대로 있고 파일에는 링크 정보만 들어갑니다.
        </p>
      </div>
      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={exportJson} disabled={!repo || busy}>
          전체 내보내기 (JSON)
        </button>
        <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!repo || busy}>
          포지션·체결 CSV
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={!repo || busy}>
          {busy ? '복원 중…' : 'JSON에서 복원'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void restore(f)
          }}
        />
      </div>
      {notice && (
        <p className={`notice ${notice.kind === 'good' ? 'notice-good' : 'notice-bad'}`} role={notice.kind === 'bad' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
    </section>
  )
}
