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

// ── syntax-highlight JSON (keys blue, strings green, numbers amber) ───────────
function JsonHighlight({ obj }) {
  const json = JSON.stringify(obj, null, 2)
  const lines = json.split('\n').map((line, i) => {
    const parts = []
    // match: "key": value
    const re = /("(?:[^"\\]|\\.)*")(\s*:\s*)?("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)?/g
    let last = 0, m
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(<span key={`t${i}-${last}`}>{line.slice(last, m.index)}</span>)
      // key (followed by colon)
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
  })
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
  { id: 'ledger',         label: 'Live Ledger',    icon: '▤' },
  { id: 'sessions',       label: 'Sessions',       icon: '◈' },
  { id: 'reconciliation', label: 'Reconciliation', icon: '⇌' },
  { id: 'settings',       label: 'Settings',       icon: '⚙' },
]

function Sidebar({ view, setView, proxyOnline, onReport }) {
  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      background: SURF,
      borderRight: `1px solid ${BORDER}`,
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'fixed',
      top: 0, left: 0,
      zIndex: 20,
    }}>
      {/* wordmark */}
      <div style={{ padding: '20px 18px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Dot color={proxyOnline ? GREEN : RED} />
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 500, letterSpacing: '0.08em', color: TEXT }}>
            RECEIPTS
          </span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: DIM, paddingLeft: 14 }}>v1.0.0-stable</div>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 18px',
              background: view === item.id ? SURF2 : 'transparent',
              border: 'none',
              borderLeft: view === item.id ? `2px solid ${BLUE}` : '2px solid transparent',
              color: view === item.id ? TEXT : MUTED,
              fontFamily: SANS,
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 12, opacity: 0.7 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* generate report */}
      <div style={{ padding: '12px 14px', borderTop: `1px solid ${BORDER}` }}>
        <button
          onClick={onReport}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'transparent',
            border: `1px solid ${BORDER2}`,
            borderRadius: 4,
            color: MUTED,
            fontFamily: MONO,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.color = TEXT }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER2; e.currentTarget.style.color = MUTED }}
        >
          Generate Report
        </button>
      </div>
    </aside>
  )
}

// ── header bar ────────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  ledger:         'Live Ledger',
  sessions:       'Sessions',
  reconciliation: 'Reconciliation',
  settings:       'Settings',
}

function Header({ view, proxyOnline }) {
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
      top: 0, left: 220, right: 0,
      zIndex: 10,
    }}>
      <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, color: TEXT }}>
        {VIEW_TITLES[view]}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {proxyOnline ? (
          <>
            <StatusPill color={GREEN} label="Proxy Active" />
            <StatusPill color={GREEN} label="Secret Loaded" />
          </>
        ) : (
          <>
            <StatusPill color={RED} label="Proxy Offline" />
            <StatusPill color={DIM} label="Secret Unknown" dim />
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
      gap: 6,
      padding: '3px 10px',
      border: `1px solid ${dim ? BORDER : color + '33'}`,
      borderRadius: 3,
      fontSize: 11,
      fontFamily: MONO,
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
        borderRadius: 4,
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
  return (
    <div style={{
      flex: 1,
      padding: '16px 20px',
      background: SURF,
      border: `1px solid ${BORDER}`,
      borderRadius: 4,
    }}>
      <div style={{
        fontFamily: MONO,
        fontSize: 28,
        fontWeight: 500,
        color: color || TEXT,
        lineHeight: 1,
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {value}
        {warn && value > 0 && (
          <span style={{ fontSize: 14, color: RED }}>!</span>
        )}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 11, color: MUTED, letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

function LedgerRow({ r, expanded, onToggle, isNew, showFullHashes, onReconcile, sessionPill }) {
  const borderColor =
    r.verdict === 'VERIFIED'     ? GREEN :
    r.verdict === 'CONTRADICTED' ? AMBER :
    r.verdict === 'TAMPERED'     ? RED   :
    r.verdict === 'UNVERIFIED'   ? RED   : BORDER2

  const rowBg = r.verdict === 'TAMPERED' ? 'rgba(239,68,68,0.04)' : 'transparent'

  return (
    <>
      <div
        className={isNew ? 'row-new' : ''}
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '110px 130px 110px 140px 80px 110px',
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
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {showFullHashes ? r.session_id : r.session_id.slice(0, 8) + '...'}
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
        <span style={{ fontFamily: MONO, color: TEXT }}>{r.tool_name}</span>
        <span style={{ fontFamily: MONO, color: MUTED, fontSize: 11 }}>
          {showFullHashes ? r.input_hash : truncHex(r.input_hash)}
        </span>
        <span>
          <Pill color={r.status === 'success' ? GREEN : RED}>{r.status}</Pill>
        </span>
        <span>
          {r.verdict
            ? <Pill color={verdictColor(r.verdict)} bg={r.verdict === 'TAMPERED' ? 'rgba(245,158,11,0.08)' : undefined}>{r.verdict}</Pill>
            : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM, padding: '2px 7px' }}>PENDING</span>
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
                  padding: '5px 12px',
                  background: 'transparent',
                  border: `1px solid ${BORDER2}`,
                  borderRadius: 3,
                  color: MUTED,
                  fontFamily: MONO,
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.color = TEXT }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER2; e.currentTarget.style.color = MUTED }}
              >
                Reconcile this session →
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
        fetch('/stats').then(r => r.ok ? r.json() : null),
        fetch('/receipts/all').then(r => r.ok ? r.json() : null),
        fetch('/sessions').then(r => r.ok ? r.json() : null),
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

  return (
    <div>
      {offline && !offlineDismissed && (
        <OfflineBanner onDismiss={() => setOfflineDismissed(true)} />
      )}

      {/* receipt stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <StatCard label="Total Receipts"  value={displayStats.total_receipts} />
        <StatCard label="Verified Claims" value={displayStats.verified}          color={GREEN} />
        <StatCard label="Successful Calls" value={displayStats.successful_calls} color={BLUE}  />
        <StatCard label="Tamper Alerts"   value={displayStats.tamper_alerts}     color={RED}   warn />
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
            background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
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
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
        {/* header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '110px 130px 110px 140px 80px 110px',
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
          <span>SESSION ID</span>
          <span>TOOL NAME</span>
          <span>INPUT HASH</span>
          <span>STATUS</span>
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
          filtered.map(r => (
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

function SessionsView({ onReconcile }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const data = await fetch('/sessions').then(r => r.json())
        if (active) { setSessions(data); setLoading(false) }
      } catch { if (active) setLoading(false) }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { active = false; clearInterval(t) }
  }, [])

  const COL = '1fr 120px 80px 60px 100px 140px'

  return (
    <div>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
        {/* header */}
        <div style={{
          display: 'grid', gridTemplateColumns: COL, gap: 12,
          padding: '8px 16px', background: SURF2, borderBottom: `1px solid ${BORDER}`,
          fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em',
        }}>
          <span>SESSION ID</span>
          <span>STARTED</span>
          <span>DURATION</span>
          <span>RECEIPTS</span>
          <span>STATUS</span>
          <span>VERDICT</span>
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
          sessions.map(s => (
            <div
              key={s.session_id}
              onClick={() => onReconcile?.(s.session_id)}
              style={{
                display: 'grid', gridTemplateColumns: COL, gap: 12,
                padding: '10px 16px', borderBottom: `1px solid ${BORDER}`,
                cursor: 'pointer', fontSize: 12, alignItems: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = SURF2 }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.session_id}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{fmtTs(s.created_at)}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{fmtDuration(s.created_at, s.closed_at)}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT }}>{s.receipt_count}</span>
              <span><SessionStatusPill session={s} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {s.auto_verdict
                  ? <>
                      <Pill color={verdictColor(s.auto_verdict)} bg={s.auto_verdict === 'TAMPERED' ? 'rgba(245,158,11,0.08)' : undefined}>{s.auto_verdict}</Pill>
                      {s.verification_scope === 'signature_only' && (
                        <span
                          title="Cryptographic integrity verified. Run manual reconciliation to verify agent claims."
                          style={{ fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: '0.04em', cursor: 'help' }}
                        >
                          sig. only
                        </span>
                      )}
                    </>
                  : <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>—</span>
                }
              </span>
            </div>
          ))
        )}
      </div>
      <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: DIM }}>
        Click any row to reconcile that session.
      </div>
    </div>
  )
}

// ── reconciliation view ───────────────────────────────────────────────────────
function ReconcileVerdictBanner({ verdict }) {
  const cfg = {
    VERIFIED:     { color: GREEN, bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.2)',   left: GREEN, text: 'All claims match cryptographic receipts.' },
    UNVERIFIED:   { color: RED,   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   left: RED,   text: 'No receipts found for this session. Agent made claims without executing tools.' },
    CONTRADICTED: { color: AMBER, bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  left: AMBER, text: 'Agent claimed different outputs than what was recorded. See breakdown below.' },
    TAMPERED:     { color: RED,   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(245,158,11,0.2)',  left: RED,   text: 'Receipt signature invalid. Record was modified after execution.' },
  }
  const s = cfg[verdict] ?? cfg.UNVERIFIED
  return (
    <div className="pill-animate" style={{
      padding: '14px 16px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderLeft: `3px solid ${s.left}`,
      borderRadius: 4,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: s.color, letterSpacing: '0.06em', marginBottom: 4 }}>
        {verdict}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 12, color: MUTED }}>{s.text}</div>
    </div>
  )
}

function ReceiptCard({ receipt: r, verdict: v }) {
  const cardVerdict =
    !v              ? null :
    v.signature_valid === false ? 'TAMPERED' :
    v.verified      ? 'VERIFIED' : 'CONTRADICTED'

  const rows = [
    { field: 'tool_name',      actual: r.tool_name,  match: true },
    { field: 'output_hash',    actual: r.output_hash ? r.output_hash.slice(0, 16) + '...' : '—', match: v ? (v.claimed_hash === v.actual_hash) : true },
    { field: 'hmac_signature', actual: v?.signature_valid === false ? 'Invalid' : 'Valid', color: v?.signature_valid === false ? RED : GREEN, match: v ? v.signature_valid !== false : true },
    { field: 'executed_at',    actual: r.timestamp, match: true },
  ]

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
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

      {/* column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '30% 55% 15%',
        padding: '6px 16px', background: SURF,
        borderBottom: `1px solid ${BORDER}`,
        fontSize: 10, fontFamily: MONO, color: DIM, letterSpacing: '0.1em',
      }}>
        <span>FIELD</span><span>ACTUAL</span><span style={{ textAlign: 'center' }}>MATCH</span>
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
          <span style={{ color: MUTED }}>{row.field}</span>
          <span style={{ color: row.color ?? TEXT, wordBreak: 'break-all' }}>{row.actual}</span>
          <span style={{ textAlign: 'center', color: row.match ? GREEN : RED, fontSize: 13 }}>{row.match ? '✓' : '✗'}</span>
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
  const didAutoRunRef                   = useRef(false)

  // Populate sessions dropdown from /sessions (includes auto_verdict)
  useEffect(() => {
    fetch('/sessions')
      .then(r => r.json())
      .then(data => setSessions(data))
      .catch(() => {})
  }, [])

  // When a session with an auto_verdict is selected, show stored result immediately
  const selectedSession = sessions.find(s => s.session_id === selected)

  // Auto-run when arriving from ledger with a pre-selected session.
  // Skip if the session already has a full_claim verdict — show it instead.
  useEffect(() => {
    if (!initialSession || didAutoRunRef.current) return
    didAutoRunRef.current = true
    setSelected(initialSession)
    onClearInitial?.()
    fetch(`/sessions/${initialSession}`)
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s?.verification_scope === 'full_claim') return  // show stored verdict, don't overwrite
        runForSession(initialSession)
      })
      .catch(() => runForSession(initialSession))
  }, [initialSession]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runForSession(sessionId) {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      // 1. Fetch all receipts for this session (includes raw tool_output)
      const rr = await fetch(`/receipts/${sessionId}`).then(r => {
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
      //    persists verification_scope='full_claim' on the session row.
      const verRes = await fetch(`/sessions/${sessionId}/verify-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, claimed_outputs: claimedOutputs }),
      })
      if (!verRes.ok) {
        const body = await verRes.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${verRes.status}`)
      }
      const verData = await verRes.json()

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
        background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
      }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, flexShrink: 0 }}>Session</span>
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
          onClick={() => runForSession(selected)}
          disabled={loading || !selected}
          style={{
            padding: '7px 16px', flexShrink: 0,
            background: loading || !selected ? SURF2 : BLUE,
            border: `1px solid ${loading || !selected ? BORDER : BLUE}`,
            borderRadius: 3,
            color: loading || !selected ? MUTED : '#fff',
            fontFamily: MONO, fontSize: 12,
            cursor: loading || !selected ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.15s',
          }}
        >
          {loading
            ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>Running...</>
            : 'Run Reconciliation'
          }
        </button>
      </div>

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
          padding: '12px 16px', background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill color={verdictColor(selectedSession.auto_verdict)}>{selectedSession.auto_verdict}</Pill>
            {selectedSession.verification_scope === 'signature_only' && (
              <span style={{
                fontFamily: MONO, fontSize: 10, color: DIM,
                padding: '1px 6px', border: `1px solid ${BORDER2}`, borderRadius: 2,
              }}>
                sig. only
              </span>
            )}
            <span style={{ fontFamily: SANS, fontSize: 12, color: MUTED }}>
              {selectedSession.verification_scope === 'signature_only'
                ? 'Signatures intact — agent claim not yet checked.'
                : 'Auto-verified'}{' '}
              {selectedSession.auto_verified_at
                ? `${Math.round((Date.now() - new Date(selectedSession.auto_verified_at)) / 1000)}s ago`
                : ''}
            </span>
          </div>
          <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>
            {selectedSession.verification_scope === 'signature_only'
              ? 'Run Reconciliation to check agent claims.'
              : 'Click Run Reconciliation to re-run.'}
          </span>
        </div>
      )}

      {!result && !loading && !error && !selectedSession?.auto_verdict && (
        <div style={{
          padding: '72px 0', textAlign: 'center',
          border: `1px solid ${BORDER}`, borderRadius: 4, background: SURF,
        }}>
          <div style={{ fontFamily: MONO, fontSize: 13, color: MUTED, marginBottom: 8 }}>
            Select a session above to run reconciliation.
          </div>
          <div style={{ fontFamily: SANS, fontSize: 12, color: DIM }}>
            Receipts will verify each tool call cryptographically.
          </div>
        </div>
      )}

      {loading && (
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
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
          {/* Part A: Verdict banner */}
          <ReconcileVerdictBanner verdict={result.verdict} />

          {/* Part B: Per-receipt cards */}
          {result.receipts.length === 0 ? (
            <div style={{
              padding: '32px', textAlign: 'center',
              border: `1px solid ${BORDER}`, borderRadius: 4,
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
            padding: '10px 14px', gap: 12, flexWrap: 'wrap',
            background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
          }}>
            <div style={{ display: 'flex', gap: 20, fontFamily: MONO, fontSize: 11, color: MUTED, flexWrap: 'wrap' }}>
              <span>Session: {result.session_id}</span>
              <span>{result.receipts.length} receipt{result.receipts.length !== 1 ? 's' : ''} verified</span>
              <span>Generated: {new Date(result.generated_at).toLocaleTimeString()}</span>
            </div>
            <button
              onClick={copyResult}
              style={{
                padding: '5px 12px', background: 'transparent',
                border: `1px solid ${BORDER2}`, borderRadius: 3,
                color: copied ? GREEN : MUTED,
                fontFamily: MONO, fontSize: 11, cursor: 'pointer', flexShrink: 0,
                transition: 'color 0.15s',
              }}
            >
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── settings view ─────────────────────────────────────────────────────────────
function SettingsView({ showFullHashes, setShowFullHashes }) {
  const settings = [
    ['Backend URL',         'http://localhost:8000'],
    ['Signing Algorithm',   'HMAC-SHA256'],
    ['Hash Function',       'SHA-256 (sort_keys=True)'],
    ['Storage',             'SQLite'],
    ['Receipt Version',     'v1'],
    ['Auto-refresh interval','3s'],
    ['RECEIPT_SECRET',      '•••••••••••'],
  ]

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
        {settings.map(([key, val], i) => (
          <div key={key} style={{
            display: 'grid',
            gridTemplateColumns: '200px 1fr',
            gap: 16,
            padding: '12px 16px',
            borderBottom: i < settings.length - 1 ? `1px solid ${BORDER}` : 'none',
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: SANS, fontSize: 13, color: MUTED }}>{key}</span>
            <span style={{ fontFamily: MONO, fontSize: 12, color: TEXT }}>{val}</span>
          </div>
        ))}
      </div>

      {/* show raw hashes toggle */}
      <div style={{
        padding: '14px 16px',
        background: SURF,
        border: `1px solid ${BORDER}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: SANS, fontSize: 13, color: TEXT, marginBottom: 2 }}>Show raw hashes</div>
          <div style={{ fontFamily: SANS, fontSize: 12, color: MUTED }}>
            Display full hashes instead of truncated versions
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
      fetch('/receipts/all').then(r => r.json()),
      fetch('/stats').then(r => r.json()),
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

  // poll proxy status every 5s
  useEffect(() => {
    async function check() {
      try {
        const r = await fetch('/stats')
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
      />

      <div style={{ marginLeft: 220, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header view={view} proxyOnline={proxyOnline} />

        <main
          className={contentClass}
          style={{ marginTop: 48, padding: 24, flex: 1 }}
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
