import { useMemo, useSyncExternalStore } from 'react'
import { parseHash, type RouteState } from './routes'

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Hash routing keeps GitHub Pages happy (no server rewrites needed). */
export function useRoute(): RouteState {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return useMemo(() => parseHash(hash), [hash])
}
