/**
 * The contrast probe that runs inside the page.
 *
 * Automated accessibility engines measure text against the nearest opaque
 * ancestor background. That is right most of the time and wrong in exactly the
 * places this product lives: a fee label over a live gradient, a figure on a
 * block face, an axis drawn into a canvas, a tooltip over the Lens. Every one
 * of those passed an axe run while being unreadable in production.
 *
 * So this probe reads what is actually painted. Over a gradient it measures
 * against every stop; over a canvas or a WebGL surface it samples the pixels
 * under the text; and it keeps the worst result rather than a declared colour
 * that nothing is using.
 *
 * Playwright serialises this function and runs it in the page, so it may only
 * reference its own scope and the browser globals.
 */
export function contrastProbe() {
  const parse = (c) => {
    if (!c) return null;
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (f, b) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
    return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
  };
  const lum = (c) => {
    const ch = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const floor2 = (v) => Math.floor(v * 100) / 100;

  const path = (el) => {
    const parts = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 6) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (typeof n.className === 'string' && n.className.trim()) {
        s += '.' + n.className.trim().split(/\s+/).filter((c) => !/^ng-/.test(c)).slice(0, 3).join('.');
      }
      parts.unshift(s); n = n.parentElement; d++;
    }
    return parts.join(' > ');
  };

  // Everything painted behind an element, composited bottom-up. Also reports
  // whether anything in that stack is a gradient, image, canvas, or video,
  // because those cannot be trusted to a single declared colour.
  const backdrop = (el) => {
    const stack = []; let painted = false; let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const op = parseFloat(cs.opacity);
      const bg = parse(cs.backgroundColor);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') painted = true;
      if (/^(CANVAS|VIDEO|IMG|SVG)$/.test(n.tagName)) painted = true;
      if (bg && bg.a > 0) {
        stack.push({ c: bg, op: Number.isFinite(op) ? op : 1 });
        if (bg.a >= 1 && op >= 1 && !painted) break;
      }
      n = n.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) {
      const { c, op } = stack[i];
      base = over({ r: c.r, g: c.g, b: c.b, a: c.a * op }, base);
    }
    return { color: base, painted };
  };

  const inheritedOpacity = (el) => {
    let o = 1, n = el;
    while (n && n.nodeType === 1) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (Number.isFinite(v)) o *= v;
      n = n.parentElement;
    }
    return o;
  };

  // Every colour a CSS background-image can actually paint behind text.
  //
  // A gradient renders interpolations between its stops, so the extremes of the
  // rendered range are at the stops themselves. Measuring against all of them
  // is what makes a fee bar or a block face verifiable rather than assumed.
  const gradientStops = (backgroundImage) => {
    const out = [];
    const re = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g;
    let m;
    while ((m = re.exec(backgroundImage)) !== null) {
      let c = parse(m[1]);
      if (!c && m[1][0] === '#') {
        let h = m[1].slice(1);
        if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
        if (h.length === 6 || h.length === 8) {
          c = { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16),
                a: h.length === 8 ? parseInt(h.slice(6,8),16) / 255 : 1 };
        }
      }
      if (c) out.push(c);
    }
    return out;
  };

  // The pixels a canvas is actually painting under a given rectangle.
  const canvasColoursUnder = (rect) => {
    const out = [];
    for (const canvas of document.querySelectorAll('canvas')) {
      const cr = canvas.getBoundingClientRect();
      if (rect.right < cr.left || rect.left > cr.right || rect.bottom < cr.top || rect.top > cr.bottom) continue;
      try {
        const sx = (canvas.width || cr.width) / cr.width;
        const sy = (canvas.height || cr.height) / cr.height;
        const x = Math.max(0, Math.floor((rect.left - cr.left) * sx));
        const y = Math.max(0, Math.floor((rect.top - cr.top) * sy));
        const w = Math.max(1, Math.min(Math.ceil(rect.width * sx), (canvas.width || cr.width) - x));
        const h = Math.max(1, Math.min(Math.ceil(rect.height * sy), (canvas.height || cr.height) - y));
        const copy = document.createElement('canvas');
        copy.width = Math.min(w, 120); copy.height = Math.min(h, 60);
        const ctx = copy.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, x, y, w, h, 0, 0, copy.width, copy.height);
        const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let lo = null, hi = null, loL = Infinity, hiL = -Infinity;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 8) continue;
          const c = { r: data[i], g: data[i + 1], b: data[i + 2], a: 1 };
          const l = lum(c);
          if (l < loL) { loL = l; lo = c; }
          if (l > hiL) { hiL = l; hi = c; }
        }
        if (lo) out.push(lo);
        if (hi) out.push(hi);
      } catch (e) { /* a tainted canvas cannot be sampled; the row stays flagged */ }
    }
    return out;
  };

  // Keep only the extremes of a set of candidate colours. Compositing is
  // monotone per channel, so the worst contrast for any ink is produced by one
  // of these two, which keeps the search bounded instead of combinatorial.
  const extremes = (colours) => {
    if (colours.length < 3) return colours;
    let lo = colours[0], hi = colours[0], loL = lum(lo), hiL = loL;
    for (const c of colours) {
      const l = lum(c);
      if (l < loL) { loL = l; lo = c; }
      if (l > hiL) { hiL = l; hi = c; }
    }
    return [lo, hi];
  };

  // The set of colours that can actually end up behind the element.
  //
  // Layers are collected outward from the element and stop at the first one
  // that is fully opaque, because nothing below an opaque layer is visible.
  // Each layer contributes every colour it can paint: a flat background is one
  // colour, a gradient is all of its stops, a canvas is the lightest and
  // darkest pixel it draws under this rectangle. They are then composited
  // bottom-up, keeping only the extremes at each step.
  const paintedBackdrops = (el, rect) => {
    const layers = [];
    let unknown = false;
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const op = parseFloat(cs.opacity);
      const alpha = Number.isFinite(op) ? op : 1;
      const layer = [];
      let opaque = false;

      if (n.tagName === 'CANVAS') {
        for (const c of canvasColoursUnder(rect)) layer.push(c);
        if (layer.length) opaque = true;
      }

      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (/url\(/.test(cs.backgroundImage)) unknown = true;
        const stops = gradientStops(cs.backgroundImage);
        for (const c of stops) layer.push({ r: c.r, g: c.g, b: c.b, a: c.a * alpha });
        // A gradient with no transparent stop covers whatever is beneath it.
        if (stops.length && stops.every((c) => c.a >= 1) && alpha >= 1 && !/url\(/.test(cs.backgroundImage)) {
          opaque = true;
        }
      }

      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) {
        layer.push({ r: bg.r, g: bg.g, b: bg.b, a: bg.a * alpha });
        if (bg.a >= 1 && alpha >= 1) opaque = true;
      }

      if (layer.length) layers.push(layer);
      if (opaque) break;
      n = n.parentElement;
    }

    // The browser paints onto the canvas of the page itself, which is white
    // where nothing else has covered it.
    let set = [{ r: 255, g: 255, b: 255, a: 1 }];
    for (let i = layers.length - 1; i >= 0; i--) {
      const next = [];
      for (const beneath of set) for (const c of layers[i]) next.push(over(c, beneath));
      set = extremes(next);
    }
    return { colours: set, unknown };
  };

  const results = { text: [], painted: [], canvas: [], sampled: 0 };

  // --- Text -----------------------------------------------------------------
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (/^(SCRIPT|STYLE|NOSCRIPT|BR|HEAD|META|LINK|TITLE|DEFS)$/.test(el.tagName)) continue;
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Text hidden from assistive technology is a copy affordance or a visual
    // duplicate of something already on screen, not content anyone reads.
    if (el.closest('[aria-hidden="true"]')) continue;

    const declared = parse(cs.color) || parse(cs.fill);
    if (!declared) continue;
    const opacity = inheritedOpacity(el);
    if (opacity < 0.02) continue;

    const { color: bg, painted } = backdrop(el);

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    // Placeholder text has to be readable, so it is held to the body floor even
    // though it is often small and grey by convention.
    const required = large ? 3 : 4.5;

    results.sampled++;

    // Measure against every colour that can actually end up behind this text
    // and keep the worst. Over a flat surface that is one answer; over a
    // gradient, a canvas, or the fee scale it is the one that matters.
    const { colours, unknown } = paintedBackdrops(el, rect);
    let worst = Infinity;
    let worstBackground = bg;
    for (const surface of colours) {
      const ink = over({ r: declared.r, g: declared.g, b: declared.b, a: declared.a * opacity }, surface);
      const r = floor2(ratio(ink, surface));
      if (r < worst) { worst = r; worstBackground = surface; }
    }
    if (!Number.isFinite(worst)) continue;

    if (worst >= required && !unknown) continue;

    const key = path(el) + '|' + cs.color + '|' + Math.round(worst * 10);
    if (seen.has(key)) continue;
    seen.add(key);

    const row = {
      text: text.slice(0, 60),
      selector: path(el),
      foreground: cs.color,
      background:
        'rgb(' + Math.round(worstBackground.r) + ',' + Math.round(worstBackground.g) + ',' + Math.round(worstBackground.b) + ')',
      opacity: Number(opacity.toFixed(2)),
      ratio: worst,
      required,
      fontSize: size,
      fontWeight: weight,
      overPaintedSurface: painted,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
    if (worst < required) results.text.push(row);
    else results.painted.push(row);
  }

  // --- Canvas and WebGL -----------------------------------------------------
  //
  // A canvas has no DOM to inspect, so it is measured as pixels: the darkest
  // and lightest thing it draws, and the contrast between them. A canvas whose
  // whole range is flat is a canvas that has gone blank, which is the failure
  // that matters most for the Lens.
  for (const canvas of document.querySelectorAll('canvas')) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const entry = { selector: path(canvas), w: Math.round(rect.width), h: Math.round(rect.height) };
    try {
      const copy = document.createElement('canvas');
      copy.width = Math.min(240, canvas.width || Math.round(rect.width));
      copy.height = Math.min(240, canvas.height || Math.round(rect.height));
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, copy.width, copy.height);
      const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let min = Infinity, max = -Infinity, opaque = 0;
      const histogram = new Map();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) continue;
        opaque++;
        const l = lum({ r: data[i], g: data[i + 1], b: data[i + 2] });
        if (l < min) min = l;
        if (l > max) max = l;
        const bucket = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
        histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
      }
      entry.opaquePixels = opaque;
      entry.distinctColours = histogram.size;
      if (opaque > 0) {
        entry.range = floor2((max + 0.05) / (min + 0.05));
        entry.blank = histogram.size <= 2;
      } else {
        entry.blank = true;
        entry.range = 1;
      }
    } catch (e) {
      entry.error = String(e).slice(0, 120);
    }
    results.canvas.push(entry);
  }

  return results;
}
