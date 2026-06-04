document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('[data-li]').forEach(function(el) {
    var attr = el.getAttribute('data-li');
    if (!attr) return;
    // Parse: LI("IconName", size)
    var m = attr.match(/LI\s*\(\s*["']([^"']+)["']\s*,\s*(\d+)/);
    if (!m) return;
    var name = m[1], size = parseInt(m[2], 10);
    var svg = (window.LucideIcons || {ic:function(){return '';}}).ic(name, size);
    if (svg) el.outerHTML = svg;
  });
});
