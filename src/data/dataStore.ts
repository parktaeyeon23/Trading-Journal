import { create } from 'zustand'
import { BackendError, type BackendAdapter, type QuoteResult } from './backend'
import { openAppDb } from './db'
import { GasAdapter, type GasConfig } from './gasAdapter'
import { LocalRepo } from './repo'
import { SyncEngine, type SyncStatus } from './sync'

const META_BACKEND = 'backend'

interface DataState {
  ready: boolean
  repo: LocalRepo | null
  engine: SyncEngine | null
  config: GasConfig | null
  status: SyncStatus
  /** Bumped on every local or pulled change, so screens can re-read. */
  version: number
  init: () => Promise<void>
  saveConfig: (cfg: GasConfig | null) => Promise<void>
  /** Live quote through the backend. Throws BackendError('not_setup') when no backend is set. */
  getQuote: (symbol: string, market: 'KR' | 'US') => Promise<QuoteResult>
}

let initPromise: Promise<void> | null = null

export function makeAdapter(cfg: GasConfig | null): BackendAdapter | null {
  return cfg && cfg.url && cfg.secret ? new GasAdapter(cfg) : null
}

export const useData = create<DataState>((set, get) => ({
  ready: false,
  repo: null,
  engine: null,
  config: null,
  status: { state: 'unconfigured', pending: 0, lastSyncAt: null, lastError: null, lastErrorCode: null, conflicts: 0 },
  version: 0,

  init: () => {
    initPromise ??= (async () => {
      const db = await openAppDb()
      const repo = new LocalRepo(db)
      const engine = new SyncEngine(repo, { onStatus: (status) => set({ status: { ...status } }) })
      repo.onChange(() => set((s) => ({ version: s.version + 1 })))
      const config = (await repo.getMeta<GasConfig>(META_BACKEND)) ?? null
      engine.setAdapter(makeAdapter(config))
      set({ repo, engine, config, ready: true })
      engine.start()
    })()
    return initPromise
  },

  saveConfig: async (cfg) => {
    const { repo, engine } = get()
    if (!repo || !engine) return
    const clean = cfg ? { url: cfg.url.trim(), secret: cfg.secret.trim() } : null
    await repo.setMeta(META_BACKEND, clean)
    set({ config: clean })
    engine.setAdapter(makeAdapter(clean))
    if (clean) void engine.syncNow()
  },

  getQuote: async (symbol, market) => {
    const adapter = makeAdapter(get().config)
    if (!adapter) throw new BackendError('not_setup', '설정에서 백엔드를 먼저 연결하세요.')
    const quote = await adapter.getQuote(symbol, market)
    // The server cached the bars; pull them so they are available offline too.
    void get().engine?.syncNow()
    return quote
  },
}))
