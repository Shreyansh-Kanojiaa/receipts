import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { countUp } from './animations'

// ── design tokens ─────────────────────────────────────────────────────────────
const MONO = 'var(--mono)'
const SANS = 'var(--sans)'
const GREEN  = 'var(--green)'
const RED    = 'var(--red)'
const AMBER  = 'var(--amber)'
const BLUE   = 'var(--blue)'
const TEXT   = 'var(--text)'
const MUTED  = 'var(--text-muted)'
const DIM    = 'var(--text-dim)'
const BG     = 'var(--bg)'
const SURF   = 'var(--surface)'
const SURF2  = 'var(--surface-2)'
const BORDER = 'var(--border)'
const BORDER2= 'var(--border-2)'

// ── API access ────────────────────────────────────────────────────────────────
// In production the SPA is served behind nginx, which proxies these paths and
// injects the viewer Authorization header — so API_BASE stays empty (same-origin)
// and no key ships in the bundle. In dev, set VITE_BACKEND_URL / VITE_RECEIPTS_VIEWER_KEY.
const API_BASE = import.meta.env.VITE_BACKEND_URL || ''
const VIEWER_KEY = import.meta.env.VITE_RECEIPTS_VIEWER_KEY || ''

function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (VIEWER_KEY) headers['Authorization'] = `Bearer ${VIEWER_KEY}`
  return fetch(API_BASE + path, { ...opts, headers })
}

// ── tiny shared helpers ───────────────────────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2,'0')
  const mm = String(d.getMinutes()).padStart(2,'0')
  const ss = String(d.getSeconds()).padStart(2,'0')
  const ms = String(d.getMilliseconds()).padStart(3,'0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function truncHex(s, n=10) {
  if (!s) return '—'
  return '0x' + s.slice(0, n) + '...'
}

function verdictColor(v) {
  if (v === 'VERIFIED')     return GREEN
  if (v === 'CONTRADICTED') return AMBER
  if (v === 'TAMPERED')     return RED
  return RED // UNVERIFIED
}

function Pill({ color, bg, children, animate }) {
  return (
    <span className={animate ? 'pill-animate' : ''} style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 3,
      fontSize: 11,
      fontFamily: MONO,
      fontWeight: 500,
      letterSpacing: '0.05em',
      border: `1px solid ${color}`,
      color,
      background: bg ?? 'transparent',
    }}>
      {children}
    </span>
  )
}

function Dot({ color }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 6, height: 6,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  )
}

// ── JSON tokenizer: keys blue, string values green, numbers/booleans/null amber ─
function _tokenizeJsonLine(line, i) {
  const parts = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:\s*)?("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)?/g
  let last = 0, m
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={`t${i}-${last}`}>{line.slice(last, m.index)}</span>)
    if (m[2]) {
      parts.push(<span key={`k${i}-${m.index}`} style={{ color: '#60a5fa' }}>{m[1]}</span>)
      parts.push(<span key={`c${i}-${m.index}`}>{m[2]}</span>)
      if (m[3] !== undefined) {
        const isStr = m[3].startsWith('"')
        const isNum = !isStr && m[3] !== 'true' && m[3] !== 'false' && m[3] !== 'null'
        const col = isStr ? '#4ade80' : isNum ? '#fbbf24' : MUTED
        parts.push(<span key={`v${i}-${m.index}`} style={{ color: col }}>{m[3]}</span>)
      }
    } else {
      parts.push(<span key={`s${i}-${m.index}`} style={{ color: '#4ade80' }}>{m[1]}</span>)
    }
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(<span key={`e${i}-${last}`}>{line.slice(last)}</span>)
  return <div key={i}>{parts.length ? parts : line}</div>
}

// ── syntax-highlight JSON (keys blue, strings green, numbers amber) ───────────
function JsonHighlight({ obj }) {
  const lines = JSON.stringify(obj, null, 2).split('\n').map(_tokenizeJsonLine)
  return (
    <pre style={{
      margin: 0, padding: '10px 12px',
      background: '#0d0d0d',
      border: `1px solid ${BORDER}`,
      borderRadius: 3,
      fontSize: 11,
      fontFamily: MONO,
      lineHeight: 1.6,
      overflowX: 'auto',
      color: TEXT,
    }}>
      {lines}
    </pre>
  )
}

// ── sidebar ───────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'ledger',         label: 'LIVE_LEDGER',     symbol: '≡' },
  { id: 'sessions',       label: 'SESSIONS',         symbol: '◎' },
  { id: 'reconciliation', label: 'RECONCILIATION',   symbol: '⊕' },
  { id: 'alerts',         label: 'ALERTS',           symbol: '◉' },
  { id: 'help',           label: 'HELP',             symbol: '?' },
  { id: 'settings',       label: 'SETTINGS',         symbol: '⊙' },
]

const SIDEBAR_W     = 220
const SIDEBAR_W_COL = 48

function Sidebar({ view, setView, proxyOnline, onReport, collapsed, onToggle }) {
  const w = collapsed ? SIDEBAR_W_COL : SIDEBAR_W
  return (
    <aside style={{
      width: w,
      flexShrink: 0,
      background: SURF,
      borderRight: `1px solid ${BORDER}`,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'fixed',
      top: 0, left: 0,
      zIndex: 20,
      transition: 'width 0.18s ease',
      overflow: 'hidden',
    }}>
      {/* wordmark + toggle */}
      <div style={{
        padding: collapsed ? '18px 0' : '20px 18px 16px',
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex',
        alignItems: collapsed ? 'center' : 'flex-start',
        flexDirection: collapsed ? 'column' : 'row',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: collapsed ? 8 : 0,
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: TEXT, marginBottom: 3 }}>
              RECEIPTS
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Dot color={proxyOnline ? GREEN : RED} />
              <span style={{ fontFamily: MONO, fontSize: 9, color: proxyOnline ? GREEN : RED, letterSpacing: '0.1em' }}>
                {proxyOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        )}
        {collapsed && <Dot color={proxyOnline ? GREEN : RED} />}
        {/* collapse / expand toggle */}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'transparent',
            border: `1px solid ${BORDER}`,
            borderRadius: 2,
            color: DIM,
            fontFamily: MONO,
            fontSize: 11,
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.color = TEXT; e.currentTarget.style.borderColor = BLUE }}
          onMouseLeave={e => { e.currentTarget.style.color = DIM; e.currentTarget.style.borderColor = BORDER }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, padding: '10px 0' }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={collapsed ? item.label : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              width: '100%',
              padding: collapsed ? '9px 0' : '8px 18px',
              background: view === item.id ? SURF2 : 'transparent',
              border: 'none',
              borderLeft: view === item.id ? `2px solid ${BLUE}` : '2px solid transparent',
              color: view === item.id ? TEXT : DIM,
              fontFamily: MONO,
              fontSize: collapsed ? 14 : 11,
              letterSpacing: collapsed ? 0 : '0.06em',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {collapsed ? item.symbol : item.label}
          </button>
        ))}
      </nav>

      {/* generate report */}
      <div style={{ padding: collapsed ? '12px 8px' : '12px 14px', borderTop: `1px solid ${BORDER}` }}>
        <button
          onClick={onReport}
          title={collapsed ? 'GEN_REPORT' : undefined}
          style={{
            width: '100%',
            padding: collapsed ? '7px 0' : '7px 12px',
            background: 'transparent',
            border: `1px solid ${BORDER2}`,
            borderRadius: 2,
            color: DIM,
            fontFamily: MONO,
            fontSize: collapsed ? 13 : 10,
            letterSpacing: collapsed ? 0 : '0.1em',
            cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
            textAlign: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.color = TEXT }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER2; e.currentTarget.style.color = DIM }}
        >
          {collapsed ? '↓' : 'GEN_REPORT'}
        </button>
      </div>
    </aside>
  )
}

// ── header bar ────────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  ledger:         'LIVE_LEDGER_STREAM',
  sessions:       'SESSION_REGISTRY',
  reconciliation: 'RECONCILIATION_INTERFACE',
  alerts:         'ALERT_RULES',
  help:           'HELP_DOCS',
  settings:       'CONFIG_SYS',
}

function Header({ view, proxyOnline, sidebarW }) {
  return (
    <header style={{
      height: 48,
      background: SURF,
      borderBottom: `1px solid ${BORDER}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      position: 'fixed',
      top: 0, left: sidebarW, right: 0,
      zIndex: 10,
      transition: 'left 0.18s ease',
    }}>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: TEXT }}>
        {VIEW_TITLES[view]}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {view === 'ledger' && (
          <StatusPill color={BLUE} label="ENGINE: ACTIVE" />
        )}
        {proxyOnline ? (
          <>
            <StatusPill color={GREEN} label="PROXY: ONLINE" />
            <StatusPill color={GREEN} label="SEC_LAYER: ARMED" />
          </>
        ) : (
          <>
            <StatusPill color={RED} label="PROXY: OFFLINE" />
            <StatusPill color={DIM} label="SEC_LAYER: UNKNOWN" dim />
          </>
        )}
      </div>
    </header>
  )
}

function StatusPill({ color, label, dim }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 8px',
      border: `1px solid ${dim ? BORDER : color + '44'}`,
      borderRadius: 2,
      fontSize: 10,
      fontFamily: MONO,
      letterSpacing: '0.07em',
      color: dim ? DIM : color,
      opacity: dim ? 0.6 : 1,
    }}>
      <Dot color={dim ? DIM : color} />
      {label}
    </span>
  )
}

// ── toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1700)
    const t2 = setTimeout(onDone, 2100)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  return (
    <div
      className={leaving ? 'toast-out' : 'toast-in'}
      style={{
        position: 'fixed',
        bottom: 24, right: 24,
        padding: '10px 16px',
        background: SURF2,
        border: `1px solid ${GREEN}`,
        borderRadius: 2,
        color: GREEN,
        fontFamily: MONO,
        fontSize: 12,
        zIndex: 100,
      }}
    >
      {message}
    </div>
  )
}

// ── backend unreachable banner ────────────────────────────────────────────────
function OfflineBanner({ onDismiss }) {
  return (
    <div style={{
      background: '#1a0a0a',
      border: `1px solid ${RED}`,
      borderRadius: 3,
      padding: '10px 16px',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: 12,
      fontFamily: MONO,
      color: RED,
    }}>
      Backend unreachable — check that the proxy is running on localhost:8000
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
      >
        x
      </button>
    </div>
  )
}

// ── live ledger view ──────────────────────────────────────────────────────────
function StatCard({ label, value, color, warn }) {
  const displayed = String(Math.max(0, value)).padStart(5, '0')
  return (
    <div style={{
      flex: 1,
      padding: '14px 18px',
      background: SURF,
      border: `1px solid ${BORDER}`,
      borderRadius: 2,
    }}>
      <div style={{
        fontFamily: MONO,
        fontSize: 30,
        fontWeight: 700,
        color: color || TEXT,
        lineHeight: 1,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        letterSpacing: '0.04em',
      }}>
        {displayed}
        {warn && value > 0 && (
          <span style={{ fontSize: 13, color: RED, fontWeight: 700 }}>!</span>
        )}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

function verdictLabel(v) {
  if (v === 'VERIFIED') return 'PASS'
  if (v === 'UNVERIFIED') return 'FAIL'
  return v // TAMPERED, CONTRADICTED
}

function LedgerRow({ r, expanded, onToggle, isNew, showFullHashes, onReconcile, sessionPill }) {
  const borderColor =
    r.verdict === 'VERIFIED'     ? GREEN :
    r.verdict === 'CONTRADICTED' ? AMBER :
    r.verdict === 'TAMPERED'     ? RED   :
    r.verdict === 'UNVERIFIED'   ? RED   : BORDER2

  const rowBg = r.verdict === 'TAMPERED' ? 'rgba(239,68,68,0.04)' : 'transparent'
  const reqId = 'REQ_' + r.session_id.slice(0, 6).toUpperCase()

  return (
    <>
      <div
        className={isNew ? 'row-new' : ''}
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '110px 110px 110px 160px 110px',
          gap: 12,
          padding: '10px 16px',
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `2px solid ${borderColor}`,
          cursor: 'pointer',
          fontSize: 12,
          background: rowBg,
          transition: 'background 0.15s',
          alignItems: 'center',
        }}
        onMouseEnter={e => { if (!isNew) e.currentTarget.style.background = SURF2 }}
        onMouseLeave={e => { e.currentTarget.style.background = rowBg }}
      >
        <span style={{ fontFamily: MONO, color: MUTED, fontSize: 11 }}>{fmtTs(r.timestamp)}</span>
        <span style={{ fontFamily: MONO, color: MUTED, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.session_id}>
            {showFullHashes ? r.session_id : reqId}
          </span>
          {sessionPill && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
              <span
                title={sessionPill.scope === 'signature_only'
                  ? 'Cryptographic integrity verified. Run manual reconciliation to verify agent claims.'
                  : sessionPill.scope === 'full_claim'
                  ? 'Full claim verification complete.'
                  : undefined}
                style={{
                  fontSize: 9, fontFamily: MONO, fontWeight: 600,
                  color: sessionPill.color, border: `1px solid ${sessionPill.color}44`,
                  borderRadius: 2, padding: '1px 4px', letterSpacing: '0.04em',
                  cursor: sessionPill.scope ? 'help' : 'default',
                }}
              >
                {sessionPill.label}
              </span>
              {sessionPill.scope === 'signature_only' && (
                <span style={{ fontSize: 8, fontFamily: MONO, color: DIM, letterSpacing: '0.04em' }}>
                  sig. only
                </span>
              )}
            </span>
          )}
        </span>
        <span style={{ fontFamily: MONO, color: TEXT, fontSize: 11 }}>{r.tool_name}</span>
        <span style={{ fontFamily: MONO, color: MUTED, fontSize: 11 }}>
          {showFullHashes ? r.input_hash : truncHex(r.input_hash)}
        </span>
        <span>
          {r.verdict
            ? <Pill color={verdictColor(r.verdict)}>{verdictLabel(r.verdict)}</Pill>
            : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM, padding: '2px 7px', letterSpacing: '0.05em' }}>PENDING</span>
          }
        </span>
      </div>

      <div className="row-detail" style={{ maxHeight: expanded ? 600 : 0 }}>
        <div style={{
          padding: '16px 20px',
          background: SURF2,
          borderBottom: `1px solid ${BORDER}`,
          borderLeft: `2px solid ${borderColor}`,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}>
          {/* left: metadata */}
          <div>
            <div style={{ fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em', marginBottom: 10 }}>RECEIPT DETAIL</div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 6, columnGap: 12, fontSize: 12 }}>
              {[
                ['session_id',   r.session_id],
                ['input_hash',   r.input_hash],
                ['output_hash',  r.output_hash],
              ].map(([k, v]) => (
                <Fragment key={k}>
                  <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11 }}>{k}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, wordBreak: 'break-all' }}>{v}</span>
                </Fragment>
              ))}
              <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11 }}>signature</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, wordBreak: 'break-all', lineHeight: 1.5 }}>{r.hmac_signature}</span>
              <span style={{ color: MUTED, fontFamily: MONO, fontSize: 11 }}>sig_valid</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: r.signature_valid !== false ? GREEN : RED }}>
                {r.signature_valid !== false ? 'Signature Valid' : 'Signature Invalid'}
              </span>
            </div>
          </div>

          {/* right: payloads */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em', marginBottom: 6 }}>TOOL INPUT</div>
              <JsonHighlight obj={r.tool_input ?? {}} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em', marginBottom: 6 }}>TOOL OUTPUT</div>
              <JsonHighlight obj={r.tool_output ?? {}} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={e => { e.stopPropagation(); onReconcile?.(r.session_id) }}
                style={{
                  padding: '4px 12px',
                  background: 'transparent',
                  border: `1px solid ${BORDER2}`,
                  borderRadius: 2,
                  color: DIM,
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.color = TEXT }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER2; e.currentTarget.style.color = DIM }}
              >
                VALIDATE_SESSION
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function sessionPillProps(s) {
  if (!s) return null
  if (s.status === 'open')   return { color: BLUE,  label: 'OPEN' }
  if (s.status === 'closed') return { color: AMBER, label: 'VERIFYING...' }
  if (s.status === 'verified') {
    const v     = s.auto_verdict
    const scope = s.verification_scope  // 'signature_only' | 'full_claim' | null
    if (v === 'VERIFIED')     return { color: GREEN, label: 'VERIFIED', scope }
    if (v === 'TAMPERED')     return { color: RED,   label: 'TAMPERED', scope }
    if (v === 'CONTRADICTED') return { color: AMBER, label: 'CONTRADICTED', scope }
    return { color: RED, label: v ?? 'UNVERIFIED', scope }
  }
  if (s.status === 'failed') return { color: RED, label: 'FAILED' }
  return null
}

function LedgerView({ showFullHashes, onReconcile, proxyOnline }) {
  const [stats, setStats]       = useState({ total_receipts: 0, verified: 0, successful_calls: 0, tamper_alerts: 0, sessions: 0, open_sessions: 0, verified_sessions: 0 })
  const [displayStats, setDisplayStats] = useState({ total_receipts: 0, verified: 0, successful_calls: 0, tamper_alerts: 0 })
  const [receipts, setReceipts] = useState([])
  const [sessionsMap, setSessionsMap] = useState({}) // session_id → session row
  const [newIds, setNewIds]     = useState(new Set())
  const [expandedId, setExpandedId] = useState(null)
  const [search, setSearch]     = useState('')
  const [verdictFilter, setVerdictFilter] = useState('all')
  const [timeFilter, setTimeFilter]       = useState('all')
  const [autoRefresh, setAutoRefresh]     = useState(true)
  const [offline, setOffline]   = useState(false)
  const [offlineDismissed, setOfflineDismissed] = useState(false)
  const prevIdsRef   = useRef(new Set())
  const hasCountedRef = useRef(false)

  // Sync offline state with the App-level proxy poll so the banner
  // auto-dismisses as soon as the backend comes back online
  useEffect(() => {
    if (proxyOnline) {
      setOffline(false)
      setOfflineDismissed(false)
    }
  }, [proxyOnline])

  const refresh = useCallback(async () => {
    try {
      const [sr, rr, sessions] = await Promise.all([
        apiFetch('/stats').then(r => r.ok ? r.json() : null),
        apiFetch('/receipts/all').then(r => r.ok ? r.json() : null),
        apiFetch('/sessions').then(r => r.ok ? r.json() : null),
      ])
      setOffline(false)

      if (sr) {
        const mapped = {
          total_receipts:    sr.total_receipts    ?? 0,
          verified:          sr.verified          ?? 0,
          successful_calls:  sr.successful_calls   ?? 0,
          tamper_alerts:     sr.tamper_alerts     ?? 0,
          sessions:          sr.sessions          ?? 0,
          open_sessions:     sr.open_sessions     ?? 0,
          verified_sessions: sr.verified_sessions ?? 0,
        }
        setStats(mapped)
        if (!hasCountedRef.current) {
          hasCountedRef.current = true
          const countKeys = { total_receipts: mapped.total_receipts, verified: mapped.verified, successful_calls: mapped.successful_calls, tamper_alerts: mapped.tamper_alerts }
          Object.entries(countKeys).forEach(([key, target]) => {
            countUp(0, target, 1000, val =>
              setDisplayStats(prev => ({ ...prev, [key]: val }))
            )
          })
        } else {
          setDisplayStats(mapped)
        }
      }

      if (sessions) {
        const map = {}
        sessions.forEach(s => { map[s.session_id] = s })
        setSessionsMap(map)
      }

      if (rr) {
        console.log('[receipts/all] raw response:', rr)
        const incomingIds = new Set(rr.map(r => r.id))
        if (prevIdsRef.current.size > 0) {
          const freshIds = rr.filter(r => !prevIdsRef.current.has(r.id)).map(r => r.id)
          if (freshIds.length > 0) {
            setNewIds(new Set(freshIds))
            setTimeout(() => setNewIds(new Set()), 2100)
          }
        }
        prevIdsRef.current = incomingIds
        setReceipts(rr)
      }
    } catch {
      setOffline(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh, autoRefresh])

  const nowMs = Date.now()
  const filtered = receipts.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (!r.session_id.toLowerCase().includes(q) && !r.tool_name.toLowerCase().includes(q)) return false
    }
    if (verdictFilter !== 'all' && r.verdict !== verdictFilter) return false
    if (timeFilter === '1h'  && new Date(r.timestamp).getTime() < nowMs - 3600000) return false
    if (timeFilter === '24h' && new Date(r.timestamp).getTime() < nowMs - 86400000) return false
    return true
  })

  const pendingSessions = stats.sessions - stats.verified_sessions - stats.open_sessions
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  // Reset to page 0 whenever filters change
  useEffect(() => { setPage(0) }, [search, verdictFilter, timeFilter])

  return (
    <div>
      {offline && !offlineDismissed && (
        <OfflineBanner onDismiss={() => setOfflineDismissed(true)} />
      )}

      {/* receipt stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <StatCard label="TOTAL_RECEIPTS"  value={displayStats.total_receipts} />
        <StatCard label="VERIFIED_CLAIMS" value={displayStats.verified}          color={GREEN} />
        <StatCard label="TAMPER_ALERTS"   value={displayStats.tamper_alerts}     color={RED}   warn />
      </div>

      {/* session stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Open Sessions',       value: stats.open_sessions,     color: BLUE  },
          { label: 'Verified Sessions',   value: stats.verified_sessions, color: GREEN },
          { label: 'Pending Verification',value: Math.max(0, pendingSessions), color: AMBER },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, padding: '10px 14px',
            background: SURF, border: `1px solid ${BORDER}`, borderRadius: 2,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Dot color={color} />
            <span style={{ fontFamily: MONO, fontSize: 12, color, fontWeight: 500 }}>{value}</span>
            <span style={{ fontFamily: SANS, fontSize: 11, color: MUTED }}>{label}</span>
          </div>
        ))}
      </div>

      {/* table controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by session or tool..."
          style={{
            flex: 1,
            padding: '7px 10px',
            background: SURF,
            border: `1px solid ${BORDER}`,
            borderRadius: 3,
            color: TEXT,
            fontFamily: MONO,
            fontSize: 12,
            outline: 'none',
          }}
        />
        <select
          value={verdictFilter}
          onChange={e => setVerdictFilter(e.target.value)}
          style={{ padding: '7px 10px', background: SURF, border: `1px solid ${BORDER}`, borderRadius: 3, color: TEXT, fontFamily: MONO, fontSize: 12, cursor: 'pointer' }}
        >
          <option value="all">All Verdicts</option>
          <option value="VERIFIED">VERIFIED</option>
          <option value="UNVERIFIED">UNVERIFIED</option>
          <option value="CONTRADICTED">CONTRADICTED</option>
          <option value="TAMPERED">TAMPERED</option>
        </select>
        <select
          value={timeFilter}
          onChange={e => setTimeFilter(e.target.value)}
          style={{ padding: '7px 10px', background: SURF, border: `1px solid ${BORDER}`, borderRadius: 3, color: TEXT, fontFamily: MONO, fontSize: 12, cursor: 'pointer' }}
        >
          <option value="all">All time</option>
          <option value="1h">Last hour</option>
          <option value="24h">Last 24h</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: MONO, color: MUTED, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            style={{ accentColor: BLUE }}
          />
          Auto-refresh
        </label>
      </div>

      {/* table */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        {/* header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '110px 110px 110px 160px 110px',
          gap: 12,
          padding: '8px 16px',
          background: SURF2,
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 10,
          fontFamily: MONO,
          color: DIM,
          letterSpacing: '0.1em',
          borderLeft: '2px solid transparent',
        }}>
          <span>TIMESTAMP</span>
          <span>REQUEST_ID</span>
          <span>TOOL</span>
          <span>INPUT_HASH</span>
          <span>VERDICT</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{
            padding: '48px 0',
            textAlign: 'center',
            color: MUTED,
            fontFamily: MONO,
            fontSize: 12,
          }}>
            {receipts.length === 0
              ? 'No receipts yet. Connect your agent and route tool calls through the proxy.'
              : 'No receipts match the current filters.'}
          </div>
        ) : (
          filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => (
            <LedgerRow
              key={r.id}
              r={r}
              expanded={expandedId === r.id}
              onToggle={() => setExpandedId(prev => prev === r.id ? null : r.id)}
              isNew={newIds.has(r.id)}
              showFullHashes={showFullHashes}
              onReconcile={onReconcile}
              sessionPill={sessionPillProps(sessionsMap[r.session_id])}
            />
          ))
        )}

        {/* table footer */}
        {filtered.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 16px',
            background: SURF2,
            borderTop: `1px solid ${BORDER}`,
            fontFamily: MONO, fontSize: 10, color: DIM,
          }}>
            <span>
              SHOWING {Math.min(page * PAGE_SIZE + 1, filtered.length)}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} OF {filtered.length} RECORDS
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '2px 10px', background: 'transparent',
                  border: `1px solid ${page === 0 ? BORDER : BORDER2}`,
                  borderRadius: 2, color: page === 0 ? DIM : MUTED,
                  fontFamily: MONO, fontSize: 10, cursor: page === 0 ? 'default' : 'pointer',
                  letterSpacing: '0.06em',
                }}
              >
                PREV
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                style={{
                  padding: '2px 10px', background: 'transparent',
                  border: `1px solid ${(page + 1) * PAGE_SIZE >= filtered.length ? BORDER : BORDER2}`,
                  borderRadius: 2, color: (page + 1) * PAGE_SIZE >= filtered.length ? DIM : MUTED,
                  fontFamily: MONO, fontSize: 10, cursor: (page + 1) * PAGE_SIZE >= filtered.length ? 'default' : 'pointer',
                  letterSpacing: '0.06em',
                }}
              >
                NEXT
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── sessions view ────────────────────────────────────────────────────────────
function fmtDuration(createdAt, closedAt) {
  if (!createdAt || !closedAt) return '—'
  const ms = new Date(closedAt) - new Date(createdAt)
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

function SessionStatusPill({ session }) {
  const p = sessionPillProps(session)
  if (!p) return null
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 3,
      fontSize: 11, fontFamily: MONO, fontWeight: 500, letterSpacing: '0.05em',
      border: `1px solid ${p.color}`, color: p.color,
    }}>
      {p.label}
    </span>
  )
}

function SessionTimeline({ session, onReconcile }) {
  const [receipts, setReceipts] = useState(null)
  const [loadingRx, setLoadingRx] = useState(true)

  useEffect(() => {
    apiFetch(`/receipts/${session.session_id}`)
      .then(r => r.json())
      .then(data => { setReceipts(data); setLoadingRx(false) })
      .catch(() => setLoadingRx(false))
  }, [session.session_id])

  const sessionStart = session.created_at ? new Date(session.created_at) : null

  return (
    <div style={{
      borderTop: `1px solid ${BORDER}`,
      background: 'rgba(0,0,0,0.18)',
      padding: '14px 16px 14px 24px',
    }}>
      {loadingRx ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>Loading receipts…</div>
      ) : !receipts || receipts.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>No receipts in this session.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {receipts.map((r, i) => {
            const offsetMs  = sessionStart ? new Date(r.timestamp) - sessionStart : null
            const offsetStr = offsetMs !== null ? `+${(offsetMs / 1000).toFixed(1)}s` : '—'
            const dotColor  = r.verdict ? verdictColor(r.verdict)
              : r.status === 'error' ? RED : MUTED
            const isLast = i === receipts.length - 1
            return (
              <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'stretch', minHeight: 32 }}>
                {/* track */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14, flexShrink: 0 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, marginTop: 6, flexShrink: 0 }} />
                  {!isLast && <div style={{ width: 1, flex: 1, background: BORDER, minHeight: 8 }} />}
                </div>
                {/* row content */}
                <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'center', paddingBottom: isLast ? 0 : 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, width: 52, flexShrink: 0 }}>{offsetStr}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, flex: 1, minWidth: 100 }}>{r.tool_name}</span>
                  <Pill color={r.status === 'error' ? RED : GREEN}>{r.status}</Pill>
                  {r.verdict && <Pill color={verdictColor(r.verdict)}>{verdictLabel(r.verdict)}</Pill>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* footer actions */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={e => { e.stopPropagation(); onReconcile?.(session.session_id) }}
          style={{
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em',
            background: 'transparent', border: `1px solid ${BORDER}`,
            color: BLUE, cursor: 'pointer', padding: '5px 10px', borderRadius: 2,
          }}
        >
          OPEN RECONCILIATION →
        </button>
      </div>
    </div>
  )
}

function SessionsView({ onReconcile }) {
  const [sessions, setSessions]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [expanded, setExpanded]         = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await apiFetch('/sessions').then(r => r.json())
        if (active) { setSessions(data); setLoading(false) }
      } catch { if (active) setLoading(false) }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { active = false; clearInterval(t) }
  }, [])

  const COL = '1fr 120px 80px 60px 100px 110px minmax(110px,auto) 16px'

  return (
    <div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        {/* header */}
        <div style={{
          display: 'grid', gridTemplateColumns: COL, gap: 12,
          padding: '8px 16px', background: SURF2, borderBottom: `1px solid ${BORDER}`,
          fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em',
        }}>
          <span>SESSION_ID</span>
          <span>STARTED</span>
          <span>DURATION</span>
          <span>RX</span>
          <span>STATUS</span>
          <span>SCOPE</span>
          <span>VERDICT</span>
          <span />
        </div>

        {loading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="skeleton-row" style={{ height: 44, borderBottom: `1px solid ${BORDER}`, animationDelay: `${i * 0.15}s` }} />
          ))
        ) : sessions.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: MUTED, fontFamily: MONO, fontSize: 12 }}>
            No sessions yet. Run a demo or make a tool call.
          </div>
        ) : (
          sessions.map(s => {
            const scopeLabel = s.verification_scope === 'signature_only' ? 'SIG_ONLY'
              : s.verification_scope === 'full_claim' ? 'FULL_CLAIM' : null
            const scopeColor = s.verification_scope === 'full_claim' ? BLUE : DIM
            const isOpen = expanded === s.session_id
            return (
              <div key={s.session_id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : s.session_id)}
                  style={{
                    display: 'grid', gridTemplateColumns: COL, gap: 12,
                    padding: '10px 16px', cursor: 'pointer', fontSize: 12, alignItems: 'center',
                    background: isOpen ? SURF2 : 'transparent', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = SURF2 }}
                  onMouseLeave={e => { e.currentTarget.style.background = isOpen ? SURF2 : 'transparent' }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.session_id}>
                    {s.session_id}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{fmtTs(s.created_at)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{fmtDuration(s.created_at, s.closed_at)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT }}>{s.receipt_count}</span>
                  <span><SessionStatusPill session={s} /></span>
                  <span>
                    {scopeLabel
                      ? <Pill color={scopeColor}>{scopeLabel}</Pill>
                      : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>—</span>
                    }
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {s.auto_verdict
                      ? <Pill color={verdictColor(s.auto_verdict)}>{verdictLabel(s.auto_verdict)}</Pill>
                      : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>—</span>
                    }
                  </span>
                  {/* chevron */}
                  <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, textAlign: 'right', userSelect: 'none' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
                {isOpen && (
                  <SessionTimeline session={s} onReconcile={onReconcile} />
                )}
              </div>
            )
          })
        )}
      </div>
      <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.06em' }}>
        CLICK ANY ROW TO EXPAND TIMELINE
      </div>
    </div>
  )
}

// ── reconciliation view ───────────────────────────────────────────────────────
function ReconcileVerdictBanner({ verdict }) {
  const cfg = {
    VERIFIED:     { color: GREEN, bg: 'rgba(34,197,94,0.06)',   border: 'rgba(34,197,94,0.2)',   left: GREEN, text: 'ALL CLAIMS MATCH CRYPTOGRAPHIC RECEIPTS' },
    UNVERIFIED:   { color: RED,   bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.2)',   left: RED,   text: 'NO RECEIPTS FOUND — AGENT MADE CLAIMS WITHOUT EXECUTING TOOLS' },
    CONTRADICTED: { color: AMBER, bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.2)',  left: AMBER, text: 'CLAIM MISMATCH — AGENT REPORTED OUTPUTS THAT DIFFER FROM LEDGER. SEE DIFF BELOW.' },
    TAMPERED:     { color: RED,   bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.2)',   left: RED,   text: 'SIGNATURE INVALID — RECEIPT WAS MODIFIED AFTER EXECUTION' },
  }
  const s = cfg[verdict] ?? cfg.UNVERIFIED
  return (
    <div className="pill-animate" style={{
      padding: '12px 16px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderLeft: `3px solid ${s.left}`,
      borderRadius: 2,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: s.color, letterSpacing: '0.08em', marginBottom: 4 }}>
        STATE: {verdict}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: s.color, opacity: 0.7, letterSpacing: '0.06em' }}>{s.text}</div>
    </div>
  )
}

function ReceiptCard({ receipt: r, verdict: v }) {
  const cardVerdict =
    !v              ? null :
    v.signature_valid === false ? 'TAMPERED' :
    v.verified      ? 'VERIFIED' : 'CONTRADICTED'

  const isContradicted = cardVerdict === 'CONTRADICTED'
  const toolMismatch   = isContradicted && v?.tool_name !== r.tool_name
  const hashMismatch   = isContradicted && v?.claimed_hash && v?.actual_hash && v.claimed_hash !== v.actual_hash

  const rows = [
    { field: 'tool_name',      actual: r.tool_name,  match: !toolMismatch },
    { field: 'output_hash',    actual: r.output_hash ? r.output_hash.slice(0, 16) + '...' : '—', match: v ? (v.claimed_hash === v.actual_hash) : true },
    { field: 'hmac_signature', actual: v?.signature_valid === false ? 'Invalid' : 'Valid', color: v?.signature_valid === false ? RED : GREEN, match: v ? v.signature_valid !== false : true },
    { field: 'executed_at',    actual: r.timestamp, match: true },
  ]

  return (
    <div style={{ border: `1px solid ${isContradicted ? 'rgba(245,158,11,0.35)' : BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
      {/* card header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '11px 16px', background: SURF2, borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: TEXT }}>{r.tool_name}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, flex: 1 }}>{r.id.slice(0, 8)}...</span>
        {cardVerdict
          ? <Pill color={verdictColor(cardVerdict)} bg={cardVerdict === 'TAMPERED' ? 'rgba(245,158,11,0.08)' : undefined}>{cardVerdict}</Pill>
          : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>PENDING</span>
        }
      </div>

      {/* CONTRADICTED diff — claim vs. ledger side-by-side */}
      {isContradicted && (
        <div style={{ borderBottom: `1px solid ${BORDER}` }}>
          {/* diff header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '18% 1fr 1fr',
            padding: '5px 16px', background: 'rgba(245,158,11,0.06)',
            fontSize: 9, fontFamily: MONO, color: DIM, letterSpacing: '0.12em',
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <span>FIELD</span>
            <span style={{ color: RED }}>AGENT CLAIMED</span>
            <span style={{ color: GREEN }}>LEDGER RECORDED</span>
          </div>
          {/* tool_name diff row */}
          {toolMismatch && (
            <div style={{
              display: 'grid', gridTemplateColumns: '18% 1fr 1fr',
              padding: '8px 16px', background: 'rgba(239,68,68,0.05)',
              borderBottom: `1px solid ${BORDER}`,
              fontSize: 11, fontFamily: MONO, alignItems: 'center',
            }}>
              <span style={{ color: DIM, fontSize: 10, letterSpacing: '0.06em' }}>tool_name</span>
              <span style={{ color: RED }}>{v.tool_name}</span>
              <span style={{ color: GREEN }}>{r.tool_name}</span>
            </div>
          )}
          {/* output_hash diff row */}
          {hashMismatch && (
            <div style={{
              display: 'grid', gridTemplateColumns: '18% 1fr 1fr',
              padding: '8px 16px', background: 'rgba(239,68,68,0.05)',
              fontSize: 11, fontFamily: MONO, alignItems: 'center',
            }}>
              <span style={{ color: DIM, fontSize: 10, letterSpacing: '0.06em' }}>output_hash</span>
              <span style={{ color: RED, wordBreak: 'break-all' }}>{v.claimed_hash.slice(0, 16)}...</span>
              <span style={{ color: GREEN, wordBreak: 'break-all' }}>{v.actual_hash.slice(0, 16)}...</span>
            </div>
          )}
          {/* reason label */}
          <div style={{ padding: '5px 16px', background: 'rgba(245,158,11,0.04)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: '0.1em' }}>REASON</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: AMBER, letterSpacing: '0.04em' }}>
              {v?.reason ?? 'contradicted'}
            </span>
          </div>
        </div>
      )}

      {/* column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '30% 55% 15%',
        padding: '6px 16px', background: SURF,
        borderBottom: `1px solid ${BORDER}`,
        fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em',
      }}>
        <span>FIELD</span><span>LEDGER</span><span style={{ textAlign: 'center' }}>STAT</span>
      </div>

      {/* rows */}
      {rows.map((row, i) => (
        <div key={row.field} style={{
          display: 'grid', gridTemplateColumns: '30% 55% 15%',
          padding: '8px 16px',
          borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : 'none',
          background: !row.match ? 'rgba(239,68,68,0.05)' : i % 2 === 1 ? SURF2 : 'transparent',
          fontSize: 11, fontFamily: MONO, alignItems: 'center',
        }}>
          <span style={{ color: DIM, letterSpacing: '0.06em', fontSize: 10 }}>{row.field}</span>
          <span style={{ color: row.color ?? TEXT, wordBreak: 'break-all' }}>{row.actual}</span>
          <span style={{ textAlign: 'center', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: row.match ? GREEN : RED }}>
            {row.match ? 'OK' : 'FAIL'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ReconciliationView({ initialSession, onClearInitial }) {
  const [sessions, setSessions]         = useState([]) // from /sessions
  const [selected, setSelected]         = useState(initialSession ?? '')
  const [loading, setLoading]           = useState(false)
  const [result, setResult]             = useState(null)
  const [error, setError]               = useState(null)
  const [copied, setCopied]             = useState(false)
  const didInitRef                      = useRef(false)
  const autoRunIdRef                    = useRef(initialSession ?? null)

  // Populate sessions dropdown from /sessions (includes auto_verdict + verification_scope)
  useEffect(() => {
    apiFetch('/sessions')
      .then(r => r.json())
      .then(data => setSessions(data))
      .catch(() => {})
  }, [])

  const selectedSession = sessions.find(s => s.session_id === selected)
  const onRecord        = result?.onRecord === true // full_claim verdict shown without re-running

  // Consume the pre-selected session passed from the ledger/sessions views.
  // The actual display decision happens in the selection effect below.
  useEffect(() => {
    if (!initialSession || didInitRef.current) return
    didInitRef.current = true
    autoRunIdRef.current = initialSession
    setSelected(initialSession)
    onClearInitial?.()
  }, [initialSession]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the display whenever the selection (or the loaded session list) changes:
  //   • full_claim + auto_verdict → show the stored verdict WITHOUT re-running
  //     (re-running uses stored receipts as the claim source → always VERIFIED → circular).
  //   • otherwise, auto-run only when the selection arrived from another view; a manual
  //     dropdown pick waits for the button.
  useEffect(() => {
    if (!selected) { setResult(null); return }
    const s = sessions.find(x => x.session_id === selected)
    if (!s) return // session list not loaded yet
    if (s.verification_scope === 'full_claim' && s.auto_verdict) {
      autoRunIdRef.current = null
      showStoredVerdict(s)
    } else if (autoRunIdRef.current === selected) {
      autoRunIdRef.current = null
      runForSession(selected)
    } else {
      setResult(null) // manual selection — wait for the button
    }
  }, [selected, sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build a ReceiptCard-shaped verdict from a receipt's stored verdict string.
  function storedVerdictObj(r) {
    const vd = r.verdict
    if (!vd) return null
    return {
      receipt_id:      r.id,
      tool_name:       r.tool_name,
      signature_valid: vd !== 'TAMPERED',
      verified:        vd === 'VERIFIED',
      claimed_hash:    r.output_hash,
      // equal only when VERIFIED, so the output_hash MATCH row reflects the stored verdict
      actual_hash:     vd === 'VERIFIED' ? r.output_hash : null,
    }
  }

  // Show the verdict already on record (no verify-claim call).
  // Uses full_claim_verdicts from the session when available (they carry claimed tool names
  // and hashes from the original agent report), falling back to synthesizing from receipts.
  async function showStoredVerdict(s) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const rr = await apiFetch(`/receipts/${s.session_id}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      const verdictMap = {}
      // Prefer stored full_claim_verdicts — they contain the agent's claimed tool_name,
      // claimed_hash, actual_hash, and reason, which power the CONTRADICTED diff rows.
      const storedVerdicts = Array.isArray(s.full_claim_verdicts) ? s.full_claim_verdicts : null
      if (storedVerdicts) {
        storedVerdicts.forEach(v => { verdictMap[v.receipt_id] = v })
      } else {
        rr.forEach(r => {
          const v = storedVerdictObj(r)
          if (v) verdictMap[r.id] = v
        })
      }
      setResult({
        verdict:      s.auto_verdict,
        verdicts:     Object.values(verdictMap),
        receipts:     rr,
        verdictMap,
        session_id:   s.session_id,
        generated_at: s.auto_verified_at ?? new Date().toISOString(),
        onRecord:     true,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runForSession(sessionId, force = false) {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      // 1. Fetch all receipts for this session (includes raw tool_output)
      const rr = await apiFetch(`/receipts/${sessionId}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })

      if (rr.length === 0) {
        setResult({ verdict: 'UNVERIFIED', verdicts: [], receipts: [], verdictMap: {}, session_id: sessionId, generated_at: new Date().toISOString() })
        return
      }

      // 2. Build claimed_outputs from actual stored receipts
      const claimedOutputs = rr.map(r => ({
        receipt_id: r.id,
        tool_name:  r.tool_name,
        output:     r.tool_output ?? {},
      }))

      // 3. POST /sessions/{id}/verify-claim — runs full reconciliation and
      //    persists verification_scope='full_claim' on the session row. force=true
      //    overrides the backend's guard against overwriting an existing full_claim verdict.
      const verRes = await apiFetch(`/sessions/${sessionId}/verify-claim${force ? '?force=true' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, claimed_outputs: claimedOutputs }),
      })
      if (!verRes.ok) {
        const body = await verRes.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${verRes.status}`)
      }
      const verData = await verRes.json()

      // Backend guard: a full_claim verdict is already on record. Show it instead of
      // a circular re-run (only happens when force was not requested).
      if (verData.already_verified) {
        const s = sessions.find(x => x.session_id === sessionId)
        // Pass the full session object so showStoredVerdict can use full_claim_verdicts.
        if (s) await showStoredVerdict(s)
        return
      }

      // 4. Derive top-level verdict
      const vs = verData.verdicts ?? []
      let verdict
      if (vs.length === 0)                                 verdict = 'UNVERIFIED'
      else if (vs.some(v => v.signature_valid === false))  verdict = 'TAMPERED'
      else if (vs.every(v => v.verified))                  verdict = 'VERIFIED'
      else if (vs.some(v => v.reason === 'receipt_not_found')) verdict = 'UNVERIFIED'
      else                                                 verdict = 'CONTRADICTED'

      const verdictMap = {}
      vs.forEach(v => { verdictMap[v.receipt_id] = v })

      setResult({ verdict, verdicts: vs, receipts: rr, verdictMap, session_id: sessionId, generated_at: new Date().toISOString() })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function fmtSessionOption(s) {
    const id    = s.session_id.length > 20 ? s.session_id.slice(0, 20) + '...' : s.session_id
    const time  = s.last_activity ? fmtTs(s.last_activity) : '—'
    const count = s.receipt_count ?? 0
    const suffix = s.auto_verdict ? `  ·  ${s.auto_verdict}` : ''
    return `${id}  ·  ${count} receipt${count !== 1 ? 's' : ''}  ·  ${time}${suffix}`
  }

  function copyResult() {
    if (!result) return
    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Section 1: Session selector ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: SURF, border: `1px solid ${BORDER}`, borderRadius: 2,
      }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.1em', flexShrink: 0 }}>SESSION</span>
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={{
            flex: 1, padding: '6px 10px',
            background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 3,
            color: selected ? TEXT : MUTED, fontFamily: MONO, fontSize: 12, cursor: 'pointer',
          }}
        >
          <option value="">— select a session —</option>
          {sessions.map(s => (
            <option key={s.session_id} value={s.session_id}>{fmtSessionOption(s)}</option>
          ))}
        </select>
        <button
          onClick={() => runForSession(selected, onRecord)}
          disabled={loading || !selected}
          style={{
            padding: '6px 16px', flexShrink: 0,
            background: loading || !selected ? SURF2 : onRecord ? 'transparent' : BLUE,
            border: `1px solid ${loading || !selected ? BORDER : onRecord ? AMBER : BLUE}`,
            borderRadius: 2,
            color: loading || !selected ? MUTED : onRecord ? AMBER : '#fff',
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em',
            cursor: loading || !selected ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
        >
          {loading
            ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>RUNNING...</>
            : onRecord ? 'RE-RUN VALIDATION' : 'RUN VALIDATION'
          }
        </button>
      </div>

      {/* Re-run warning — shown when a full_claim verdict is already on record */}
      {onRecord && !loading && (
        <div style={{
          padding: '8px 12px', background: 'rgba(245,158,11,0.04)',
          border: `1px solid rgba(245,158,11,0.25)`, borderRadius: 2,
          color: AMBER, fontFamily: MONO, fontSize: 10, lineHeight: 1.7, letterSpacing: '0.05em',
        }}>
          WARN: SESSION HAS EXISTING FULL_CLAIM VERDICT. RE-RUN USES STORED RECEIPTS AS CLAIM
          SOURCE AND MAY NOT REFLECT ORIGINAL AGENT OUTPUT.
        </div>
      )}

      {/* inline error */}
      {error && (
        <div style={{
          padding: '10px 12px', background: '#1a0808',
          border: `1px solid ${RED}`, borderRadius: 3,
          color: RED, fontFamily: MONO, fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* ── Section 2: Results ── */}

      {/* Auto-verdict preview — shown when a session with stored verdict is selected but not yet run */}
      {!result && !loading && !error && selectedSession?.auto_verdict && (
        <div style={{
          padding: '12px 16px', background: SURF, border: `1px solid ${BORDER}`, borderRadius: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill color={verdictColor(selectedSession.auto_verdict)}>{verdictLabel(selectedSession.auto_verdict)}</Pill>
            {selectedSession.verification_scope === 'signature_only' && (
              <span style={{
                fontFamily: MONO, fontSize: 9, color: DIM,
                padding: '1px 6px', border: `1px solid ${BORDER2}`, borderRadius: 2,
                letterSpacing: '0.08em',
              }}>
                SIG_ONLY
              </span>
            )}
            <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.05em' }}>
              {selectedSession.verification_scope === 'signature_only'
                ? 'SIGNATURES_OK — AGENT CLAIM NOT YET CHECKED'
                : 'AUTO_VERIFIED'}{' '}
              {selectedSession.auto_verified_at
                ? `· ${Math.round((Date.now() - new Date(selectedSession.auto_verified_at)) / 1000)}s ago`
                : ''}
            </span>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.05em' }}>
            {selectedSession.verification_scope === 'signature_only'
              ? 'RUN VALIDATION TO CHECK AGENT CLAIMS'
              : 'RUN VALIDATION TO RE-RUN'}
          </span>
        </div>
      )}

      {!result && !loading && !error && !selectedSession?.auto_verdict && (
        <div style={{
          padding: '64px 0', textAlign: 'center',
          border: `1px solid ${BORDER}`, borderRadius: 2, background: SURF,
        }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: DIM, marginBottom: 6, letterSpacing: '0.08em' }}>
            SELECT A SESSION TO RUN VALIDATION
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, opacity: 0.6 }}>
            EACH TOOL CALL WILL BE VERIFIED CRYPTOGRAPHICALLY
          </div>
        </div>
      )}

      {loading && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton-row" style={{
              height: 56,
              borderBottom: i < 2 ? `1px solid ${BORDER}` : 'none',
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </div>
      )}

      {result && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* On-record label — stored full_claim verdict, not a fresh re-run */}
          {onRecord && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontFamily: MONO, fontSize: 9, color: AMBER,
                padding: '2px 7px', border: `1px solid rgba(245,158,11,0.35)`, borderRadius: 2,
                letterSpacing: '0.1em',
              }}>
                ON_RECORD
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.05em' }}>
                FULL_CLAIM VERIFICATION ON RECORD
                {result.generated_at ? ` · ${new Date(result.generated_at).toLocaleString()}` : ''}
              </span>
            </div>
          )}

          {/* Part A: Verdict banner */}
          <ReconcileVerdictBanner verdict={result.verdict} />

          {/* Part B: Per-receipt cards */}
          {result.receipts.length === 0 ? (
            <div style={{
              padding: '32px', textAlign: 'center',
              border: `1px solid ${BORDER}`, borderRadius: 2,
              fontFamily: MONO, fontSize: 12, color: MUTED,
            }}>
              No tool executions recorded for this session.
            </div>
          ) : (
            result.receipts.map(r => (
              <ReceiptCard key={r.id} receipt={r} verdict={result.verdictMap[r.id]} />
            ))
          )}

          {/* Part C: Session summary footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', gap: 12, flexWrap: 'wrap',
            background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 2,
          }}>
            <div style={{ display: 'flex', gap: 20, fontFamily: MONO, fontSize: 10, color: DIM, flexWrap: 'wrap', letterSpacing: '0.06em' }}>
              <span>SESSION: {result.session_id.slice(0, 16)}...</span>
              <span>RX_COUNT: {result.receipts.length}</span>
              <span>GENERATED: {new Date(result.generated_at).toLocaleTimeString()}</span>
            </div>
            <button
              onClick={copyResult}
              style={{
                padding: '3px 10px', background: 'transparent',
                border: `1px solid ${copied ? GREEN : BLUE}`, borderRadius: 2,
                color: copied ? GREEN : BLUE,
                fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer', flexShrink: 0,
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {copied ? 'COPIED' : 'COPY_JSON'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── alerts view ───────────────────────────────────────────────────────────────
const TRIGGER_COLORS = {
  CONTRADICTED: 'var(--amber)',
  TAMPERED:     'var(--red)',
  UNVERIFIED:   'var(--red)',
  ANY:          'var(--blue)',
}

const CHANNEL_LABELS = { webhook: 'Webhook', email: 'Email', slack: 'Slack' }

function AlertRuleCard({ rule, onToggle, onTest, onDelete }) {
  const [testState, setTestState] = useState(null) // null | 'sending' | 'sent' | 'failed'

  async function handleTest() {
    setTestState('sending')
    try {
      const res = await apiFetch(`/alerts/${rule.id}/test`, { method: 'POST' })
      setTestState(res.ok ? 'sent' : 'failed')
    } catch {
      setTestState('failed')
    }
    setTimeout(() => setTestState(null), 2000)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px',
      background: SURF,
      border: `1px solid ${BORDER}`,
      borderRadius: 2,
    }}>
      {/* name */}
      <span style={{ flex: 1, fontFamily: SANS, fontSize: 13, fontWeight: 500, color: TEXT }}>
        {rule.name}
      </span>

      {/* trigger badge */}
      <Pill color={TRIGGER_COLORS[rule.trigger] ?? MUTED}>
        ON: {rule.trigger}
      </Pill>

      {/* channel badge */}
      <Pill color={BLUE}>{(CHANNEL_LABELS[rule.channel] ?? rule.channel).toUpperCase()}</Pill>

      {/* enabled toggle */}
      <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 18, cursor: 'pointer', flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={() => onToggle(rule)}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 9,
          background: rule.enabled ? BLUE : BORDER2,
          transition: 'background 0.2s',
          border: `1px solid ${rule.enabled ? BLUE : BORDER}`,
        }} />
        <span style={{
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          left: rule.enabled ? 20 : 2, width: 14, height: 14,
          borderRadius: '50%', background: '#fff', transition: 'left 150ms ease',
        }} />
      </label>

      {/* test button */}
      <button
        onClick={handleTest}
        disabled={testState === 'sending'}
        style={{
          padding: '4px 10px', background: 'transparent',
          border: `1px solid ${testState === 'sent' ? GREEN : testState === 'failed' ? RED : BORDER2}`,
          borderRadius: 3,
          color: testState === 'sent' ? GREEN : testState === 'failed' ? RED : MUTED,
          fontFamily: MONO, fontSize: 11, cursor: testState === 'sending' ? 'wait' : 'pointer',
          transition: 'border-color 0.15s, color 0.15s',
          flexShrink: 0,
        }}
      >
        {testState === 'sending' ? '...' : testState === 'sent' ? 'Sent' : testState === 'failed' ? 'Failed' : 'Test'}
      </button>

      {/* delete */}
      <button
        onClick={() => onDelete(rule.id)}
        style={{
          padding: '4px 8px', background: 'transparent',
          border: `1px solid transparent`,
          borderRadius: 3, color: MUTED, fontFamily: MONO, fontSize: 13,
          cursor: 'pointer', transition: 'color 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = RED }}
        onMouseLeave={e => { e.currentTarget.style.color = MUTED }}
        title="Delete rule"
      >
        ×
      </button>
    </div>
  )
}

function AlertsView() {
  const [rules, setRules]           = useState([])
  const [showForm, setShowForm]     = useState(false)
  const [step, setStep]             = useState(1) // 1=trigger 2=channel 3=config 4=name
  const [trigger, setTrigger]       = useState(null)
  const [channel, setChannel]       = useState(null)
  const [ruleName, setRuleName]     = useState('')
  const [sendTest, setSendTest]     = useState(true)
  const [config, setConfig]         = useState({})
  const [saving, setSaving]         = useState(false)
  const [formMsg, setFormMsg]       = useState(null) // {type:'ok'|'err', text}

  useEffect(() => { loadRules() }, [])

  async function loadRules() {
    try {
      const data = await apiFetch('/alerts').then(r => r.json())
      setRules(Array.isArray(data) ? data : [])
    } catch {}
  }

  function openForm() {
    setShowForm(true); setStep(1); setTrigger(null); setChannel(null)
    setRuleName(''); setConfig({}); setFormMsg(null); setSendTest(true)
  }

  function closeForm() { setShowForm(false) }

  function autoName(t, c) {
    if (!t || !c) return ''
    return `${CHANNEL_LABELS[c] ?? c} on ${t}`
  }

  function pickTrigger(t) { setTrigger(t); setRuleName(autoName(t, channel)); setStep(2) }
  function pickChannel(c) { setChannel(c); setRuleName(autoName(trigger, c)); setStep(3) }

  function configField(label, key, placeholder, type = 'text') {
    return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontFamily: SANS, fontSize: 12, color: MUTED }}>{label}</label>
        <input
          type={type}
          value={config[key] ?? ''}
          onChange={e => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
          placeholder={placeholder}
          style={{
            padding: '7px 10px', background: SURF2,
            border: `1px solid ${BORDER}`, borderRadius: 3,
            color: TEXT, fontFamily: MONO, fontSize: 12, outline: 'none',
          }}
        />
      </div>
    )
  }

  async function handleCreate() {
    setSaving(true); setFormMsg(null)
    try {
      const res = await apiFetch('/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ruleName, trigger, channel, config }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = await res.json()

      if (sendTest) {
        try {
          await apiFetch(`/alerts/${created.id}/test`, { method: 'POST' })
          setFormMsg({ type: 'ok', text: 'Rule created. Test alert sent.' })
        } catch {
          setFormMsg({ type: 'ok', text: 'Rule created. Test alert failed to send.' })
        }
      } else {
        setFormMsg({ type: 'ok', text: 'Rule created.' })
      }

      await loadRules()
      setShowForm(false)
    } catch (e) {
      setFormMsg({ type: 'err', text: `Failed to create rule: ${e.message}` })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(rule) {
    try {
      await apiFetch(`/alerts/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      await loadRules()
    } catch {}
  }

  async function handleDelete(id) {
    try {
      await apiFetch(`/alerts/${id}`, { method: 'DELETE' })
      await loadRules()
    } catch {}
  }

  const TRIGGERS = ['CONTRADICTED', 'TAMPERED', 'UNVERIFIED', 'ANY']
  const CHANNELS = ['webhook', 'email', 'slack']

  const btnBase = {
    padding: '8px 14px', background: 'transparent',
    borderRadius: 3, fontFamily: MONO, fontSize: 12, cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
  }

  function TriggerBtn({ t }) {
    const sel = trigger === t
    return (
      <button
        onClick={() => pickTrigger(t)}
        style={{
          ...btnBase,
          border: `1px solid ${sel ? TRIGGER_COLORS[t] : BORDER2}`,
          color: sel ? TRIGGER_COLORS[t] : MUTED,
        }}
      >
        {t === 'ANY' ? 'ANY VERDICT' : t}
      </button>
    )
  }

  function ChannelBtn({ c }) {
    const sel = channel === c
    return (
      <button
        onClick={() => pickChannel(c)}
        style={{
          ...btnBase,
          border: `1px solid ${sel ? BLUE : BORDER2}`,
          color: sel ? BLUE : MUTED,
        }}
      >
        {CHANNEL_LABELS[c]}
      </button>
    )
  }

  return (
    <div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: DIM }}>ALERT_RULES</span>
        <button
          onClick={showForm ? closeForm : openForm}
          style={{
            padding: '5px 14px', background: showForm ? 'transparent' : BLUE,
            border: `1px solid ${showForm ? BORDER2 : BLUE}`,
            borderRadius: 2, color: showForm ? MUTED : '#fff',
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', cursor: 'pointer',
          }}
        >
          {showForm ? 'CANCEL' : 'ADD_RULE'}
        </button>
      </div>

      {/* inline add form */}
      {showForm && (
        <div style={{
          marginBottom: 20, padding: '16px 18px',
          background: SURF, border: `1px solid ${BORDER}`, borderRadius: 2,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* step 1 — trigger */}
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.1em', marginBottom: 8 }}>
              STEP 1 — TRIGGER
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TRIGGERS.map(t => <TriggerBtn key={t} t={t} />)}
            </div>
          </div>

          {/* step 2 — channel */}
          {step >= 2 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.1em', marginBottom: 8 }}>
                STEP 2 — CHANNEL
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {CHANNELS.map(c => <ChannelBtn key={c} c={c} />)}
              </div>
            </div>
          )}

          {/* step 3 — configure */}
          {step >= 3 && channel && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.1em', marginBottom: 10 }}>
                STEP 3 — CONFIGURE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {channel === 'webhook' && (
                  <>
                    {configField('Webhook URL', 'url', 'https://...')}
                    <div style={{ fontFamily: SANS, fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                      Receipts will POST a JSON payload to this URL when the verdict fires.
                    </div>
                  </>
                )}
                {channel === 'email' && (
                  <>
                    {configField('SMTP Host', 'smtp_host', 'smtp.gmail.com')}
                    {configField('SMTP Port', 'smtp_port', '587')}
                    {configField('Gmail address', 'smtp_user', 'you@gmail.com')}
                    {configField('App password', 'smtp_pass', '16-char app password', 'password')}
                    {configField('Send alerts to', 'to', 'alerts@yourcompany.com')}
                    <div style={{ fontFamily: SANS, fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                      Use a Gmail App Password, not your account password. Generate one at{' '}
                      <a
                        href="https://myaccount.google.com/apppasswords"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#b45309' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'inherit' }}
                      >
                        myaccount.google.com/apppasswords
                      </a>.
                    </div>
                  </>
                )}
                {channel === 'slack' && (
                  <>
                    {configField('Slack Webhook URL', 'webhook_url', 'https://hooks.slack.com/...')}
                    <div style={{ fontFamily: SANS, fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                      Create an incoming webhook at api.slack.com/apps → Incoming Webhooks.{' '}
                      <a
                        href="https://api.slack.com/messaging/webhooks"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#b45309' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'inherit' }}
                      >
                        How to get a Slack webhook →
                      </a>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setStep(4)}
                  style={{
                    alignSelf: 'flex-start', padding: '7px 14px',
                    background: BLUE, border: `1px solid ${BLUE}`,
                    borderRadius: 3, color: '#fff', fontFamily: MONO, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* step 4 — name & save */}
          {step >= 4 && (
            <div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.1em', marginBottom: 10 }}>
                STEP 4 — NAME &amp; SAVE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontFamily: SANS, fontSize: 12, color: MUTED }}>Rule name</label>
                  <input
                    value={ruleName}
                    onChange={e => setRuleName(e.target.value)}
                    placeholder="e.g. Slack on CONTRADICTED"
                    style={{
                      padding: '7px 10px', background: SURF2,
                      border: `1px solid ${BORDER}`, borderRadius: 3,
                      color: TEXT, fontFamily: MONO, fontSize: 12, outline: 'none',
                    }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontFamily: MONO, color: MUTED, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={sendTest}
                    onChange={e => setSendTest(e.target.checked)}
                    style={{ accentColor: BLUE }}
                  />
                  Send test alert after creation
                </label>
                {formMsg && (
                  <div style={{
                    padding: '8px 10px', borderRadius: 3, fontFamily: MONO, fontSize: 12,
                    background: formMsg.type === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${formMsg.type === 'ok' ? GREEN : RED}`,
                    color: formMsg.type === 'ok' ? GREEN : RED,
                  }}>
                    {formMsg.text}
                  </div>
                )}
                <button
                  onClick={handleCreate}
                  disabled={saving || !ruleName}
                  style={{
                    alignSelf: 'flex-start', padding: '7px 16px',
                    background: saving || !ruleName ? SURF2 : BLUE,
                    border: `1px solid ${saving || !ruleName ? BORDER : BLUE}`,
                    borderRadius: 3, color: saving || !ruleName ? MUTED : '#fff',
                    fontFamily: MONO, fontSize: 12,
                    cursor: saving || !ruleName ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Creating...' : 'Create Rule'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* rules list */}
      {rules.length === 0 ? (
        <div style={{
          padding: '48px 0', textAlign: 'center',
          border: `1px solid ${BORDER}`, borderRadius: 2,
          fontFamily: MONO, fontSize: 12, color: MUTED,
          lineHeight: 1.8,
        }}>
          No alert rules configured.<br />
          <span style={{ color: DIM }}>Add a rule to get notified when a verdict fires.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(rule => (
            <AlertRuleCard
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── help view ─────────────────────────────────────────────────────────────────
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false)
  const lines = code.split('\n')
  const isJson = lang === 'json'

  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ position: 'relative', border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ display: 'flex', background: '#0d0d0d' }}>
        {/* line numbers */}
        <div style={{
          padding: '10px 8px', userSelect: 'none',
          fontFamily: MONO, fontSize: 11, lineHeight: 1.6,
          color: DIM, textAlign: 'right',
          borderRight: `1px solid ${BORDER}`,
          minWidth: 32,
        }}>
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        {/* code */}
        <pre style={{
          margin: 0, padding: '10px 12px',
          background: '#0d0d0d',
          fontSize: 11, fontFamily: MONO,
          lineHeight: 1.6, overflowX: 'auto', color: TEXT,
          flex: 1, paddingRight: 52,
        }}>
          {isJson ? lines.map(_tokenizeJsonLine) : code}
        </pre>
      </div>
      <button
        onClick={copy}
        style={{
          position: 'absolute', top: 6, right: 6,
          padding: '2px 8px', background: SURF2,
          border: `1px solid ${BORDER2}`, borderRadius: 2,
          color: copied ? GREEN : DIM,
          fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', cursor: 'pointer',
          transition: 'color 0.15s',
        }}
      >
        {copied ? 'COPIED' : 'COPY'}
      </button>
    </div>
  )
}

function HelpSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', background: SURF2,
          border: 'none', borderBottom: open ? `1px solid ${BORDER}` : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 10, color: DIM, flexShrink: 0 }}>
          {open ? '[-]' : '[+]'}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: TEXT }}>
          {title.toUpperCase().replace(/ /g, '_')}
        </span>
      </button>
      {open && (
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      )}
    </div>
  )
}

function HelpStep({ n, text }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{
        flexShrink: 0, fontFamily: MONO, fontSize: 10,
        color: BLUE, letterSpacing: '0.04em', paddingTop: 1,
        minWidth: 20,
      }}>
        {String(n).padStart(2, '0')}.
      </span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: 1.7 }}>{text}</span>
    </div>
  )
}

function ExternalLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: 'inherit', textDecoration: 'none' }}
      onMouseEnter={e => { e.currentTarget.style.color = '#b45309' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'inherit' }}
    >
      {children}
    </a>
  )
}

function HelpSubSection({ title, children }) {
  return (
    <div style={{ borderLeft: `2px solid ${BORDER2}`, paddingLeft: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: BLUE, letterSpacing: '0.1em', marginBottom: 10 }}>
        {title.toUpperCase()}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function HelpView() {
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: DIM, marginBottom: 16 }}>HELP_DOCS</div>

      <HelpSection title="Connecting Claude Code">
        <HelpStep n={1} text="Install the proxy and start the backend." />
        <CodeBlock code={`pip install receipts-mcp

cd /path/to/receipts/backend
RECEIPT_SECRET=your-secret \\
API_KEYS="proxy:proxy:your-proxy-key" \\
python3 -m uvicorn main:app --port 8000`} />

        <HelpStep n={2} text="Add the MCP server config to ~/.claude/claude_mcp_config.json." />
        <CodeBlock lang="json" code={`{
  "mcpServers": {
    "receipts": {
      "command": "python3",
      "args": ["-m", "receipts_mcp"],
      "env": {
        "RECEIPTS_URL": "http://localhost:8000",
        "RECEIPTS_API_KEY": "your-proxy-key"
      }
    }
  }
}`} />

        <HelpStep n={3} text="Restart Claude Code. Tool calls will now route through Receipts automatically. Every tool call appears in the Live Ledger." />

        <HelpStep n={4} text="Verify it's working — open a new Claude Code session and ask it to write a file or make a fetch call. You should see a receipt appear in the Live Ledger within seconds." />
      </HelpSection>

      <HelpSection title="Connecting Cursor">
        <HelpStep n={1} text="Open Cursor Settings → Features → MCP Servers." />

        <HelpStep n={2} text="Add the Receipts server." />
        <CodeBlock lang="json" code={`{
  "receipts": {
    "command": "python3",
    "args": ["-m", "receipts_mcp"],
    "env": {
      "RECEIPTS_URL": "http://localhost:8000",
      "RECEIPTS_API_KEY": "your-proxy-key"
    }
  }
}`} />

        <HelpStep n={3} text="Restart Cursor. File edits, terminal commands, and web fetches will generate signed receipts visible in the Live Ledger." />
      </HelpSection>

      <HelpSection title="Setting up Alerts">

        <HelpSubSection title="Slack">
          <HelpStep n={1} text={<>Go to <ExternalLink href="https://api.slack.com/apps">api.slack.com/apps</ExternalLink> and create a new app.</>} />
          <HelpStep n={2} text="Enable Incoming Webhooks." />
          <HelpStep n={3} text="Add a webhook to your workspace." />
          <HelpStep n={4} text="Copy the webhook URL." />
          <HelpStep n={5} text="Go to Alerts → Add Rule → Slack." />
          <HelpStep n={6} text="Paste the URL and click Create Rule." />
          <HelpStep n={7} text="Hit Test to confirm delivery." />
        </HelpSubSection>

        <HelpSubSection title="Gmail">
          <div style={{ fontFamily: SANS, fontSize: 12, color: MUTED, lineHeight: 1.6, padding: '8px 10px', background: SURF2, border: `1px solid ${BORDER}`, borderRadius: 3 }}>
            Gmail requires an App Password — your regular password will not work.
          </div>
          <HelpStep n={1} text={<>Go to <ExternalLink href="https://myaccount.google.com/apppasswords">myaccount.google.com/apppasswords</ExternalLink>.</>} />
          <HelpStep n={2} text='Generate a new app password for "Mail".' />
          <HelpStep n={3} text="Copy the 16-character password." />
          <HelpStep n={4} text="Go to Alerts → Add Rule → Email." />
          <HelpStep n={5} text="Enter smtp.gmail.com, port 587, your Gmail address, and the app password." />
        </HelpSubSection>

        <HelpSubSection title="Alertmanager">
          <div style={{ fontFamily: SANS, fontSize: 12, color: TEXT, lineHeight: 1.6 }}>
            Alertmanager accepts webhook notifications. Use the Webhook channel with your Alertmanager receiver URL:
          </div>
          <CodeBlock code="http://your-alertmanager:9093/api/v1/alerts" />
          <div style={{ fontFamily: SANS, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
            Receipts will POST a JSON payload on every verdict. Configure your Alertmanager receiver to parse the <code style={{ fontFamily: MONO, fontSize: 11 }}>verdict</code> and <code style={{ fontFamily: MONO, fontSize: 11 }}>session_id</code> fields.
          </div>
        </HelpSubSection>

        <HelpSubSection title="Custom Webhooks">
          <div style={{ fontFamily: SANS, fontSize: 12, color: TEXT, lineHeight: 1.6 }}>
            Any service that accepts HTTP POST requests works as a Receipts alert destination. The payload shape:
          </div>
          <CodeBlock lang="json" code={`{
  "event": "verdict.contradicted",
  "verdict": "CONTRADICTED",
  "session_id": "...",
  "receipt_id": "...",
  "tool_name": "delete_file",
  "timestamp": "...",
  "input_hash": "sha256:...",
  "output_hash": "sha256:...",
  "hmac_signature": "...",
  "source": "receipts-v1"
}`} />
        </HelpSubSection>

      </HelpSection>

    </div>
  )
}

// ── settings view ─────────────────────────────────────────────────────────────
function SettingsView({ showFullHashes, setShowFullHashes }) {
  const settings = [
    ['BACKEND_URL',          'http://localhost:8000'],
    ['SIGNING_ALGORITHM',    'HMAC-SHA256'],
    ['HASH_FUNCTION',        'SHA-256 (sort_keys=True)'],
    ['STORAGE',              'SQLITE'],
    ['RECEIPT_VERSION',      'v1'],
    ['AUTO_REFRESH_INTERVAL','3s'],
    ['RECEIPT_SECRET',       '•••••••••••'],
  ]

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: DIM, marginBottom: 12 }}>CONFIG_SYS</div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden', marginBottom: 20 }}>
        {settings.map(([key, val], i) => (
          <div key={key} style={{
            display: 'grid',
            gridTemplateColumns: '220px 1fr',
            gap: 16,
            padding: '11px 16px',
            borderBottom: i < settings.length - 1 ? `1px solid ${BORDER}` : 'none',
            alignItems: 'center',
            background: i % 2 === 1 ? SURF2 : 'transparent',
          }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: DIM }}>{key}</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: TEXT }}>{val}</span>
          </div>
        ))}
      </div>

      {/* show raw hashes toggle */}
      <div style={{
        padding: '14px 16px',
        background: SURF,
        border: `1px solid ${BORDER}`,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', color: TEXT, marginBottom: 3 }}>SHOW_RAW_HASHES</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, letterSpacing: '0.05em' }}>
            DISPLAY FULL HASHES INSTEAD OF TRUNCATED
          </div>
        </div>
        <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 20, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showFullHashes}
            onChange={e => setShowFullHashes(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 10,
            background: showFullHashes ? BLUE : BORDER2,
            transition: 'background 0.2s',
            border: `1px solid ${showFullHashes ? BLUE : BORDER}`,
          }} />
          <span style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            left: showFullHashes ? 22 : 2,
            width: 16, height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 150ms ease',
          }} />
        </label>
      </div>
    </div>
  )
}

// ── generate report ───────────────────────────────────────────────────────────
async function generateReport(setToast) {
  try {
    const [rr, sr] = await Promise.all([
      apiFetch('/receipts/all').then(r => r.json()),
      apiFetch('/stats').then(r => r.json()),
    ])
    const report = {
      generated_at: new Date().toISOString(),
      summary: sr,
      receipts: rr,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href     = url
    a.download = `receipts-audit-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
    setToast('Report downloaded')
  } catch {
    setToast('Failed to generate report')
  }
}

// ── app root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]               = useState('ledger')
  const [viewAnim, setViewAnim]       = useState(null)
  const [proxyOnline, setProxyOnline] = useState(false)
  const [toast, setToast]             = useState(null)
  const [showFullHashes, setShowFullHashes] = useState(false)
  const [reconcileSession, setReconcileSession] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // poll proxy status every 5s
  useEffect(() => {
    async function check() {
      try {
        const r = await apiFetch('/stats')
        setProxyOnline(r.ok)
      } catch {
        setProxyOnline(false)
      }
    }
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [])

  function switchView(next) {
    if (next === view || viewAnim) return
    setViewAnim('exit')
    setTimeout(() => {
      setView(next)
      setViewAnim('enter')
      setTimeout(() => setViewAnim(null), 220)
    }, 150)
  }

  function goReconcile(sessionId) {
    setReconcileSession(sessionId)
    switchView('reconciliation')
  }

  const contentClass = viewAnim === 'exit' ? 'view-exit' : viewAnim === 'enter' ? 'view-enter' : ''

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: BG,
      color: TEXT,
      fontFamily: SANS,
      fontSize: 13,
      lineHeight: 1.5,
      WebkitFontSmoothing: 'antialiased',
    }}>
      <Sidebar
        view={view}
        setView={switchView}
        proxyOnline={proxyOnline}
        onReport={() => generateReport(setToast)}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
      />

      <div style={{ marginLeft: sidebarCollapsed ? SIDEBAR_W_COL : SIDEBAR_W, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', transition: 'margin-left 0.18s ease' }}>
        <Header view={view} proxyOnline={proxyOnline} sidebarW={sidebarCollapsed ? SIDEBAR_W_COL : SIDEBAR_W} />

        <main
          className={contentClass}
          style={{ marginTop: 48, padding: 24 }}
        >
          {view === 'ledger' && (
            <LedgerView showFullHashes={showFullHashes} onReconcile={goReconcile} proxyOnline={proxyOnline} />
          )}
          {view === 'sessions' && (
            <SessionsView onReconcile={goReconcile} />
          )}
          {view === 'reconciliation' && (
            <ReconciliationView
              initialSession={reconcileSession}
              onClearInitial={() => setReconcileSession(null)}
            />
          )}
          {view === 'alerts' && (
            <AlertsView />
          )}
          {view === 'help' && (
            <HelpView />
          )}
          {view === 'settings' && (
            <SettingsView
              showFullHashes={showFullHashes}
              setShowFullHashes={setShowFullHashes}
            />
          )}
        </main>
      </div>

      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </div>
  )
}
