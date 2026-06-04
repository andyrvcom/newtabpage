(function () {
  // Apply theme BEFORE first paint so var(--bg) resolves correctly on #pageVeil
  var saved = localStorage.getItem('sdTheme');
  var dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  // Force bg on html itself so browser never shows white flash
  document.documentElement.style.background = dark ? '#000' : '#fff';

  // Favicon
  var link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = 'icons/favicon.svg';
  document.head.appendChild(link);
})();
