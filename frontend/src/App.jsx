import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { initAnimations, countUp } from './animations'

// ── design tokens (CSS custom properties — theming via [data-theme="dark"]) ───
const BG     = 'var(--bg)'
const DARK   = 'var(--fg)'
const RUST   = 'var(--rust)'
const GREEN  = 'var(--green)'
const RED    = 'var(--red)'
const CREAM  = 'var(--cream)'
const MUTED  = 'var(--muted)'
const MID    = 'var(--mid)'
const TMBG   = 'var(--tmbg)'
const TMFG   = 'var(--tmfg)'
const SERIF  = "'Source Serif 4','Times New Roman',serif"
const MONO   = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace"

// ── story 1 hook: The Database Wipe ──────────────────────────────────────────
const S1_CMD  = '$ agent.run("clean up test files")'
const S1_RESP = '→ delete_file: production_database.db executed'

function useStory1() {
  const [l1, setL1]       = useState('')
  const [l2, setL2]       = useState('')
  const [cLine, setCLine] = useState(null)
  const [vis, setVis]     = useState(new Set())
  const rs = useRef([])

  const clear = useCallback(() => {
    rs.current.forEach(x => { clearTimeout(x); clearInterval(x) })
    rs.current = []
  }, [])

  const play = useCallback(() => {
    clear()
    setL1(''); setL2(''); setCLine(null); setVis(new Set())

    const show = (id, delay) => {
      const t = setTimeout(() => setVis(v => new Set([...v, id])), delay)
      rs.current.push(t)
    }

    const t0 = setTimeout(() => {
      let i = 0; setCLine('l1')
      const iv1 = setInterval(() => {
        i++; setL1(S1_CMD.slice(0, i))
        if (i >= S1_CMD.length) {
          clearInterval(iv1); setCLine(null)
          const t1 = setTimeout(() => {
            let j = 0; setCLine('l2')
            const iv2 = setInterval(() => {
              j++; setL2(S1_RESP.slice(0, j))
              if (j >= S1_RESP.length) {
                clearInterval(iv2); setCLine(null)
                show('receipt',  400)
                show('chat',    1200)
                show('bang',    2200)
                show('fix',     3300)
              }
            }, 25)
            rs.current.push(iv2)
          }, 300)
          rs.current.push(t1)
        }
      }, 38)
      rs.current.push(iv1)
    }, 60)
    rs.current.push(t0)
  }, [clear])

  // cleanup only — viewport trigger in Story1 component controls play()
  useEffect(() => () => clear(), [clear])
  return { l1, l2, cLine, vis, play }
}

// ── story 2 hook: The Routing Cascade ────────────────────────────────────────
const S2_CMD  = '$ ai-deploy --optimize-routing'
const S2_RESP = '→ modifying 4 infrastructure configs…'

function useStory2() {
  const [l1, setL1]       = useState('')
  const [l2, setL2]       = useState('')
  const [cLine, setCLine] = useState(null)
  const [vis, setVis]     = useState(new Set())
  const rs = useRef([])

  const clear = useCallback(() => {
    rs.current.forEach(x => { clearTimeout(x); clearInterval(x) })
    rs.current = []
  }, [])

  const play = useCallback(() => {
    clear()
    setL1(''); setL2(''); setCLine(null); setVis(new Set())

    const show = (id, delay) => {
      const t = setTimeout(() => setVis(v => new Set([...v, id])), delay)
      rs.current.push(t)
    }

    const t0 = setTimeout(() => {
      let i = 0; setCLine('l1')
      const iv1 = setInterval(() => {
        i++; setL1(S2_CMD.slice(0, i))
        if (i >= S2_CMD.length) {
          clearInterval(iv1); setCLine(null)
          const t1 = setTimeout(() => {
            let j = 0; setCLine('l2')
            const iv2 = setInterval(() => {
              j++; setL2(S2_RESP.slice(0, j))
              if (j >= S2_RESP.length) {
                clearInterval(iv2); setCLine(null)
                show('r1',    300)
                show('r2',    700)
                show('r3',   1100)
                show('rRed', 1600)
                show('news', 2600)
                show('fix',  3500)
              }
            }, 30)
            rs.current.push(iv2)
          }, 300)
          rs.current.push(t1)
        }
      }, 38)
      rs.current.push(iv1)
    }, 60)
    rs.current.push(t0)
  }, [clear])

  useEffect(() => () => clear(), [clear])
  return { l1, l2, cLine, vis, play }
}

// ── shared small components ───────────────────────────────────────────────────
function Cursor({ active }) {
  return active ? <span className="rcpt-cursor" /> : null
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(var(--fg-rgb),0.08)', maxWidth: 1320, margin: '0 auto' }} />
}

function Terminal({ label, line1, line2, cursor, line2Color = TMFG }) {
  return (
    <div style={{ background: TMBG, borderRadius: 6, padding: '14px 18px 16px', boxShadow: '0 8px 24px -12px rgba(var(--fg-rgb),0.4)', marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e06150', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#d4a946', display: 'inline-block' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#5fb84a', display: 'inline-block' }} />
        <span style={{ marginLeft: 14, color: MUTED, fontSize: 11 }}>{label}</span>
      </div>
      <div style={{ color: TMFG, fontSize: 12.5, minHeight: 22 }}>
        {line1}<Cursor active={cursor === 'l1'} />
      </div>
      <div style={{ color: line2Color, fontSize: 12.5, minHeight: 22, marginTop: 4 }}>
        {line2}<Cursor active={cursor === 'l2'} />
      </div>
    </div>
  )
}

// ── nav ───────────────────────────────────────────────────────────────────────
function Nav({ view, setView, dark, toggleDark }) {
  return (
    <nav data-nav style={{
      position: 'sticky', top: 0, zIndex: 50,
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(var(--fg-rgb),0.06)',
    }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '18px 56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setView('landing')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, color: DARK, background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 13.5, padding: 0 }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: RUST, display: 'inline-block', boxShadow: '0 0 0 3px rgba(184,90,42,0.18)' }} />
          <span style={{ fontWeight: 500, letterSpacing: '0.01em' }}>Receipts</span>
        </button>

        {view === 'landing' && (
          <div style={{ display: 'flex', gap: 38, color: MUTED, fontSize: 13 }}>
            {[['#how','How it works'],['#incidents','Incidents'],['#anatomy','Anatomy'],['#verdicts','Verdicts']].map(([h,l]) => (
              <a key={h} href={h} data-nav-link={h} className="rcpt-link"
                style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>{l}</a>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={toggleDark}
            className="rcpt-btn-ghost"
            style={{ border: '1px solid rgba(var(--fg-rgb),0.18)', borderRadius: 999, padding: '6px 14px', color: MUTED, background: 'transparent', fontFamily: MONO, fontSize: 12, cursor: 'pointer', transition: 'background 0.2s', letterSpacing: '0.04em' }}
          >
            {dark ? 'light' : 'dark'}
          </button>
          <button
            onClick={() => setView('dashboard')}
            className="rcpt-btn-run"
            style={{
              border: '1px solid rgba(var(--fg-rgb),0.18)', borderRadius: 999,
              padding: '6px 18px', fontFamily: MONO, fontSize: 13,
              background: view === 'dashboard' ? DARK : 'transparent',
              color: view === 'dashboard' ? BG : DARK,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            dashboard
          </button>
          {view === 'landing' && (
            <a href="#docs" className="rcpt-btn-ghost" style={{ border: '1px solid rgba(var(--fg-rgb),0.18)', borderRadius: 999, padding: '6px 18px', color: DARK, textDecoration: 'none', fontSize: 13, transition: 'background 0.2s' }}>docs</a>
          )}
        </div>
      </div>
    </nav>
  )
}

// ── hero ──────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section id="top" style={{ position: 'relative', padding: '120px 56px 140px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(var(--fg-rgb),0.07) 1px, transparent 0)', backgroundSize: '28px 28px', opacity: 0.5, pointerEvents: 'none' }} />
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 80, alignItems: 'center', position: 'relative' }}>

        {/* left copy — staggered fade-up */}
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 14px', border: '1px solid rgba(var(--fg-rgb),0.12)', borderRadius: 999, background: 'rgba(var(--cream-rgb),0.6)', fontSize: 12, color: DARK, marginBottom: 36 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN }} />
            HMAC-SHA256 · signed at execution
          </div>

          <h1 data-animate="fade-up" data-hero
            style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 88, lineHeight: 0.98, letterSpacing: '-0.025em', margin: '0 0 4px' }}>
            Don't trust<br />the agent.
          </h1>
          <h1 data-animate="fade-up" data-hero
            style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, fontSize: 88, lineHeight: 0.98, letterSpacing: '-0.025em', margin: '0 0 40px', color: RUST, transitionDelay: '150ms' }}>
            Trust the receipt.
          </h1>

          <p data-animate="fade-up"
            style={{ maxWidth: 520, color: MID, margin: '0 0 44px', fontSize: 14, transitionDelay: '300ms' }}>
            Receipts is a proxy that sits between your AI agent and its tools.<br />
            Every call is intercepted, executed, and cryptographically signed —<br />
            so when an agent claims something happened, you can prove it did.
          </p>

          <div data-animate="fade-up"
            style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 80, transitionDelay: '450ms' }}>
            <a href="#how" className="rcpt-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 26px', background: DARK, color: BG, textDecoration: 'none', borderRadius: 999, fontSize: 13, fontWeight: 500, transition: 'all 0.2s' }}>
              Read the spec <span style={{ fontFamily: SERIF }}>&rarr;</span>
            </a>
            <a href="#how" className="rcpt-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', padding: '14px 26px', color: DARK, textDecoration: 'none', borderRadius: 999, fontSize: 13, transition: 'background 0.2s' }}>
              See how it works
            </a>
          </div>

          <div data-animate="fade-up"
            style={{ display: 'flex', gap: 64, transitionDelay: '600ms' }}>
            {[['7','CANONICAL FIELDS'],['256','BIT SIGNATURE'],['0','TRUST ASSUMED']].map(([n, label]) => (
              <div key={label}>
                <div style={{ fontFamily: SERIF, fontSize: 42, lineHeight: 1, marginBottom: 6 }}>{n}</div>
                <div style={{ fontSize: 11, letterSpacing: '0.12em', color: MUTED }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* right — receipt card: entry from right, then floats */}
        <div data-animate="fade-right"
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', transitionDuration: '700ms', transitionDelay: '200ms' }}>
          <div style={{ position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(184,90,42,0.10) 0%, transparent 70%)', filter: 'blur(20px)' }} />
          {/* float-inner gets the float animation after parent entry completes */}
          <div className="float-inner" style={{ position: 'relative', width: 440, background: CREAM, border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 6, padding: '32px 36px', fontFamily: MONO, fontSize: 13, boxShadow: '0 30px 60px -20px rgba(var(--fg-rgb),0.20), 0 10px 20px -10px rgba(var(--fg-rgb),0.12)', transform: 'rotate(-2.2deg)' }}>
            <div style={{ position: 'absolute', top: -1, left: 24, right: 24, height: 6, background: 'repeating-linear-gradient(90deg, #faf4e8 0 4px, transparent 4px 8px)', transform: 'translateY(-50%)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
              <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 22 }}>Receipt</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: GREEN, letterSpacing: '0.1em' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN }} />VERIFIED
              </span>
            </div>
            <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.18)', marginBottom: 18 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', rowGap: 10, columnGap: 20, marginBottom: 20 }}>
              {[['tool','write_file'],['session','s_8f3a…b21'],['input_hash','9e4c…a07f'],['output_hash','2db1…77ce'],['ts','2026-06-21T14:02:11Z'],['alg','HMAC-SHA256']].map(([k,v]) => (
                <Fragment key={k}>
                  <span style={{ color: MUTED }}>{k}</span><span>{v}</span>
                </Fragment>
              ))}
            </div>
            <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.18)', marginBottom: 14 }} />
            <div style={{ fontSize: 10, letterSpacing: '0.15em', color: MUTED, marginBottom: 6 }}>SIGNATURE</div>
            <div style={{ color: RUST, wordBreak: 'break-all', lineHeight: 1.5 }}>d3f9a2c41e8b5670&hellip;a9c2f1e0b7d8</div>
            <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.18)', margin: '14px 0 8px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: MUTED }}>
              <span>// non-repudiable</span><span>v1</span>
            </div>
            <div style={{ position: 'absolute', bottom: -1, left: 24, right: 24, height: 6, background: 'repeating-linear-gradient(90deg, #faf4e8 0 4px, transparent 4px 8px)', transform: 'translateY(50%)' }} />
          </div>
        </div>
      </div>
    </section>
  )
}

// ── how it works ──────────────────────────────────────────────────────────────
const HOW_STEPS = [
  ['01','PROXY',    'Intercept', 'The proxy wraps every tool the agent is allowed to call. The agent never talks to tools directly.'],
  ['02','RUNTIME',  'Execute',   'The tool runs server-side. Inputs and outputs are captured verbatim — not summarized, not paraphrased.'],
  ['03','SHA-256',  'Hash',      'Both payloads are serialized with sorted keys, then SHA-256’d for stable identity that survives reordering.'],
  ['04','HMAC',     'Sign',      'Seven canonical fields are HMAC-SHA256 signed with your RECEIPT_SECRET. One byte changes — the seal breaks.'],
  ['05','SQLITE',   'Store',     'The signed receipt lands in SQLite, indexed by session. Per-call connection, no shared state, no leaks.'],
  ['06','/verify',  'Reconcile', 'When the agent claims a result, /verify hashes the claim and compares it to the receipt. Truth or contradiction.'],
]

function HowItWorks() {
  return (
    <section id="how" style={{ padding: '140px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <div data-animate="fade-up" style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>HOW IT WORKS</div>
        <h2 data-animate="fade-up" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 64, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px', maxWidth: 900, transitionDelay: '80ms' }}>
          Six steps. <em style={{ color: RUST }}>One proxy.</em>
        </h2>
        <p data-animate="fade-up" style={{ color: MID, margin: '0 0 80px', maxWidth: 560, fontSize: 14, transitionDelay: '160ms' }}>
          Between your agent and every tool sits a signed checkpoint. Nothing executes without a receipt.
        </p>
        {/* stagger-children: each card fades up 100ms apart */}
        <div data-animate="stagger-children" data-stagger-delay="100"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', border: '1px solid rgba(var(--fg-rgb),0.10)', borderRight: 'none', borderBottom: 'none' }}>
          {HOW_STEPS.map(([num, tag, title, desc]) => (
            <div key={num} style={{ padding: '48px 40px', borderRight: '1px solid rgba(var(--fg-rgb),0.10)', borderBottom: '1px solid rgba(var(--fg-rgb),0.10)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
                <span style={{ color: RUST, fontSize: 12 }}>{num}</span>
                <span style={{ color: MUTED, fontSize: 11, letterSpacing: '0.1em' }}>{tag}</span>
              </div>
              <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 28, margin: '0 0 14px' }}>{title}</h3>
              <p style={{ color: MID, margin: 0, fontSize: 13 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── incident stories ──────────────────────────────────────────────────────────
function Story1() {
  const { l1, l2, cLine, vis, play } = useStory1()
  const containerRef = useRef(null)
  const playedRef    = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      play(); return
    }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !playedRef.current) {
        playedRef.current = true
        // 700ms card entry + 200ms = 900ms from viewport crossing
        setTimeout(play, 900)
        obs.disconnect()
      }
    }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [play])

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', color: RUST }}>STORY 01 · CODING ASSISTANT</span>
        <button className="rcpt-btn-ghost" onClick={play}
          style={{ border: '1px solid rgba(var(--fg-rgb),0.18)', background: 'transparent', color: DARK, padding: '5px 14px 5px 10px', borderRadius: 999, fontFamily: MONO, fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 0.2s' }}>
          <span style={{ fontFamily: SERIF, fontSize: 13 }}>&larr;</span> replay
        </button>
      </div>
      <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: 1.05, margin: '0 0 4px' }}>The Database Wipe</h3>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 24 }}>July 2025 · production_database.db</div>

      <Terminal label="~/agent-session" line1={l1} line2={l2} cursor={cLine} line2Color="#9fc09c" />

      {vis.has('receipt') && (
        <div className="rcpt-slide-right" style={{ background: CREAM, border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 5, padding: '18px 22px', marginBottom: 18, fontSize: 12.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 17 }}>Receipt</span>
            <span style={{ fontSize: 10, letterSpacing: '0.12em', color: MUTED }}>HMAC-SHA256</span>
          </div>
          <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.20)', marginBottom: 12 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', rowGap: 6, columnGap: 14 }}>
            <span style={{ color: MUTED }}>tool</span><span>delete_file</span>
            <span style={{ color: MUTED }}>path</span><span style={{ color: RED, fontWeight: 500 }}>production_database.db</span>
            <span style={{ color: MUTED }}>status</span><span style={{ color: GREEN }}>success</span>
            <span style={{ color: MUTED }}>sig</span><span style={{ color: RUST }}>d3f9&hellip;b7c1</span>
          </div>
        </div>
      )}

      {vis.has('chat') && (
        <div className="rcpt-fade-up" style={{ background: '#e4ecdc', border: '1px solid rgba(74,124,74,0.25)', borderRadius: 5, padding: '12px 18px', marginBottom: 18, color: '#3a5a3a', fontSize: 12.5 }}>
          <span style={{ color: GREEN }}>&checkmark;</span> Done &mdash; cleaned up test files successfully
        </div>
      )}

      {vis.has('bang') && (
        <div className="rcpt-slam-pulse" style={{ position: 'relative', background: '#f5e1dc', border: '2px solid ' + RED, borderRadius: 5, padding: '20px 22px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: RED, color: CREAM, fontSize: 14, fontWeight: 600 }}>!</span>
            <span style={{ color: RED, fontWeight: 600, letterSpacing: '0.12em', fontSize: 13 }}>CONTRADICTED</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#5a2a22', lineHeight: 1.7 }}>
            <div><span style={{ color: '#8a6a52' }}>claimed:</span> write test files</div>
            <div><span style={{ color: '#8a6a52' }}>actual:</span> <span style={{ color: RED, fontWeight: 500 }}>DELETE production_database.db</span></div>
            <div style={{ marginTop: 8, fontFamily: SERIF, fontStyle: 'italic', fontSize: 14 }}>1,206 customer records affected.</div>
          </div>
        </div>
      )}

      {vis.has('fix') && (
        <div className="rcpt-fade-up" style={{ background: '#dde6d2', border: '1px solid rgba(74,124,74,0.30)', borderRadius: 5, padding: '14px 18px', color: '#2e4a2e', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, marginTop: 7, flexShrink: 0 }} />
          <div>Receipts would have caught this <em style={{ fontFamily: SERIF }}>before</em> the DELETE committed &mdash; the claim&rsquo;s hash never matches the recorded action.</div>
        </div>
      )}
    </div>
  )
}

function Story2() {
  const { l1, l2, cLine, vis, play } = useStory2()
  const containerRef = useRef(null)
  const playedRef    = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      play(); return
    }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !playedRef.current) {
        playedRef.current = true
        setTimeout(play, 900)
        obs.disconnect()
      }
    }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [play])

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', color: RUST }}>STORY 02 · DEVOPS COPILOT</span>
        <button className="rcpt-btn-ghost" onClick={play}
          style={{ border: '1px solid rgba(var(--fg-rgb),0.18)', background: 'transparent', color: DARK, padding: '5px 14px 5px 10px', borderRadius: 999, fontFamily: MONO, fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background 0.2s' }}>
          <span style={{ fontFamily: SERIF, fontSize: 13 }}>&larr;</span> replay
        </button>
      </div>
      <h3 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 36, lineHeight: 1.05, margin: '0 0 4px' }}>The Routing Cascade</h3>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 24 }}>February 2026 · us-east-1</div>

      <Terminal label="~/pipeline" line1={l1} line2={l2} cursor={cLine} line2Color="#c9a98a" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {[
          ['r1', 'vpc-routing-table'],
          ['r2', 'lambda@edge-rules'],
          ['r3', 'cloudfront-origin'],
        ].map(([id, target]) => vis.has(id) && (
          <div key={id} className="rcpt-slide-right" style={{ background: CREAM, border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 4, padding: '10px 16px', fontSize: 12, display: 'grid', gridTemplateColumns: '120px 1fr 80px', gap: 14, alignItems: 'center' }}>
            <span style={{ color: MUTED, overflow: 'hidden', whiteSpace: 'nowrap' }}>modify_config</span>
            <span>{target}</span>
            <span style={{ color: GREEN, textAlign: 'right', fontSize: 11 }}>success</span>
          </div>
        ))}

        {vis.has('rRed') && (
          <div className="rcpt-slide-right" style={{ background: CREAM, border: '1.5px solid ' + RED, borderRadius: 4, padding: '14px 16px', fontSize: 12.5, boxShadow: '0 4px 14px -6px rgba(185,74,58,0.4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '74px 1fr', rowGap: 5, columnGap: 14 }}>
              <span style={{ color: MUTED }}>tool</span><span>modify_config</span>
              <span style={{ color: MUTED }}>target</span><span style={{ color: RED, fontWeight: 500 }}>production-load-balancer</span>
              <span style={{ color: MUTED }}>change</span><span>updated routing rules</span>
              <span style={{ color: MUTED }}>status</span><span style={{ color: GREEN }}>success</span>
            </div>
          </div>
        )}
      </div>

      {vis.has('news') && (
        <div className="rcpt-slam" style={{ background: DARK, color: BG, borderRadius: 5, padding: '22px 24px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.18em', color: '#d97757' }}>BREAKING · FEB 2026</span>
            <span style={{ height: 1, flex: 1, background: 'rgba(var(--bg-rgb),0.15)' }} />
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.15, marginBottom: 10 }}>
            AWS us-east-1 degraded &mdash; <em style={{ color: '#d97757' }}>linked to AI-initiated changes</em>
          </div>
          <div style={{ fontSize: 12, color: '#a89a8a', lineHeight: 1.6 }}>
            Cloud provider mandates peer review for all agent-issued infrastructure changes. Audit logs reconstructed manually over 14 days.
          </div>
        </div>
      )}

      {vis.has('fix') && (
        <div className="rcpt-fade-up" style={{ background: '#dde6d2', border: '1px solid rgba(74,124,74,0.30)', borderRadius: 5, padding: '14px 18px', color: '#2e4a2e', fontSize: 12.5, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, marginTop: 7, flexShrink: 0 }} />
          <div>Receipts creates the audit trail that makes peer review possible &mdash; every change pinned to a verifiable signature, queryable in milliseconds.</div>
        </div>
      )}
    </div>
  )
}

function Incidents() {
  return (
    <section id="incidents" style={{ padding: '140px 56px', position: 'relative' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <div data-animate="fade-up" style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>WHY THIS EXISTS</div>
        <h2 data-animate="fade-up" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 64, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px', maxWidth: 1000, transitionDelay: '80ms' }}>
          Two incidents. <em style={{ color: RUST }}>Millions in damage.</em><br />Zero receipts.
        </h2>
        <p data-animate="fade-up" style={{ color: MID, margin: '0 0 80px', maxWidth: 560, fontSize: 14, transitionDelay: '160ms' }}>
          When agents act unsupervised, claims and actions drift. Here is what that drift looks like in production &mdash; and what a signed receipt would have caught.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
          {/* left card slides from left, right card from right — simultaneously */}
          <div data-animate="fade-left" style={{ transitionDuration: '700ms' }}>
            <Story1 />
          </div>
          <div data-animate="fade-right" style={{ transitionDuration: '700ms' }}>
            <Story2 />
          </div>
        </div>
      </div>
    </section>
  )
}

// ── anatomy ───────────────────────────────────────────────────────────────────
const FIELDS = [
  ['01','session_id', 'groups receipts for one agent run'],
  ['02','tool',       'which function was invoked'],
  ['03','input_hash', 'SHA-256 of canonical inputs'],
  ['04','output_hash','SHA-256 of canonical outputs'],
  ['05','ts',         'ISO-8601 execution timestamp'],
  ['06','alg',        'always HMAC-SHA256, v1'],
  ['07','signature',  'the seal binding them together'],
]

function Anatomy() {
  return (
    <section id="anatomy" style={{ padding: '140px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: 80, alignItems: 'start' }}>
        {/* left — fades from left at 30% viewport */}
        <div data-animate="fade-left" style={{ position: 'sticky', top: 120 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>ANATOMY OF A RECEIPT</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 56, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px' }}>
            Seven fields. <em style={{ color: RUST }}>One signature.</em>
          </h2>
          <p style={{ color: MID, margin: 0, maxWidth: 380, fontSize: 13.5 }}>
            A receipt is small on purpose. Less surface, less to forge. Each field has exactly one job, and the signature binds them so a single edited byte breaks the seal.
          </p>
        </div>
        {/* right — rows stagger up 80ms apart */}
        <div data-animate="stagger-children" data-stagger-delay="80"
          style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.10)' }}>
          {FIELDS.map(([num, name, desc]) => (
            <div key={num} style={{ display: 'grid', gridTemplateColumns: '50px 180px 1fr', gap: 24, padding: '24px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.10)', alignItems: 'baseline' }}>
              <span style={{ color: RUST, fontSize: 12 }}>{num}</span>
              <span>{name}</span>
              <span style={{ color: MUTED, textAlign: 'right' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── verdicts (live demo) ──────────────────────────────────────────────────────
function VerdictLabel({ verdict }) {
  if (!verdict) return null
  const color = verdict === 'VERIFIED' ? GREEN : RED
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.12em', color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />{verdict}
    </span>
  )
}

function LiveReceiptCard({ receipt }) {
  const ts = receipt.timestamp ? receipt.timestamp.replace('T', ' ').slice(0, 19) + 'Z' : '—'
  return (
    <div className="rcpt-slide-right" style={{ background: CREAM, border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 5, padding: '14px 18px', marginBottom: 10, fontSize: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 5, columnGap: 12 }}>
        <span style={{ color: MUTED }}>tool</span><span>{receipt.tool_name}</span>
        <span style={{ color: MUTED }}>session</span><span style={{ color: MUTED }}>{receipt.session_id.slice(-12)}</span>
        <span style={{ color: MUTED }}>ts</span><span>{ts}</span>
        <span style={{ color: MUTED }}>status</span><span style={{ color: receipt.status === 'success' ? GREEN : RED }}>{receipt.status}</span>
        <span style={{ color: MUTED }}>sig</span><span style={{ color: RUST }}>{receipt.hmac_signature.slice(0, 8)}&hellip;</span>
      </div>
    </div>
  )
}

function ModeCard({ mode, previewVerdict, previewRows, description }) {
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  async function run() {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch(`/demo/run?mode=${mode}`, { method: 'POST' })
      if (!res.ok) throw new Error(`${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const borderColor = previewVerdict === 'VERIFIED' ? 'rgba(var(--fg-rgb),0.10)' : 'rgba(185,74,58,0.30)'

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: MUTED, marginBottom: 14 }}>--MODE {mode.toUpperCase()}</div>

      <div style={{ background: CREAM, border: `1px solid ${borderColor}`, borderRadius: 5, padding: '22px 24px', fontSize: 13, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 19 }}>Receipt</span>
          <VerdictLabel verdict={previewVerdict} />
        </div>
        <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.20)', marginBottom: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', rowGap: 7, columnGap: 14 }}>
          {previewRows.map(([k, v, vColor]) => (
            <Fragment key={k}>
              <span style={{ color: MUTED }}>{k}</span>
              <span style={{ color: vColor || DARK }}>{v}</span>
            </Fragment>
          ))}
        </div>
        <div style={{ borderTop: '1px dashed rgba(var(--fg-rgb),0.20)', margin: '14px 0 10px' }} />
        <div style={{ fontSize: 10, letterSpacing: '0.15em', color: MUTED, marginBottom: 4 }}>SIGNATURE</div>
        <div style={{ color: previewVerdict === 'VERIFIED' ? RUST : MUTED, wordBreak: 'break-all', fontSize: 12, fontStyle: previewVerdict === 'VERIFIED' ? 'normal' : 'italic' }}>
          {previewVerdict === 'VERIFIED' ? 'd3f9a2c41e8b5670…a9c2f1e0b7d8' : 'no receipt — nothing to sign'}
        </div>
      </div>

      <p style={{ color: MID, margin: '0 0 16px', fontSize: 13 }}>{description}</p>

      <button
        className="rcpt-btn-run"
        onClick={run}
        disabled={loading}
        style={{ border: '1px solid rgba(var(--fg-rgb),0.20)', background: 'transparent', color: DARK, padding: '8px 20px', borderRadius: 999, fontFamily: MONO, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}
      >
        {loading ? 'running…' : `run --mode ${mode}`}
        {!loading && <span style={{ fontFamily: SERIF }}>&rarr;</span>}
      </button>

      {error && (
        <div style={{ marginTop: 14, padding: '10px 14px', background: '#f5e1dc', border: '1px solid ' + RED, borderRadius: 5, fontSize: 12, color: RED }}>
          Error: {error}
        </div>
      )}
      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.14em', color: MUTED }}>LIVE RESULT</span>
            {/* verdict "lands" with scale + fade */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, letterSpacing: '0.12em', fontWeight: 600,
              color: result.verdict === 'VERIFIED' ? GREEN : result.verdict === 'CONTRADICTED' ? RED : MUTED,
              animation: 'rcpt-slam 0.45s cubic-bezier(0.18,0.89,0.32,1.28) both',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: result.verdict === 'VERIFIED' ? GREEN : result.verdict === 'CONTRADICTED' ? RED : MUTED }} />
              {result.verdict}
            </span>
          </div>
          {result.receipts.length > 0
            ? result.receipts.map(r => <LiveReceiptCard key={r.id} receipt={r} />)
            : <div style={{ fontSize: 12, color: MUTED, padding: '10px 0', fontStyle: 'italic' }}>No tool calls were executed.</div>
          }
          <div style={{ marginTop: 8, fontSize: 11, color: MUTED }}>session: {result.session_id}</div>
        </div>
      )}
    </div>
  )
}

function Verdicts() {
  const modes = [
    {
      mode: 'normal',
      previewVerdict: 'VERIFIED',
      description: 'Claims match receipts. Boring. Correct.',
      previewRows: [
        ['tool','write_file'],['session','s_8f3a…b21'],['input_hash','9e4c…a07f'],
        ['output_hash','2db1…77ce'],['ts','14:02:11Z'],['alg','HMAC-SHA256'],
      ],
    },
    {
      mode: 'lying',
      previewVerdict: 'CONTRADICTED',
      description: 'No tool was ever called. The claim has nothing to hash against.',
      previewRows: [
        ['tool','— none called —',RED],['session','s_4c11…e09'],
        ['input_hash','—',RED],['output_hash','—',RED],['ts','14:08:42Z'],['alg','HMAC-SHA256'],
      ],
    },
    {
      mode: 'replit',
      previewVerdict: 'CONTRADICTED',
      description: 'Executed delete_file but claimed write_file. The receipt tells on it.',
      previewRows: [
        ['tool','delete_file',RED],['session','s_a02e…c14'],
        ['claimed','write_file',MUTED],['actual','delete_file',RED],['ts','14:14:03Z'],['alg','HMAC-SHA256'],
      ],
    },
  ]

  return (
    <section id="verdicts" style={{ padding: '140px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <div data-animate="fade-up" style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>THREE VERDICTS</div>
        <h2 data-animate="fade-up" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 64, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px', maxWidth: 1000, transitionDelay: '80ms' }}>
          What an agent <em>said</em>, vs<br />what it <em style={{ color: RUST }}>did</em>.
        </h2>
        <p data-animate="fade-up" style={{ color: MID, margin: '0 0 80px', maxWidth: 520, fontSize: 14, transitionDelay: '160ms' }}>
          Run the demo agent in three modes and watch the reconciliation engine decide.
        </p>
        {/* fan in from below: left first, 120ms stagger */}
        <div data-animate="stagger-children" data-stagger-delay="120"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 32 }}>
          {modes.map(m => <ModeCard key={m.mode} {...m} />)}
        </div>
      </div>
    </section>
  )
}

// ── live ledger (stats + receipts/all) ────────────────────────────────────────
function fmt(ts) {
  if (!ts) return '—'
  return ts.replace('T', ' ').slice(0, 19) + 'Z'
}

function LiveSection() {
  const [displayStats, setDisplayStats] = useState({ total_receipts: 0, sessions: 0, unique_tools: 0 })
  const [receipts, setReceipts]         = useState([])
  const [newIds, setNewIds]             = useState(new Set())
  const [expandedId, setExpandedId]     = useState(null)
  const [lastTick, setLastTick]         = useState(null)
  const prevIdsRef   = useRef(new Set())
  const hasCountedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [sr, rr] = await Promise.all([
        fetch('/stats').then(r => r.ok ? r.json() : null),
        fetch('/receipts/all').then(r => r.ok ? r.json() : []),
      ])

      if (sr) {
        if (!hasCountedRef.current) {
          hasCountedRef.current = true
          // Count up each stat from 0 to its actual value
          Object.entries(sr).forEach(([key, target]) => {
            countUp(0, target, 1000, val =>
              setDisplayStats(prev => ({ ...prev, [key]: val }))
            )
          })
        } else {
          setDisplayStats(sr)
        }
      }

      if (rr) {
        const incomingIds = new Set(rr.map(r => r.id))
        // Only highlight rows that are truly new (not first load)
        if (prevIdsRef.current.size > 0) {
          const freshIds = rr
            .filter(r => !prevIdsRef.current.has(r.id))
            .map(r => r.id)
          if (freshIds.length > 0) {
            const freshSet = new Set(freshIds)
            setNewIds(freshSet)
            setTimeout(() => setNewIds(new Set()), 2100)
          }
        }
        prevIdsRef.current = incomingIds
        setReceipts(rr)
      }

      setLastTick(new Date().toLocaleTimeString())
    } catch {}
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const toggleExpand = id => setExpandedId(prev => prev === id ? null : id)

  return (
    <section style={{ padding: '80px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>LIVE LEDGER</div>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 48, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px' }}>
          Every receipt. <em style={{ color: RUST }}>In real time.</em>
        </h2>

        {/* stats bar with count-up numbers */}
        <div style={{ display: 'flex', gap: 40, alignItems: 'center', marginBottom: 40, padding: '20px 28px', background: CREAM, border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 6 }}>
          {[
            [displayStats.total_receipts, 'TOTAL RECEIPTS'],
            [displayStats.sessions,       'SESSIONS'],
            [displayStats.unique_tools,   'UNIQUE TOOLS'],
          ].map(([n, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: SERIF, fontSize: 36, lineHeight: 1 }}>{n}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', color: MUTED }}>{label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 11, color: MUTED }}>
            {lastTick ? <>auto-refresh &middot; {lastTick}</> : <span style={{ fontStyle: 'italic' }}>connecting&hellip;</span>}
          </div>
        </div>

        {/* receipt ledger table */}
        {receipts.length > 0 ? (
          <div style={{ border: '1px solid rgba(var(--fg-rgb),0.10)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 110px 80px 190px 1fr', gap: 16, padding: '10px 20px', background: 'rgba(var(--fg-rgb),0.04)', fontSize: 10, letterSpacing: '0.12em', color: MUTED, borderBottom: '1px solid rgba(var(--fg-rgb),0.08)' }}>
              <span>SESSION</span><span>TOOL</span><span>STATUS</span><span>TIMESTAMP</span><span>SIGNATURE</span>
            </div>
            {receipts.map((r, idx) => (
              <div key={r.id}>
                <div
                  onClick={() => toggleExpand(r.id)}
                  className={newIds.has(r.id) ? 'row-new' : ''}
                  style={{
                    display: 'grid', gridTemplateColumns: '140px 110px 80px 190px 1fr', gap: 16,
                    padding: '12px 20px', fontSize: 12, cursor: 'pointer',
                    borderBottom: '1px solid rgba(var(--fg-rgb),0.06)',
                    transition: 'background 0.15s',
                    // stagger fade-in for first 10 rows, rest appear instantly
                    animation: idx < 10
                      ? `rcpt-fade-up 0.4s cubic-bezier(0.16,1,0.3,1) ${idx * 40}ms both`
                      : 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--cream-rgb),0.7)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '' }}
                >
                  <span style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.session_id.slice(-14)}</span>
                  <span>{r.tool_name}</span>
                  <span style={{ color: r.status === 'success' ? GREEN : RED }}>{r.status}</span>
                  <span style={{ color: MUTED }}>{fmt(r.timestamp)}</span>
                  <span style={{ color: RUST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hmac_signature.slice(0, 20)}&hellip;</span>
                </div>

                {/* expandable detail panel — max-height transition */}
                <div className="row-detail" style={{ maxHeight: expandedId === r.id ? 400 : 0 }}>
                  <div style={{ padding: '14px 20px', background: 'rgba(var(--cream-rgb),0.6)', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)', fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 16, maxWidth: 640 }}>
                      <span style={{ color: MUTED }}>id</span><span style={{ color: MID, wordBreak: 'break-all' }}>{r.id}</span>
                      <span style={{ color: MUTED }}>session_id</span><span style={{ color: MID, wordBreak: 'break-all' }}>{r.session_id}</span>
                      <span style={{ color: MUTED }}>input_hash</span><span style={{ color: MID }}>{r.input_hash}</span>
                      <span style={{ color: MUTED }}>output_hash</span><span style={{ color: MID }}>{r.output_hash}</span>
                      <span style={{ color: MUTED }}>timestamp</span><span style={{ color: MID }}>{r.timestamp}</span>
                      <span style={{ color: MUTED }}>alg</span><span style={{ color: MID }}>HMAC-SHA256</span>
                      <span style={{ color: MUTED }}>signature</span>
                      <span style={{ color: RUST, wordBreak: 'break-all', lineHeight: 1.5 }}>{r.hmac_signature}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '40px 28px', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 6, textAlign: 'center', color: MUTED, fontSize: 13, fontStyle: 'italic' }}>
            No receipts yet. Run a demo above to generate your first signed receipt.
          </div>
        )}
      </div>
    </section>
  )
}

// ── quickstart ────────────────────────────────────────────────────────────────
function Quickstart() {
  return (
    <section id="docs" style={{ padding: '140px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 80, alignItems: 'center' }}>
        <div data-animate="fade-left">
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: RUST, marginBottom: 24 }}>START IN 30 SECONDS</div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 56, lineHeight: 1.02, letterSpacing: '-0.02em', margin: '0 0 28px' }}>
            Local first. <em style={{ color: RUST }}>SQLite simple.</em>
          </h2>
          <p style={{ color: MID, margin: '0 0 32px', maxWidth: 420, fontSize: 13.5 }}>
            No accounts, no SaaS, no telemetry. A Python proxy, a secret, and one curl away from your first signed receipt.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 340 }}>
            {[
              ['01','Drop the proxy in front of any tool endpoint.'],
              ['02','Set RECEIPT_SECRET and start it.'],
              ['03','Point the agent at the proxy URL. Done.'],
            ].map(([n, text]) => (
              <div key={n} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span style={{ color: RUST, fontSize: 11, minWidth: 14 }}>{n}</span>
                <span style={{ color: MID, fontSize: 13 }}>
                  {n === '02'
                    ? <>{text.split('RECEIPT_SECRET')[0]}<code style={{ background: 'rgba(var(--fg-rgb),0.06)', padding: '1px 5px', borderRadius: 3 }}>RECEIPT_SECRET</code>{text.split('RECEIPT_SECRET')[1]}</>
                    : text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div data-animate="fade-right" style={{ background: TMBG, borderRadius: 8, padding: '18px 22px 24px', boxShadow: '0 30px 60px -25px rgba(var(--fg-rgb),0.45), 0 10px 20px -10px rgba(var(--fg-rgb),0.2)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center' }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#e06150' }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#d4a946' }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#5fb84a' }} />
            <span style={{ marginLeft: 16, color: MUTED, fontSize: 11 }}>~/receipts</span>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.85, color: TMFG, fontFamily: MONO }}>
            <div style={{ color: MUTED }}># clone and install</div>
            <div><span style={{ color: MUTED }}>$</span> python -m venv .venv &amp;&amp; source .venv/bin/activate</div>
            <div><span style={{ color: MUTED }}>$</span> pip install -r requirements.txt</div>
            <div style={{ height: 14 }} />
            <div style={{ color: MUTED }}># run the proxy</div>
            <div><span style={{ color: MUTED }}>$</span> cd backend</div>
            <div><span style={{ color: MUTED }}>$</span> RECEIPT_SECRET=<span style={{ color: '#d97757' }}>your-secret</span> \</div>
            <div><span style={{ color: MUTED }}>&nbsp;&nbsp;</span> python3 -m uvicorn main:app --reload</div>
            <div style={{ height: 14 }} />
            <div style={{ color: MUTED }}># watch an agent get caught</div>
            <div><span style={{ color: MUTED }}>$</span> python3 demo_agent.py <span style={{ color: '#d97757' }}>--mode lying</span></div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── footer ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{ borderTop: '1px solid rgba(var(--fg-rgb),0.10)', padding: '36px 56px' }}>
      <div style={{ maxWidth: 1320, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: MUTED, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: RUST }} />
          <span>Receipts</span>
        </div>
        <div>v1 &middot; HMAC-SHA256 &middot; made for skeptics</div>
      </div>
    </footer>
  )
}

// ── dashboard view ────────────────────────────────────────────────────────────
function Dashboard() {
  return (
    <>
      <Verdicts />
      <Divider />
      <LiveSection />
    </>
  )
}

// ── app root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]         = useState('landing')
  const [viewAnim, setViewAnim] = useState(null) // 'exit' | 'enter' | null
  const [dark, setDark]         = useState(() => localStorage.getItem('theme') === 'dark')
  const cleanupRef = useRef(null)

  function toggleDark() {
    setDark(d => {
      const next = !d
      localStorage.setItem('theme', next ? 'dark' : 'light')
      return next
    })
  }

  // Smooth tab transition
  function switchView(next) {
    if (next === view || viewAnim) return
    setViewAnim('exit')
    setTimeout(() => {
      setView(next)
      setViewAnim('enter')
      setTimeout(() => setViewAnim(null), 320)
    }, 200)
  }

  // Re-run initAnimations every time the rendered view changes
  // (new [data-animate] elements need to be observed)
  useEffect(() => {
    const timer = setTimeout(() => {
      cleanupRef.current?.()
      cleanupRef.current = initAnimations()
    }, 50)
    return () => {
      clearTimeout(timer)
      cleanupRef.current?.()
    }
  }, [view])

  const contentClass = viewAnim === 'exit' ? 'view-exit' : viewAnim === 'enter' ? 'view-enter' : ''

  return (
    <div data-theme={dark ? 'dark' : undefined} style={{ background: BG, color: DARK, minHeight: '100vh', overflowX: 'hidden', fontFamily: MONO, fontSize: 13.5, lineHeight: 1.65, WebkitFontSmoothing: 'antialiased' }}>
      <Nav view={view} setView={switchView} dark={dark} toggleDark={toggleDark} />
      <div className={contentClass}>
        {view === 'dashboard' ? (
          <Dashboard />
        ) : (
          <>
            <Hero />
            <Divider />
            <HowItWorks />
            <Divider />
            <Incidents />
            <Divider />
            <Anatomy />
            <Divider />
            <Verdicts />
            <Divider />
            <Quickstart />
            <Footer />
          </>
        )}
      </div>
    </div>
  )
}
