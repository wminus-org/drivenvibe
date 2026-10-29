// Sticker + notes library — dark-notebook edition.
// Feels like chalk / gel-pen marginalia stuck onto a dark ruled page:
// highlighter swipes, circled numbers, hand-drawn checkboxes, doodle arrows.

const STK = {
  hand: '"Caveat", cursive',          // big display handwriting
  body: '"Kalam", cursive',           // readable handwriting (prose)
  print: '"Patrick Hand", cursive',   // neat hand-print (labels/UI)
  mono: '"JetBrains Mono", ui-monospace, monospace',

  // dark page palette
  paper:   '#14161B',
  ink:     '#E9E4D8',
  muted:   '#ABA597',
  dim:     '#8A8477',   // 4.8:1 on paper (AA for small text)
  rule:    'rgba(233,228,216,0.10)',
  margin:  'rgba(255,138,120,0.30)',  // coral notebook margin line

  // accents (brightened for dark)
  turq:    '#33D6C6',
  turqHi:  '#5BE6D8',
  yellow:  '#F4D04B',
  pink:    '#FF8FA3',

  // highlighter washes (translucent)
  hlTurq:   'rgba(51,214,198,0.22)',
  hlYellow: 'rgba(244,208,75,0.22)',
  hlPink:   'rgba(255,143,163,0.20)',
};

// Absolute-positioned wrapper. Stickers live at page-margin coordinates.
function StickerBase({ children, rotate = 0, top, left, right, bottom, zIndex = 4, style }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom,
      transform: `rotate(${rotate}deg)`,
      filter: 'drop-shadow(0 2px 5px rgba(0,0,0,.45))',
      zIndex, pointerEvents: 'none', ...style,
    }}>{children}</div>
  );
}

// ────── CircleSticker — round badge with stacked text
function CircleSticker({ children, size = 80, bg = STK.turq, color = '#0c1014', rotate, top, left, right, bottom }) {
  return (
    <StickerBase rotate={rotate} top={top} left={left} right={right} bottom={bottom}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: bg, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        fontFamily: STK.print, fontWeight: 400,
        fontSize: size * 0.19, lineHeight: 1.05, padding: 10,
        textTransform: 'uppercase', letterSpacing: 1,
        boxShadow: `inset 0 0 0 2px rgba(255,255,255,.25), inset 0 0 0 4px ${bg}`,
        boxSizing: 'border-box',
      }}>{children}</div>
    </StickerBase>
  );
}

// ────── TagSticker — chamfered price-tag, mono font
function TagSticker({ children, bg = '#1F222A', color = STK.ink, border = STK.dim, rotate, top, left, right, bottom }) {
  return (
    <StickerBase rotate={rotate} top={top} left={left} right={right} bottom={bottom}>
      <div style={{
        position: 'relative',
        background: bg, color,
        padding: '8px 14px 8px 22px',
        fontFamily: STK.mono, fontSize: 12,
        fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase',
        border: `1.5px solid ${border}`,
        clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 10px 100%, 0 50%)',
      }}>
        <span style={{ position: 'absolute', top: '50%', left: 7, transform: 'translateY(-50%)', width: 4, height: 4, borderRadius: '50%', background: border }} />
        {children}
      </div>
    </StickerBase>
  );
}

// ────── RectSticker — rectangle w/ thick border
function RectSticker({ children, bg = '#1F222A', color = STK.turq, border, rotate, top, left, right, bottom }) {
  const b = border || color;
  return (
    <StickerBase rotate={rotate} top={top} left={left} right={right} bottom={bottom}>
      <div style={{
        background: bg, color, border: `2px solid ${b}`,
        padding: '8px 14px',
        fontFamily: STK.print, fontWeight: 400, fontSize: 15,
        textTransform: 'uppercase', letterSpacing: 1,
      }}>{children}</div>
    </StickerBase>
  );
}

// ────── StarSticker — 12-point sunburst with text inside
function StarSticker({ children, size = 96, bg = STK.yellow, color = '#0c1014', rotate, top, left, right, bottom }) {
  const points = [];
  const n = 12;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? size / 2 : size / 2.7;
    points.push(`${(Math.cos(a) * r + size/2).toFixed(1)},${(Math.sin(a) * r + size/2).toFixed(1)}`);
  }
  return (
    <StickerBase rotate={rotate} top={top} left={left} right={right} bottom={bottom}>
      <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0 }}>
          <polygon points={points.join(' ')} fill={bg} stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div style={{
          position: 'relative', color, textAlign: 'center',
          fontFamily: STK.print, fontWeight: 400,
          fontSize: size * 0.2, lineHeight: 1, textTransform: 'uppercase', letterSpacing: 1,
        }}>{children}</div>
      </div>
    </StickerBase>
  );
}

// ────── HandNote — handwritten Caveat annotation
function HandNote({ children, color = STK.turqHi, rotate = -4, top, left, right, bottom, size = 24, width, align = 'left' }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom,
      transform: `rotate(${rotate}deg)`,
      fontFamily: STK.hand, color, fontWeight: 600,
      fontSize: size, lineHeight: 1.2, width, textAlign: align,
      zIndex: 4, pointerEvents: 'none',
    }}>{children}</div>
  );
}

// ────── ArrowDoodle — sketchy arrow pointer
function ArrowDoodle({ size = 60, color = STK.turqHi, rotate = 0, top, left, right, bottom, flip }) {
  return (
    <div style={{
      position: 'absolute', top, left, right, bottom,
      transform: `rotate(${rotate}deg)${flip ? ' scaleX(-1)' : ''}`,
      color, zIndex: 4, pointerEvents: 'none',
    }}>
      <svg width={size} height={size * 0.7} viewBox="0 0 60 42" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 32 C 14 6, 28 38, 54 14" />
        <path d="M46 8 L54 14 L48 22" />
      </svg>
    </div>
  );
}

// ────── SquigglyRule — hand-drawn wavy divider
function SquigglyRule({ color = STK.rule, height = 16, amplitude = 3.5 }) {
  const segs = [];
  for (let x = 0; x < 1000; x += 26) {
    const y1 = height/2 - amplitude;
    const y2 = height/2 + amplitude;
    segs.push(`Q ${x + 6.5} ${y1} ${x + 13} ${height/2} Q ${x + 19.5} ${y2} ${x + 26} ${height/2}`);
  }
  return (
    <div style={{ width: '100%', height, color }} aria-hidden="true">
      <svg width="100%" height={height} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none">
        <path d={`M0 ${height/2} ${segs.join(' ')}`} fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </div>
  );
}

// ────── ScribbleUnderline — hand-drawn underline under a word
function ScribbleUnderline({ color = STK.turq, thick = 4 }) {
  return (
    <svg width="100%" height={thick + 6} viewBox="0 0 100 10" preserveAspectRatio="none" style={{ display: 'block', marginTop: -4, color }} aria-hidden="true">
      <path d="M2 6 Q 25 2 50 6 T 98 5" stroke="currentColor" strokeWidth={thick * 0.6} fill="none" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

// ────── Highlight — translucent marker swipe behind inline text.
// Skewed + uneven padding so it reads like a hand-dragged highlighter.
function Highlight({ children, color = STK.hlTurq }) {
  return (
    <span style={{
      background: color,
      padding: '0.05em 0.18em 0.12em 0.12em',
      margin: '0 -0.06em',
      borderRadius: '0.6em 0.4em 0.5em 0.7em',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    }}>{children}</span>
  );
}

// ────── CircledNum — a number with a hand-drawn ellipse scribbled around it
function CircledNum({ n, color = STK.turqHi, size = 46 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox="0 0 46 46" style={{ position: 'absolute', inset: 0, color }} aria-hidden="true">
        <path d="M30 6 C 12 3, 3 14, 5 26 C 7 39, 26 43, 36 38 C 45 33, 44 13, 28 7 C 25 6, 22 6, 20 7"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span style={{ fontFamily: STK.hand, fontWeight: 700, fontSize: size * 0.5, color, lineHeight: 1 }}>{n}</span>
    </span>
  );
}

// ────── Checkbox — hand-drawn square, optionally ticked
function Checkbox({ checked = false, color = STK.turqHi, size = 22 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flex: 'none' }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0, color }}>
        <path d="M4 3 L20 4 L21 20 L3 21 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        {checked && <path d="M6 12 L11 17 L19 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    </span>
  );
}

// ────── MarginLine — continuous coral vertical line down the page gutter,
// drawn once at the App level (positioned relative to the centered column).
function MarginLine() {
  return (
    <div aria-hidden="true" className="dv-margin-line" style={{
      position: 'absolute', top: 0, bottom: 0,
      left: 'calc(50% - 320px - 30px)', width: 2,
      background: STK.margin, zIndex: 1, pointerEvents: 'none',
    }} />
  );
}

Object.assign(window, {
  STK, StickerBase, CircleSticker, TagSticker, RectSticker, StarSticker,
  HandNote, ArrowDoodle, SquigglyRule, ScribbleUnderline,
  Highlight, CircledNum, Checkbox, MarginLine,
});
