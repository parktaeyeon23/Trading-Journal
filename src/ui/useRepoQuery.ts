import { useEffect, useState } from 'react'
import { useData } from '../data/dataStore'
import type { LocalRepo } from '../data/repo'

/**
 * Runs an async read against the local repo and re-runs it whenever local data
 * changes (writes, sync pulls) or a dependency changes. undefined while loading.
 */
export function useRepoQuery<T>(fn: (repo: LocalRepo) => Promise<T>, deps: unknown[]): T | undefined {
  const repo = useData((s) => s.repo)
  const version = useData((s) => s.version)
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    if (!repo) return
    let alive = true
    void fn(repo).then((v) => {
      if (alive) setValue(v)
    })
    return () => {
      alive = false
    }
    // fn is recreated each render; the caller's deps say when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, version, ...deps])
  return value
}
