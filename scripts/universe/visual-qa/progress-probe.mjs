/**
 * Measures whether a page finished, rather than whether it rendered.
 *
 * The matrix already checked overflow, console errors, contrast and
 * accessibility. A Charts page that never resolved and a Mining dashboard full
 * of skeletons passed all four: nothing overflowed, nothing logged, the
 * skeletons had fine contrast, and axe is happy with a placeholder. This probe
 * is what would have caught them.
 *
 * Runs in the page. Returns plain data for the harness to judge.
 */
export function progressProbe() {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };

  const selectorFor = (element) => {
    const id = element.id ? `#${element.id}` : '';
    const cls = typeof element.className === 'string' && element.className
      ? '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${element.tagName.toLowerCase()}${id}${cls}`;
  };

  const spinners = [...document.querySelectorAll(
    '.spinner-border, .load-status-spinner, .loadingGraphs, app-loading-indicator',
  )].filter(visible);
  const skeletons = [...document.querySelectorAll('.skeleton-loader, .skeleton-row')].filter(visible);

  // An ECharts host that drew no series is a blank panel. It is not detectable
  // from the outside: the container has a size and a background like any other.
  const charts = [...document.querySelectorAll('div[_echarts_instance_]')]
    .filter(visible)
    .map((host) => {
      const svgMarks = host.querySelectorAll('svg path, svg rect, svg circle, svg polyline').length;
      const canvases = [...host.querySelectorAll('canvas')];
      const canvasPixels = canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0);
      const rect = host.getBoundingClientRect();
      return {
        selector: selectorFor(host),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        svgMarks,
        canvasCount: canvases.length,
        canvasPixels,
        // A title is how ECharts renders "no data", so a host with a title and
        // no marks is deliberately empty rather than broken.
        hasTitleOnly: svgMarks > 0 && svgMarks < 4,
        drewNothing: svgMarks === 0 && canvasPixels === 0,
      };
    });

  // A page that is nothing but placeholders has not loaded, however healthy it
  // looks to every other check.
  const main = document.querySelector('main') || document.body;
  const text = (main.innerText || '').replace(/\s+/g, ' ').trim();

  // The explicit states the interface is required to reach instead of waiting.
  const statusPanels = [...document.querySelectorAll('.load-status, .load-status-stale')]
    .filter(visible)
    .map((panel) => panel.innerText.replace(/\s+/g, ' ').trim().slice(0, 160));

  // What a page says while it is still working. A skeleton on its own says
  // nothing to a screen reader, so the announcement counts separately from the
  // placeholders themselves.
  const loadingAnnouncements = [...document.querySelectorAll('.sr-only, [role="status"], [aria-live]')]
    .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((text) => /load|wait|fetch/i.test(text));

  return {
    spinners: spinners.map(selectorFor),
    loadingAnnouncements,
    skeletons: skeletons.length,
    charts,
    statusPanels,
    textLength: text.length,
    // Placeholders outnumbering real text is the shape of a page that never
    // finished, as opposed to one that finished with little to say.
    skeletonOnly: skeletons.length > 0 && text.length < 400,
  };
}
