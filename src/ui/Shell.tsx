import type { ReactNode } from 'react'
import { ROUTES, hrefFor, type RouteId } from './routes'

interface ShellProps {
  current: RouteId
  /** Count of closed positions waiting for review — shown on the 트레이드 tab. */
  reviewPending: number
  children: ReactNode
}

export function Shell({ current, reviewPending, children }: ShellProps) {
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
          <a
            key={id}
            className="nav-item"
            href={hrefFor(id)}
            aria-current={id === current ? 'page' : undefined}
          >
            <Icon />
            {label}
            {id === 'trades' && reviewPending > 0 && (
              <span className="badge-alert">복기 {reviewPending}</span>
            )}
          </a>
        ))}
        <div className="sidebar-foot">로컬 전용 · 동기화 미설정</div>
      </nav>

      <main className="main">{children}</main>

      <nav className="tabbar" aria-label="하단 탭">
        {ROUTES.map(({ id, label, Icon }) => (
          <a
            key={id}
            className="tab-item"
            href={hrefFor(id)}
            aria-current={id === current ? 'page' : undefined}
          >
            <Icon size={20} />
            {label}
            {id === 'trades' && reviewPending > 0 && (
              <span className="tab-dot" aria-label={`복기 대기 ${reviewPending}건`}>
                {reviewPending}
              </span>
            )}
          </a>
        ))}
      </nav>
    </div>
  )
}
