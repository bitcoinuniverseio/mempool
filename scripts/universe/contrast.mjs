/**
 * Contrast arithmetic, shared by the palette gate and the browser scanner.
 *
 * WCAG 2.2 relative luminance and contrast ratio, plus sRGB alpha compositing,
 * because almost every real failure on this product came from a colour that
 * looked fine in isolation and was then composited over something else.
 */

/** Parse '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(...)' or 'rgba(...)'. */
export function parseColor(input) {
  if (!input) return null;
  const value = String(input).trim();

  const fn = value.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  let hex = value.replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

/** Composite `fg` over `bg`. Browsers blend in sRGB, so this does too. */
export function composite(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f, b) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

export function relativeLuminance(color) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  );
}

/** Contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Ratio of `foreground` as actually rendered on `background`, honouring the
 * foreground's own alpha and any translucent plate between the two.
 *
 * `plates` are listed nearest the background first, the order they paint in.
 */
export function effectiveRatio(foreground, background, plates = []) {
  const fg = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  const bg = typeof background === 'string' ? parseColor(background) : background;
  if (!fg || !bg) return null;

  let surface = { ...bg, a: 1 };
  for (const plate of plates) {
    const p = typeof plate === 'string' ? parseColor(plate) : plate;
    if (p) surface = composite(p, surface);
  }
  return contrastRatio(composite(fg, surface), surface);
}

/** The floor a piece of text has to clear, per WCAG 2.2 AA. */
export function requiredRatio({ fontSizePx = 16, fontWeight = 400, graphical = false } = {}) {
  if (graphical) return 3;
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return large ? 3 : 4.5;
}

/** Truncate rather than round, so a failing ratio is never reported as passing. */
export function floorTo(value, places = 2) {
  const factor = 10 ** places;
  return Math.floor(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Colour vision
// ---------------------------------------------------------------------------
//
// A seven-colour categorical ramp on a light surface is squeezed from both
// sides: every series has to clear 3:1 against the page, which caps how light
// it can be, and they still have to be told apart from each other. Luminance
// alone cannot do that, so the ramp is checked the way it is actually read,
// through normal vision and through the three common deficiencies, using a
// perceptual distance rather than a contrast ratio.

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(c * 255)));
};

/**
 * Viénot, Brettel and Mollon (1999): project onto the plane of colours the
 * missing cone cannot separate. Matrices operate on linear RGB.
 */
const CVD_MATRICES = {
  protanopia: [
    [0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1],
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1],
  ],
  tritanopia: [
    [1, 0.14461, -0.14461], [0, 0.85653, 0.14347], [0, 0.85653, 0.14347],
  ],
};

/** Simulate how `color` appears with the named deficiency. */
export function simulateColorVision(color, kind) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  if (!c) return null;
  if (kind === 'normal') return { ...c };
  const m = CVD_MATRICES[kind];
  if (!m) throw new Error(`unknown colour vision type: ${kind}`);
  const [r, g, b] = [toLinear(c.r), toLinear(c.g), toLinear(c.b)];
  return {
    r: fromLinear(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    g: fromLinear(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    b: fromLinear(m[2][0] * r + m[2][1] * g + m[2][2] * b),
    a: c.a,
  };
}

export const COLOR_VISION_TYPES = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

/** sRGB to CIE L*a*b*, D65. */
function toLab(color) {
  const [r, g, b] = [toLinear(color.r), toLinear(color.g), toLinear(color.b)];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 colour difference. Around 2.3 is "just noticeable"; 20 is obvious. */
export function colorDifference(one, two) {
  const a = toLab(typeof one === 'string' ? parseColor(one) : one);
  const b = toLab(typeof two === 'string' ? parseColor(two) : two);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** The worst separation between two colours across normal and deficient vision. */
export function worstColorSeparation(one, two) {
  let worst = Infinity;
  let worstKind = 'normal';
  for (const kind of COLOR_VISION_TYPES) {
    const d = colorDifference(simulateColorVision(one, kind), simulateColorVision(two, kind));
    if (d < worst) {
      worst = d;
      worstKind = kind;
    }
  }
  return { difference: worst, kind: worstKind };
}
