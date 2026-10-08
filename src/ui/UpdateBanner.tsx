import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * "New version" banner. The service worker is in prompt mode, so a new build
 * waits until the user taps 새로고침 — never mid-entry. Checks hourly too,
 * because an installed app can stay open for days.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), CHECK_EVERY_MS)
    },
  })
  if (!needRefresh) return null
  return (
    <div className="update-banner" role="status">
      <span>새 버전이 있습니다. 입력 중인 내용을 저장한 뒤 새로고침하세요.</span>
      <button type="button" className="btn btn-primary btn-small" onClick={() => void updateServiceWorker(true)}>
        새로고침
      </button>
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setNeedRefresh(false)}>
        나중에
      </button>
    </div>
  )
}
