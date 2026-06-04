(function(g){
'use strict';

// Load icon data from the full lucide library (lucide.min.js exports to window.lucide)
// We bridge that to our custom ic() API used throughout the app.

// Default SVG attributes for all icons
const _da = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};

function ic(name, size, extra) {
  // Try to get icon from lucide global (loaded via lucide.min.js)
  const lucide = g.lucide;
  if (!lucide) return '';
  
  // lucide exports icons as named exports (e.g. lucide.Sun, lucide.Moon)
  const iconData = lucide[name];
  if (!iconData || !Array.isArray(iconData)) return '';
  
  const a = Object.assign({}, _da, { width: size || 16, height: size || 16 }, extra || {});
  const as = Object.entries(a).map(([k, v]) => k + '="' + v + '"').join(' ');
  
  // Each icon is an array of [tag, {attrs}] tuples
  const cs = iconData.map(function(c) {
    const tag = c[0];
    const attrs = c[1];
    const s = Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(' ');
    return '<' + tag + ' ' + s + '/>';
  }).join('');
  
  return '<svg ' + as + '>' + cs + '</svg>';
}

g.LucideIcons = { ic: ic };
})(typeof window !== 'undefined' ? window : this);
