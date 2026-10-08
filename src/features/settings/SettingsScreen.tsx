import { useEffect, useState } from 'react'
import { BackendError } from '../../data/backend'
import { makeAdapter, useData } from '../../data/dataStore'
import type { ConflictRecord } from '../../data/repo'
import { formatClock, syncLabel } from '../../ui/syncText'
import { BackupCard } from './BackupCard'
import { RulesCard, TagsCard } from './TagsRulesCard'
import { TradingSettingsCard } from './TradingSettingsCard'
import { WeeklyQuestionsCard } from './WeeklyQuestionsCard'

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; message: string } | { kind: 'fail'; message: string }

const ERROR_TEXT: Record<string, string> = {
  unauthorized: 'API Secret이 맞지 않습니다. 스크립트 속성의 API_SECRET 값을 다시 복사하세요.',
  not_setup: '연결은 됐지만 GAS에서 setupSheets()가 아직 실행되지 않았습니다.',
  network: '서버에 닿지 않습니다. 웹앱 URL(…/exec)과 인터넷 연결을 확인하세요.',
  bad_response: '응답이 JSON이 아닙니다. 웹앱 배포의 액세스 권한이 "모든 사용자"인지, URL이 /exec로 끝나는지 확인하세요.',
}

export function SettingsScreen() {
  const { config, status, saveConfig, engine, repo, version } = useData()
  const [url, setUrl] = useState(config?.url ?? '')
  const [secret, setSecret] = useState(config?.secret ?? '')
  const [showSecret, setShowSecret] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saved, setSaved] = useState(false)
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])

  useEffect(() => {
    if (!repo) return
    void repo.listConflicts().then(setConflicts)
  }, [repo, version, status.conflicts])

  const dirty = url.trim() !== (config?.url ?? '') || secret.trim() !== (config?.secret ?? '')
  const urlLooksRight = url.trim() === '' || /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url.trim())

  async function runTest() {
    const adapter = makeAdapter({ url: url.trim(), secret: secret.trim() })
    if (!adapter) return
    setTest({ kind: 'testing' })
    try {
      const r = await adapter.ping()
      setTest({ kind: 'ok', message: `연결됨 · 서버 시각 ${formatClock(r.serverTime)} · 스키마 v${r.schemaVersion}` })
    } catch (err) {
      const code = err instanceof BackendError ? err.code : 'internal'
      setTest({ kind: 'fail', message: ERROR_TEXT[code] ?? (err as Error).message })
    }
  }

  async function save() {
    await saveConfig(url.trim() || secret.trim() ? { url, secret } : null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      <h1 className="page-title">설정</h1>

      <section className="card stack" aria-labelledby="backend-title">
        <div>
          <h2 id="backend-title" className="section-title">
            백엔드 연결
          </h2>
          <p className="help">Apps Script 웹앱 URL과 API Secret을 넣으세요. 두 값은 이 기기에만 저장되고 다른 곳으로 보내지지 않습니다.</p>
        </div>

        <label className="field">
          <span className="field-label">웹앱 URL</span>
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://script.google.com/macros/s/…/exec"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!urlLooksRight}
          />
          {!urlLooksRight && <span className="field-error">…/macros/s/…/exec 형태여야 합니다. 배포 → 배포 관리에서 웹 앱 URL을 복사하세요.</span>}
        </label>

        <label className="field">
          <span className="field-label">API Secret</span>
          <span className="input-group">
            <input
              className="input num"
              type={showSecret ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="스크립트 속성의 API_SECRET 값"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <button type="button" className="btn btn-secondary" onClick={() => setShowSecret((v) => !v)} aria-pressed={showSecret}>
              {showSecret ? '숨기기' : '보기'}
            </button>
          </span>
        </label>

        <div className="row wrap">
          <button type="button" className="btn btn-secondary" onClick={runTest} disabled={!url.trim() || !secret.trim() || test.kind === 'testing'}>
            {test.kind === 'testing' ? '확인 중…' : '연결 테스트'}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || !urlLooksRight}>
            저장
          </button>
          {saved && <span className="help" role="status">저장했습니다</span>}
        </div>
        {test.kind === 'ok' && (
          <p className="notice notice-good" role="status">
            {test.message}
          </p>
        )}
        {test.kind === 'fail' && (
          <p className="notice notice-bad" role="alert">
            {test.message}
          </p>
        )}
      </section>

      <TradingSettingsCard />
      <TagsCard />
      <RulesCard />
      <WeeklyQuestionsCard />

      <section className="card stack" aria-labelledby="sync-title">
        <h2 id="sync-title" className="section-title">
          동기화
        </h2>
        <dl className="kv">
          <dt>상태</dt>
          <dd>{syncLabel(status)}</dd>
          <dt>보내지 않은 변경</dt>
          <dd className="num">{status.pending}건</dd>
          <dt>마지막 동기화</dt>
          <dd className="num">{formatClock(status.lastSyncAt)}</dd>
        </dl>
        {status.lastError && (
          <p className="notice notice-bad" role="alert">
            {status.lastError}
          </p>
        )}
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={() => void engine?.syncNow()} disabled={!config || status.state === 'syncing'}>
            지금 동기화
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!config || status.state === 'syncing'}
            onClick={async () => {
              await engine?.resetCheckpoint()
              await engine?.syncNow()
            }}
          >
            전체 다시 받기
          </button>
        </div>
        <p className="help">변경은 저장 1.5초 뒤, 온라인으로 돌아올 때, 그리고 5분마다 자동으로 동기화됩니다.</p>
      </section>

      <BackupCard />

      <section className="card stack" aria-labelledby="conflict-title">
        <div className="row">
          <h2 id="conflict-title" className="section-title">
            충돌·거부 기록
          </h2>
          {conflicts.some((c) => c.kind === 'rejected') && (
            <button
              type="button"
              className="btn btn-secondary push-right"
              onClick={async () => {
                await repo?.resendRejected()
                setConflicts(conflicts.filter((c) => c.kind !== 'rejected'))
                void engine?.syncNow()
              }}
            >
              거부된 행 다시 보내기
            </button>
          )}
          {conflicts.length > 0 && (
            <button
              type="button"
              className={`btn btn-secondary${conflicts.some((c) => c.kind === 'rejected') ? '' : ' push-right'}`}
              onClick={async () => {
                await repo?.clearConflicts()
                setConflicts([])
                void engine?.syncNow()
              }}
            >
              기록 지우기
            </button>
          )}
        </div>
        {conflicts.length === 0 ? (
          <p className="help">없음. 두 기기에서 같은 기록을 고쳤을 때 진 쪽의 내용이 여기에 남습니다.</p>
        ) : (
          <ul className="log">
            {conflicts.map((c) => (
              <li key={c.seq}>
                <span className={`chip ${c.kind === 'rejected' ? 'chip-bad' : ''}`}>{c.kind === 'rejected' ? '거부됨' : '충돌'}</span>
                <span>
                  {c.entity} <span className="num faint">{c.id?.slice(0, 8)}</span>
                </span>
                <span className="faint num">{formatClock(c.at)}</span>
                {c.errors && <span className="log-detail">{c.errors.map((e) => `${e.field}: ${e.code}`).join(', ')}</span>}
                {c.kind === 'conflict' && <span className="log-detail">다른 기기의 더 최신 내용이 적용됐습니다. 이 기기에서 쓴 내용은 기록으로만 남았습니다.</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
