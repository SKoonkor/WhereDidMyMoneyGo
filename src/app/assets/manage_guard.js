/* Warn before leaving the Manage page with unsaved staged changes.
 *
 * `window.__manageDirty` is kept in sync by a clientside callback on /manage
 * (see manage.py). This adds two guards:
 *   - a native `beforeunload` prompt for tab close / refresh / typing a new URL;
 *   - a capture-phase click interceptor on in-app links (Dash `dcc.Link` renders
 *     <a href>): if dirty and the link leaves /manage, confirm() first and block
 *     the navigation if declined.
 * The flag is cleared on a confirmed leave (Apply/Save clears it via the store).
 */
(function () {
  window.__manageDirty = window.__manageDirty || false;

  window.addEventListener("beforeunload", function (e) {
    if (window.__manageDirty) { e.preventDefault(); e.returnValue = ""; }
  });

  document.addEventListener("click", function (e) {
    if (!window.__manageDirty) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    // Ignore non-navigation and in-page (still on /manage) links.
    if (!href || href.charAt(0) === "#") return;
    if (href.indexOf("/manage") === 0) return;
    if (href.charAt(0) !== "/" && href.indexOf("http") !== 0) return;
    if (!window.confirm("You have unsaved changes on this page. "
                        + "Leave without saving?")) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      window.__manageDirty = false;
    }
  }, true);
})();
