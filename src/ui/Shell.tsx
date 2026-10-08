import type { ReactNode } from 'react'
import { SettingsIcon } from './icons'
import { ROUTES, hrefFor, type RouteId } from './routes'
import { SyncBadge } from './SyncBadge'

interface ShellProps {
  current: RouteId
  /** Count of closed positions waiting for review — shown on the 트레이드 tab. */
  reviewPending: number
  /** Closed trades past 10 trading days without a ④ post-trade chart. */
  postDue: number
  children: ReactNode
}

/** Tab dots are small: past 99 they read 99+. */
const cap = (n: number) => (n > 99 ? '99+' : String(n))

export function Shell({ current, reviewPending, postDue, children }: ShellProps) {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="주 메뉴">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            α
          </div>
          <div className="brand-name">ALPHA JOURNAL</div>
        </div>
        {ROUTES.map(({ id, label, Icon }) => (
          <a key={id} className="nav-item" href={hrefFor(id)} aria-current={id === current ? 'page' : undefined}>
            <Icon />
            {label}
            {id === 'trades' && (reviewPending > 0 || postDue > 0) && (
              <span className="badges">
                {reviewPending > 0 && <span className="badge-alert">복기 {reviewPending}</span>}
                {postDue > 0 && (
                  <span className="badge-warn" title="청산 후 10거래일이 지나 사후 복기 차트가 필요한 트레이드">
                    사후 {postDue}
                  </span>
                )}
              </span>
            )}
          </a>
        ))}
        <div className="sidebar-foot">
          <SyncBadge />
          <a className="nav-item" href={hrefFor('settings')} aria-current={current === 'settings' ? 'page' : undefined}>
            <SettingsIcon />
            설정
          </a>
        </div>
      </nav>

      <div className="content">
        <header className="mobile-top">
          <div className="brand-mark small" aria-hidden="true">
            α
          </div>
          <span className="brand-name">ALPHA JOURNAL</span>
          <SyncBadge compact />
          <a className="icon-btn" href={hrefFor('settings')} aria-label="설정" aria-current={current === 'settings' ? 'page' : undefined}>
            <SettingsIcon size={20} />
          </a>
        </header>
        <main className="main">{children}</main>
      </div>

      <nav className="tabbar" aria-label="하단 탭">
        {ROUTES.map(({ id, label, Icon }) => (
          <a key={id} className="tab-item" href={hrefFor(id)} aria-current={id === current ? 'page' : undefined}>
            <Icon size={20} />
            {label}
            {id === 'trades' && reviewPending > 0 && (
              <span className="tab-dot" aria-label={`복기 대기 ${reviewPending}건`}>
                {cap(reviewPending)}
              </span>
            )}
            {id === 'trades' && reviewPending === 0 && postDue > 0 && (
              <span className="tab-dot warn" aria-label={`사후 차트 필요 ${postDue}건`}>
                {cap(postDue)}
              </span>
            )}
          </a>
        ))}
      </nav>
    </div>
  )
}
