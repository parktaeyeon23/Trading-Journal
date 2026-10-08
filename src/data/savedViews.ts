/** Named filter combinations for the analysis tab, kept in Settings (synced). */
import type { LocalRepo } from './repo'
import { readSetting, writeSetting } from './settings'

export const SAVED_VIEWS_KEY = 'saved_views'

export interface SavedView {
  name: string
  /** Shared filters (market, setup, tags, grade, result) + the period kind. */
  filters: Record<string, unknown>
}

export async function readSavedViews(repo: LocalRepo): Promise<SavedView[]> {
  const v = await readSetting<unknown>(repo, SAVED_VIEWS_KEY, [])
  return Array.isArray(v) ? (v as SavedView[]).filter((x) => x && typeof x.name === 'string' && x.filters && typeof x.filters === 'object') : []
}

/** Saves (or replaces, by name) a view. */
export async function saveView(repo: LocalRepo, view: SavedView): Promise<void> {
  const list = (await readSavedViews(repo)).filter((v) => v.name !== view.name)
  await writeSetting(repo, SAVED_VIEWS_KEY, [...list, view].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
}

export async function deleteView(repo: LocalRepo, name: string): Promise<void> {
  await writeSetting(repo, SAVED_VIEWS_KEY, (await readSavedViews(repo)).filter((v) => v.name !== name))
}
