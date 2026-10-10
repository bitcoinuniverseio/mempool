const { createHash } = require('node:crypto');

/**
 * Bind generated HTML to a config cache epoch while retaining the runtime
 * mount path. The query is not integrity enforcement: deployments may replace
 * config.js with environment-rendered bytes after the application build.
 */
function bindRuntimeConfigScript(html, configBytes) {
  const marker = '<!-- CONFIG -->';
  const endMarker = '<!-- END CONFIG -->';
  const markerStart = html.indexOf(marker);
  const markerEnd = html.indexOf(endMarker);
  if ((markerStart < 0) !== (markerEnd < 0) || (markerStart >= 0 && markerEnd <= markerStart)) {
    throw new Error('The index CONFIG marker is incomplete.');
  }
  // The existing Liquid template predates CONFIG markers. Its one exact
  // config script remains supported without adding or removing HTML markers.
  const start = markerStart < 0 ? 0 : markerStart;
  const end = markerEnd < 0 ? html.length : markerEnd;
  const section = html.slice(start, end);
  const pattern = /(<script\b[^>]*\bsrc\s*=\s*)(["'])\/resources\/config\.js(?:\?[^"'<>]*)?\2([^>]*>\s*<\/script>)/gi;
  const matches = [...section.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error('The CONFIG marker must contain exactly one runtime config script.');
  }
  const sha256 = createHash('sha256').update(configBytes).digest('hex');
  const url = `/resources/config.js?v=${sha256}`;
  const bound = section.replace(pattern, (_match, prefix, quote, suffix) => `${prefix}${quote}${url}${quote}${suffix}`);
  return { html: html.slice(0, start) + bound + html.slice(end), sha256, url };
}

module.exports = { bindRuntimeConfigScript };
