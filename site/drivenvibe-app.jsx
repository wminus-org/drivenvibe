// drivenvibe — dark "field notes" landing page.
// Deep charcoal ruled page, coral margin line, chalk-cream ink, mint accent,
// highlighter swipes, circled numbers + checkbox lists. Spacing is deliberately
// uneven (offset indents, odd paddings, slight rotations) so it reads hand-made.

const { useState, useEffect, useRef } = React;

const PAPER   = STK.paper;
const INK     = STK.ink;
const MUTED   = STK.muted;
const DIM     = STK.dim;
const RULE    = STK.rule;
const TURQ    = STK.turq;
const TURQ_HI = STK.turqHi;

const FONT_HAND  = STK.hand;   // Caveat — display
const FONT_BODY  = STK.body;   // Kalam — prose
const FONT_PRINT = STK.print;  // Patrick Hand — labels/UI
const FONT_MONO  = STK.mono;

const GITHUB_URL = 'https://github.com/wminus-org/drivenvibe';
// Hosted app is not live yet; every app CTA points at the self-host guide.
const APP_URL = `${GITHUB_URL}#setup`;
const INSTALL_COMMAND = `git clone ${GITHUB_URL}.git
cd drivenvibe
npm install
npm start`;

// ──────────────────────────────────────────────────────────────
// Install modal — npx command + copy button (taped index card)
// ──────────────────────────────────────────────────────────────
function InstallModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy these commands:', INSTALL_COMMAND);
    }
  };
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const controls = [...(dialogRef.current?.querySelectorAll('a[href], button:not([disabled])') || [])];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', k);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', k);
      document.body.style.overflow = oldOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);
  return (
    <div onClick={onClose} role="presentation" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(8,9,12,0.7)',
      backdropFilter: 'blur(5px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: FONT_BODY,
    }}>
      <div ref={dialogRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="install-title" aria-describedby="install-description" style={{
        background: '#1C1F26', color: INK,
        border: `2px solid ${TURQ}`,
        boxShadow: '8px 9px 0 rgba(51,214,198,0.18)',
        padding: '34px 38px 30px', maxWidth: 520, width: '100%',
        position: 'relative', transform: 'rotate(-0.6deg)',
      }}>
        <button ref={closeRef} onClick={onClose} aria-label="Close install guide" style={{
          position: 'absolute', top: 10, right: 16, background: 'none', border: 'none',
          fontSize: 28, color: MUTED, cursor: 'pointer', lineHeight: 1, fontFamily: FONT_HAND,
        }}>×</button>
        <div style={{ fontFamily: FONT_HAND, color: TURQ_HI, fontSize: 26, fontWeight: 600, marginBottom: 2 }}>
          four commands, then talk.
        </div>
        <h2 id="install-title" style={{ fontFamily: FONT_PRINT, fontWeight: 400, fontSize: 27, margin: '0 0 20px', letterSpacing: '0.01em' }}>
          Install the desktop companion:
        </h2>
        <div style={{
          background: '#0E1014', color: '#E9E4D8',
          fontFamily: FONT_MONO, fontSize: 15, padding: '14px 18px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
          border: '1px solid rgba(233,228,216,0.12)', borderRadius: 3,
        }}>
          <code style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.75 }}>
            {INSTALL_COMMAND.split('\n').map((line, index) => (
              <React.Fragment key={line}><span style={{ color: TURQ }}>$ </span>{line}{index < 3 ? '\n' : ''}</React.Fragment>
            ))}
          </code>
          <button onClick={onCopy} style={{
            background: copied ? TURQ : 'transparent',
            color: copied ? '#0c1014' : TURQ,
            border: `1.5px solid ${TURQ}`,
            padding: '4px 11px', fontFamily: FONT_MONO, fontSize: 12,
            fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1.2,
            transition: 'all .15s',
          }} aria-live="polite">{copied ? 'Copied!' : 'Copy'}</button>
        </div>
        <p id="install-description" style={{ fontSize: 16, color: MUTED, margin: '18px 0 0', lineHeight: 1.6 }}>
          Then open the printed local URL, or use a tunnel for access away from home
          (hosted version: coming soon). Your laptop remains the agent runtime.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: 15 }}>
          <a href={`${GITHUB_URL}#setup`} target="_blank" rel="noreferrer" style={{ color: TURQ_HI }}>
            Read the complete setup guide →
          </a>
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Section wrapper — wide outer (for sticker gutters), narrow inner
// reading column. `indent` shifts the inner column for an uneven feel.
// ──────────────────────────────────────────────────────────────
function Section({ id, children, top = 84, bottom = 84, indent = 0, stickers }) {
  return (
    <section id={id} style={{
      position: 'relative',
      padding: `${top}px 0 ${bottom}px`,
      maxWidth: 1080, margin: '0 auto',
    }}>
      {stickers && <div className="dv-marginalia" aria-hidden="true">{stickers}</div>}
      <div className="dv-section-inner" style={{ maxWidth: 620, margin: '0 auto', transform: indent ? `translateX(${indent}px)` : undefined }}>
        {children}
      </div>
    </section>
  );
}

// Section label — looks like a tab written in the margin
const Eyebrow = ({ children, style }) => (
  <div style={{
    fontFamily: FONT_MONO, fontSize: 12, color: TURQ,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 30,
    fontWeight: 600, display: 'inline-block',
    borderBottom: `1.5px solid rgba(51,214,198,0.4)`, paddingBottom: 4,
    ...style,
  }}>{children}</div>
);

// ──────────────────────────────────────────────────────────────
// Header — title scrawl + date in the top corner like a notebook
// ──────────────────────────────────────────────────────────────
function Header() {
  return (
    <header className="dv-header" style={{
      maxWidth: 1080, margin: '0 auto',
      padding: '30px 0 0',
      position: 'relative',
    }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <a href="#main" aria-label="drivenvibe home" style={{ color: INK, textDecoration: 'none', fontWeight: 700, fontSize: 30, fontFamily: FONT_HAND, transform: 'rotate(-2deg)', display: 'inline-block' }}>
            drivenvibe
          </a>
          <nav className="dv-header-nav" aria-label="Primary" style={{ display: 'flex', gap: 22, fontSize: 17, color: MUTED, fontFamily: FONT_PRINT, paddingTop: 8 }}>
            <a className="dv-nav-how" href="#how-it-works" style={{ color: 'inherit', textDecoration: 'none' }}>How it works</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>GitHub</a>
          </nav>
        </div>
        {/* notebook header line */}
        <div className="dv-header-note" style={{ fontFamily: FONT_HAND, color: DIM, fontSize: 21, marginTop: 2, transform: 'rotate(-0.8deg)' }}>
          notebook № 3 · est. Ljubljana · voice-driven field notes
        </div>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────
function Hero({ onInstall }) {
  return (
    <Section
      top={66} bottom={40} indent={-8}
      stickers={
        <React.Fragment>
          <CircleSticker rotate={-12} size={104} top={-8} right={4}>
            voice → code
          </CircleSticker>
          <HandNote rotate={-5} top={286} right={2} width={158} size={23}>
            yes, handwritten.<br/>on purpose ✿
          </HandNote>
          <ArrowDoodle rotate={28} size={66} top={236} right={150} />
          <TagSticker rotate={-6} bottom={20} right={24}>v0.1 beta</TagSticker>
        </React.Fragment>
      }
    >
      <h1 style={{
        fontFamily: FONT_HAND, fontWeight: 700,
        fontSize: 'clamp(46px, 7.5vw, 78px)', lineHeight: 1.08,
        letterSpacing: '0.005em', margin: '0 0 66px',
        textWrap: 'pretty',
      }}>
        Talk to Claude Code.<br/>
        Keep your hands on the&nbsp;
        <span style={{ position: 'relative', color: TURQ_HI, display: 'inline-block' }}>
          wheel.
          <ScribbleUnderline color={TURQ} thick={7} />
        </span>
      </h1>
      <p className="dv-hero-copy" style={{ color: MUTED, fontSize: 20, lineHeight: 1.65, maxWidth: 500, margin: '0 0 34px', paddingLeft: 4 }}>
        drivenvibe turns your phone into a voice interface for Claude Code.
        Your projects, your subscription, your laptop — <Highlight>driven by voice from anywhere.</Highlight>
      </p>
      <div className="dv-hero-actions" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', paddingLeft: 4 }}>
        <a className="dv-primary-cta" href={APP_URL}>Self-host with npx drivenvibe →</a>
        <button className="dv-secondary-cta" onClick={onInstall} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          textDecoration: 'underline', textDecorationThickness: 1.5,
        }}>Install command · hosted version coming soon</button>
      </div>
      <div style={{ marginTop: 22, paddingLeft: 4, fontFamily: FONT_MONO, fontSize: 11, color: DIM, letterSpacing: 0.6 }}>
        OPEN SOURCE · LOCAL-FIRST · USE YOUR CLAUDE SUBSCRIPTION
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// Hero photo — polaroid taped onto the dark page
// ──────────────────────────────────────────────────────────────
function HeroPhoto() {
  return (
    <div className="dv-hero-photo" style={{
      maxWidth: 620, margin: '0 auto', position: 'relative',
      padding: '0 0 72px', transform: 'translateX(14px)',
    }}>
      <div style={{
        position: 'relative',
        transform: 'rotate(-1.6deg)',
        background: '#F3EFE6',
        padding: '14px 14px 18px',
        boxShadow: '0 14px 34px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)',
      }}>
        <div aria-hidden="true" style={{
          position: 'absolute', top: -10, left: '15%', width: 92, height: 22,
          background: 'rgba(51,214,198,0.32)',
          borderLeft: '1px solid rgba(51,214,198,0.5)',
          borderRight: '1px solid rgba(51,214,198,0.5)',
          transform: 'rotate(-6deg)',
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', top: -8, right: '12%', width: 80, height: 22,
          background: 'rgba(244,208,75,0.30)',
          borderLeft: '1px solid rgba(244,208,75,0.5)',
          borderRight: '1px solid rgba(244,208,75,0.5)',
          transform: 'rotate(5deg)',
        }} />
        <img
          src="assets/hero-truck.png"
          alt="Hand-drawn truck carrying stickers for IntelliJ, Claude, ChatGPT, and Cursor"
          width="1448"
          height="1086"
          fetchPriority="high"
          decoding="async"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        <div style={{
          marginTop: 10, textAlign: 'center',
          fontFamily: FONT_HAND, fontSize: 24, color: '#3a352d',
          fontWeight: 600,
        }}>
          fig. 0.1 — the company truck
        </div>
      </div>
      <RectSticker rotate={-8} top={-20} right={-10} bg={TURQ} color="#0c1014" border={TURQ}>
        ★ now shipping
      </RectSticker>
    </div>
  );
}

function ProductPreview() {
  const notes = [
    'Resume the last session in one tap.',
    'Speak naturally or type when it is noisy.',
    'Hear the response without watching the screen.',
  ];
  return (
    <Section id="product" top={78} bottom={80} indent={-4}>
      <Eyebrow>The interface</Eyebrow>
      <h2 style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 44, lineHeight: 1.15, margin: '0 0 34px' }}>
        Built for a glance, not a desk.
      </h2>
      <div className="dv-preview-layout">
        <div className="dv-preview-phone" role="img" aria-label="Preview of the drivenvibe projects and recent-session screen">
          <div style={{ background: '#0b0c0f', borderRadius: 24, minHeight: 494, padding: '19px 16px 18px', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <strong style={{ fontSize: 18, letterSpacing: '-0.4px' }}>drivenvibe</strong>
              <span style={{ color: '#7ee7a0', fontSize: 11, fontWeight: 700 }}>● COMPUTER ONLINE</span>
            </div>
            <div style={{ color: '#85858e', fontSize: 10, fontWeight: 800, letterSpacing: 1.5, marginBottom: 8 }}>RECENT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid rgba(255,255,255,.1)', background: '#17181d', borderRadius: 18, padding: '13px 14px', marginBottom: 22 }}>
              <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 13, background: '#175b9b', fontSize: 21 }}>🚀</span>
              <span style={{ flex: 1 }}><strong style={{ display: 'block', fontSize: 14 }}>Launch checklist</strong><small style={{ color: '#8d8e98' }}>Website · just now</small></span>
              <span style={{ color: '#68b5ff', fontSize: 20 }}>→</span>
            </div>
            <div style={{ color: '#85858e', fontSize: 10, fontWeight: 800, letterSpacing: 1.5, marginBottom: 8 }}>PROJECTS</div>
            <div className="dv-preview-projects">
              {[
                ['📱', 'Mobile app', '#193c68'],
                ['⚙️', 'API', '#47306e'],
                ['🌐', 'Website', '#175d56'],
                ['＋', 'New project', '#202126'],
              ].map(([emoji, label, color]) => (
                <div key={label} style={{ minHeight: 106, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 14, background: color, border: '1px solid rgba(255,255,255,.09)', borderRadius: 18 }}>
                  <span style={{ fontSize: 24 }}>{emoji}</span>
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p style={{ color: MUTED, fontSize: 19, lineHeight: 1.7, margin: '0 0 22px' }}>
            Sessions stay organized by project, with oversized controls and clear spoken feedback when your attention is elsewhere.
          </p>
          {notes.map((note) => (
            <div key={note} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, margin: '15px 0', color: INK }}>
              <span style={{ paddingTop: 3 }}><Checkbox checked size={22} /></span>
              <span style={{ fontFamily: FONT_PRINT, fontSize: 19 }}>{note}</span>
            </div>
          ))}
          <a href={APP_URL} style={{ display: 'inline-block', marginTop: 14, color: TURQ_HI, fontFamily: FONT_PRINT, fontSize: 19, textUnderlineOffset: 5 }}>
            Self-host it now →
          </a>
        </div>
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// How it works — three steps with circled numbers
// ──────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { n: '1', body: 'Install the desktop companion. Hosted version: coming soon.', code: 'npx drivenvibe' },
    { n: '2', body: 'Run the open-source desktop companion in your project.', code: null },
    { n: '3', body: 'Pick a session, tap the mic, and talk.', code: null },
  ];
  // uneven left indents per step, so the list "drifts" like real notes
  const drift = [0, 22, 10];
  return (
    <Section
      id="how-it-works" top={72} bottom={76} indent={12}
      stickers={
        <React.Fragment>
          <HandNote rotate={-5} top={236} right={6} width={140} size={23}>
            copy this! ↙
          </HandNote>
          <StarSticker rotate={14} size={92} bottom={64} right={16} bg={TURQ} color="#0c1014">vroom</StarSticker>
        </React.Fragment>
      }
    >
      <Eyebrow>How it works</Eyebrow>
      <h2 style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 44, margin: '0 0 34px', letterSpacing: '0.01em' }}>
        Three steps. No exposed ports.
      </h2>
      {steps.map((s, i) => (
        <div key={s.n} style={{ marginBottom: i === steps.length - 1 ? 0 : 30, display: 'flex', gap: 20, alignItems: 'flex-start', marginLeft: drift[i] }}>
          <CircledNum n={s.n} size={48} />
          <div style={{ flex: 1, paddingTop: 4 }}>
            <div style={{ fontSize: 22, fontFamily: FONT_PRINT }}>{s.body}</div>
            {s.code && (
              <div style={{
                marginTop: 12, fontFamily: FONT_MONO, fontSize: 14,
                background: '#0E1014', color: '#E9E4D8',
                padding: '9px 15px', display: 'inline-block', borderRadius: 3,
                border: '1px solid rgba(233,228,216,0.12)',
              }}>
                {i === 0 ? null : <span style={{ color: TURQ }}>$ </span>}{s.code}
              </div>
            )}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// Why it exists — big handwritten pull-quote + prose
// ──────────────────────────────────────────────────────────────
function WhyItExists() {
  return (
    <Section
      top={80} bottom={80} indent={-14}
      stickers={
        <React.Fragment>
          <HandNote rotate={5} top={188} right={0} width={150} size={23}>
            ← that's the<br/>whole pitch
          </HandNote>
          <RectSticker rotate={-6} bottom={44} left={4} bg="#1F222A" color={INK} border={DIM}>
            no compromise
          </RectSticker>
        </React.Fragment>
      }
    >
      <Eyebrow>Why it exists</Eyebrow>
      <p style={{
        fontFamily: FONT_HAND, fontSize: 'clamp(34px, 5vw, 48px)', lineHeight: 1.18,
        margin: '0 0 60px', color: INK, fontWeight: 700,
        letterSpacing: '0.005em', maxWidth: 580,
      }}>
        Commutes are dead time for builders. <Highlight color={STK.hlYellow}>They shouldn't be.</Highlight>
      </p>
      <p style={{ margin: '0 0 22px', color: MUTED, fontSize: 19, lineHeight: 1.7, maxWidth: 560, marginLeft: 18 }}>
        Voice coding has historically meant compromise: dictation tools that
        spell out syntax character by character, agents that don't really
        understand your repo, transcription that gets braces wrong nine times
        out of ten.
      </p>
      <p style={{ margin: 0, color: MUTED, fontSize: 19, lineHeight: 1.7, maxWidth: 560, marginLeft: 18 }}>
        drivenvibe is different because it isn't a new agent. It <em style={{ color: TURQ_HI, fontStyle: 'normal' }}>is</em>
        {' '}Claude Code — the same model, the same tools, the same project
        context — just driven from your phone, hands-free.
      </p>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// What you get — checkbox task list (notes-style)
// ──────────────────────────────────────────────────────────────
function Capabilities() {
  const items = [
    ['Voice-first by design', 'Large controls, live transcripts, audio cues, haptics, and spoken replies.'],
    ['Your Claude, your control', 'Use your existing Claude login or an Anthropic API key for each session.'],
    ['Local agent runtime', 'Claude Code and your project files stay on your computer. Your phone is the remote.'],
    ['Choose your connection', 'Stay fully local, or use a tunnel. Hosted relay: coming soon.'],
  ];
  const drift = [0, 14, 6, 20];
  return (
    <Section
      top={76} bottom={80} indent={10}
      stickers={
        <React.Fragment>
          <CircleSticker rotate={-10} size={78} top={268} right={4} bg="#1F222A" color={TURQ_HI}>
            no cloud
          </CircleSticker>
          <HandNote rotate={4} top={360} right={10} width={120} size={21} color={DIM}>
            ↑ this is the point
          </HandNote>
        </React.Fragment>
      }
    >
      <Eyebrow>What you get</Eyebrow>
      <h2 style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 44, margin: '0 0 30px', letterSpacing: '0.01em' }}>
        The checklist.
      </h2>
      {items.map(([t, b], i) => (
        <div key={t} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px 0 18px', borderTop: i === 0 ? 'none' : `1px solid ${RULE}`, marginLeft: drift[i] }}>
          <div style={{ paddingTop: 5 }}><Checkbox checked size={24} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_PRINT, fontSize: 22, marginBottom: 2 }}>{t}</div>
            <div style={{ color: MUTED, fontSize: 17, maxWidth: 520, lineHeight: 1.6 }}>{b}</div>
          </div>
        </div>
      ))}
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// Pricing — two index-card columns
// ──────────────────────────────────────────────────────────────
// The product is voice-first, but code review belongs off the road.
function SafetyNote() {
  return (
    <Section top={66} bottom={66} indent={-8}>
      <div style={{
        border: `1.5px solid rgba(244,208,75,0.55)`, background: 'rgba(244,208,75,0.06)',
        padding: '24px 26px', transform: 'rotate(-0.4deg)',
      }}>
        <Eyebrow style={{ color: '#F4D04B', borderColor: 'rgba(244,208,75,0.4)', marginBottom: 16 }}>Eyes up</Eyebrow>
        <h2 style={{ fontFamily: FONT_HAND, fontSize: 35, lineHeight: 1.15, margin: '0 0 10px' }}>
          Talk now. Review when stopped.
        </h2>
        <p style={{ color: MUTED, fontSize: 17, lineHeight: 1.65, margin: 0 }}>
          drivenvibe is designed for short voice interactions. Keep the phone mounted,
          obey local laws, and inspect every generated change before you ship it.
        </p>
      </div>
    </Section>
  );
}

function FAQ() {
  const questions = [
    ['What actually runs on my laptop?', 'The drivenvibe server, Claude Code agent runtime, your project configuration, and session state. The phone handles speech recognition and spoken playback.'],
    ['Do I need another AI subscription?', 'No extra drivenvibe subscription is required for self-hosting. Use an existing Claude Pro/Max login or provide your own Anthropic API key. Provider usage charges still apply.'],
    ['Does the cloud relay store my code or chat history?', 'No. It forwards live messages between your authenticated phone and paired computer. Project files stay on your computer, and the current relay does not persist conversation history.'],
    ['Can I use it without the hosted service?', 'Yes. Local and self-hosted tunnel modes remain available, require no drivenvibe account, and are covered by the GPL-3.0 license.'],
    ['What if speech recognition gets a word wrong?', 'Edit or type the prompt before sending. You can also keep separate sessions with different recognition languages for code-heavy and native-language work.'],
  ];
  return (
    <Section id="faq" top={76} bottom={80} indent={8}>
      <Eyebrow>Common questions</Eyebrow>
      <h2 style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 44, margin: '0 0 26px' }}>
        Before you ask.
      </h2>
      <div>
        {questions.map(([question, answer]) => (
          <details key={question} style={{ borderTop: `1px solid ${RULE}`, padding: '15px 0' }}>
            <summary style={{ cursor: 'pointer', fontFamily: FONT_PRINT, fontSize: 21, color: INK, paddingRight: 12 }}>
              {question}
            </summary>
            <p style={{ color: MUTED, fontSize: 17, lineHeight: 1.65, margin: '10px 20px 4px 0' }}>{answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function Pricing() {
  return (
    <Section
      id="pricing" top={80} bottom={72} indent={-6}
      stickers={
        <React.Fragment>
          <StarSticker rotate={-14} size={92} top={92} left={-16} bg={TURQ} color="#0c1014">
            free<br/>forever
          </StarSticker>
          <TagSticker rotate={8} top={128} right={20} bg="#1F222A" color={INK} border={DIM}>
            beta →
          </TagSticker>
        </React.Fragment>
      }
    >
      <Eyebrow>Pricing</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 52 }} className="dv-pricing-grid">
        <div style={{ position: 'relative', transform: 'rotate(-0.8deg)' }}>
          <div style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 36, marginBottom: 8 }}>
            Open Source
          </div>
          <div style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 30, marginBottom: 8 }}>
            €0 <span style={{ color: DIM, fontWeight: 400, fontSize: 16, fontFamily: FONT_PRINT }}>forever</span>
          </div>
          <div style={{ color: MUTED, marginBottom: 22, fontSize: 17, lineHeight: 1.55 }}>
            Self-host it. No drivenvibe account. GPL-3.0 licensed.
          </div>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{
            color: TURQ_HI, fontFamily: FONT_PRINT, fontWeight: 400, fontSize: 18,
            textDecoration: 'underline', textUnderlineOffset: 5, textDecorationThickness: 1.5,
          }}>View on GitHub →</a>
        </div>
        <div style={{ position: 'relative', transform: 'rotate(0.6deg)', marginTop: 14 }}>
          <div style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 36, marginBottom: 2 }}>
            Cloud Relay
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: DIM, letterSpacing: 1.2, marginBottom: 16, textTransform: 'uppercase' }}>
            public beta
          </div>
          <div style={{ color: MUTED, marginBottom: 18, fontSize: 17, lineHeight: 1.55 }}>
            Sign in on your phone and securely pair the desktop companion. No inbound ports or changing tunnel URL.
          </div>
          <div style={{ fontFamily: FONT_HAND, fontWeight: 700, fontSize: 30, marginBottom: 16 }}>
            Free<span style={{ color: DIM, fontWeight: 400, fontSize: 16, fontFamily: FONT_PRINT }}> during beta</span>
          </div>
          <div style={{ color: DIM, fontFamily: FONT_PRINT, fontSize: 14, lineHeight: 1.5, margin: '-8px 0 16px' }}>
            Planned price: €7/month after beta. No charge today.
          </div>
          <a href={APP_URL} style={{
            color: TURQ_HI, fontFamily: FONT_PRINT, fontWeight: 400, fontSize: 18,
            textDecoration: 'underline', textUnderlineOffset: 5, textDecorationThickness: 1.5,
          }}>Self-host it now →</a>
        </div>
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      maxWidth: 1080, margin: '0 auto',
      padding: '36px 0 70px', position: 'relative',
    }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <SquigglyRule color={RULE} />
      <div style={{
        marginTop: 26, display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', flexWrap: 'wrap', gap: 16,
        color: MUTED, fontSize: 16, fontFamily: FONT_PRINT,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>GitHub</a>
          <span style={{ color: DIM }}>·</span>
          <a href={`${GITHUB_URL}#setup`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Setup</a>
          <span style={{ color: DIM }}>·</span>
          <a href="#faq" style={{ color: 'inherit' }}>FAQ</a>
          <span style={{ color: DIM }}>·</span>
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>Support</a>
        </div>
        <div style={{ color: DIM, fontSize: 19, fontFamily: FONT_HAND, fontWeight: 500, transform: 'rotate(-2deg)' }}>
          built in Ljubljana by Maj ♥
        </div>
      </div>
      </div>
    </footer>
  );
}

// ──────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────
function App() {
  const [modal, setModal] = useState(false);
  return (
    <div style={{
      position: 'relative',
      background: 'transparent', color: INK, minHeight: '100vh',
      fontFamily: FONT_BODY, fontSize: 18, lineHeight: 1.7,
      paddingLeft: 24, paddingRight: 24,
    }}>
      <MarginLine />
      <Header />
      <main id="main">
        <Hero onInstall={() => setModal(true)} />
        <HeroPhoto />
        <SquigglyRule color={RULE} />
        <ProductPreview />
        <SquigglyRule color={RULE} />
        <HowItWorks />
        <SquigglyRule color={RULE} />
        <WhyItExists />
        <SquigglyRule color={RULE} />
        <Capabilities />
        <SquigglyRule color={RULE} />
        <SafetyNote />
        <SquigglyRule color={RULE} />
        <Pricing />
        <SquigglyRule color={RULE} />
        <FAQ />
      </main>
      <Footer />
      {modal && <InstallModal onClose={() => setModal(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
