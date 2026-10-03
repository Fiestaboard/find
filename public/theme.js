// Follow the system colour scheme. FiestaUI themes on a data-theme attribute
// rather than a media query, and the page's CSP forbids inline scripts, so
// this small file is loaded (blocking, before first paint) instead.
(function () {
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    document.documentElement.setAttribute("data-theme", dark.matches ? "dark" : "light");
  }
  apply();
  dark.addEventListener("change", apply);
})();
