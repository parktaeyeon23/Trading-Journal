import { useSyncExternalStore } from 'react'
import { parseHash, type RouteId } from './routes'

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Hash routing keeps GitHub Pages happy (no server rewrites needed). */
export function useRoute(): RouteId {
  return useSyncExternalStore(subscribe, () => parseHash(window.location.hash))
}
