import { useEffect, useState } from 'react'
import { useData } from '../data/dataStore'
import type { LocalRepo } from '../data/repo'

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

/**
 * Runs an async read against the local repo and re-runs it whenever local data
 * changes (writes, sync pulls) or a dependency changes. undefined while loading.
 * A result read for other dependencies (say, the previous day) is never
 * returned for the new ones; a data change keeps showing the last result until
 * the fresh one lands, so screens don't flicker on every write.
 */
export function useRepoQuery<T>(fn: (repo: LocalRepo) => Promise<T>, deps: unknown[]): T | undefined {
  const repo = useData((s) => s.repo)
  const version = useData((s) => s.version)
  const [state, setState] = useState<{ deps: unknown[]; value: T } | undefined>(undefined)
  useEffect(() => {
    if (!repo) return
    let alive = true
    const forDeps = deps
    void fn(repo).then((value) => {
      if (alive) setState({ deps: forDeps, value })
    })
    return () => {
      alive = false
    }
    // fn is recreated each render; the caller's deps say when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, version, ...deps])
  return state && sameDeps(state.deps, deps) ? state.value : undefined
}
