// /demo/ frame page: Phone / Full screen toggle, remembered per browser.
// External file because the site CSP is script-src 'self'.
(function () {
  var KEY = 'dnv-demo-view';
  var root = document.documentElement;
  var buttons = document.querySelectorAll('.toggle button');

  function apply(mode) {
    root.setAttribute('data-mode', mode);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
  apply(saved === 'full' ? 'full' : 'phone');

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      apply(b.dataset.mode);
      try { localStorage.setItem(KEY, b.dataset.mode); } catch (e) { /* storage blocked */ }
    });
  });
})();
