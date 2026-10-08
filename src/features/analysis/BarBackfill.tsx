import { useState } from 'react'
import { backfillBars, pendingWindows } from '../../data/barBackfill'
import { useData } from '../../data/dataStore'
import type { TradeBundle } from '../../data/trades'
import { useRepoQuery } from '../../ui/useRepoQuery'

/**
 * Daily bars for MFE/MAE come from the backend one symbol window at a time.
 * Shows how many are missing and fetches them on request.
 */
export function BarBackfill({ bundles }: { bundles: TradeBundle[] }) {
  const repo = useData((s) => s.repo)
  const engine = useData((s) => s.engine)
  const configured = useData((s) => !!s.config)
  const getBars = useData((s) => s.getBars)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const windows = useRepoQuery((r) => pendingWindows(r, bundles), [bundles])

  if (!windows || (!windows.length && !message)) return null

  async function run() {
    if (!repo || !windows) return
    setMessage(null)
    setProgress({ done: 0, total: windows.length })
    const res = await backfillBars(repo, getBars, windows, (done, total) => setProgress({ done, total }))
    setProgress(null)
    await engine?.syncNow()
    setMessage(
      res.stopped
        ? `중간에 멈췄습니다: ${res.stopped} (${res.fetched}개 받음)`
        : `${res.fetched}개 구간을 받았습니다${res.notFound ? `, ${res.notFound}개는 시세를 찾지 못했습니다` : ''}.`,
    )
  }

  return (
    <div className="backfill">
      {windows.length > 0 && (
        <p className="help" style={{ margin: 0 }}>
          일봉이 없는 종목 구간 {windows.length}개 — MFE·MAE에서 빠져 있습니다.
        </p>
      )}
      {progress ? (
        <p className="help" role="status" style={{ margin: 0 }}>
          일봉 받는 중 {progress.done}/{progress.total}…
        </p>
      ) : (
        windows.length > 0 &&
        (configured ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void run()}>
            일봉 받기
          </button>
        ) : (
          <p className="help" style={{ margin: 0 }}>
            설정에서 백엔드를 연결하면 받을 수 있습니다.
          </p>
        ))
      )}
      {message && (
        <p className="help" role="status" style={{ margin: 0 }}>
          {message}
        </p>
      )}
    </div>
  )
}
