/* Warn before leaving the Settings page with unsaved (un-applied) changes.
 *
 * A clientside callback on /settings (see settings.py) keeps these in sync:
 *   window.__settingsDirty        - true when the form differs from saved config
 *   window.__settingsChanges      - ["App name: A → B", ...] (already translated)
 *   window.__settingsGuardIntro   - "You have unsaved changes:" (translated)
 *   window.__settingsGuardOutro   - "Leave without saving?" (translated)
 *
 * Two guards, mirroring manage_guard.js:
 *   - a native `beforeunload` prompt for tab close / refresh / new URL (browsers
 *     show their own generic text here — the change list can't be injected);
 *   - a capture-phase click interceptor on in-app links (dcc.Link -> <a href>):
 *     if dirty and the link leaves /settings, confirm() with the change list and
 *     block the navigation if declined.
 * The flag clears on a confirmed leave; Save clears it by making the form match config.
 */
(function () {
  window.__settingsDirty = window.__settingsDirty || false;
  window.__settingsChanges = window.__settingsChanges || [];

  window.addEventListener("beforeunload", function (e) {
    if (window.__settingsDirty) { e.preventDefault(); e.returnValue = ""; }
  });

  document.addEventListener("click", function (e) {
    if (!window.__settingsDirty) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    // Ignore non-navigation and in-page (still on /settings) links.
    if (!href || href.charAt(0) === "#") return;
    if (href.indexOf("/settings") === 0) return;
    if (href.charAt(0) !== "/" && href.indexOf("http") !== 0) return;

    var intro = window.__settingsGuardIntro || "You have unsaved changes:";
    var outro = window.__settingsGuardOutro || "Leave without saving?";
    var lines = window.__settingsChanges || [];
    var msg = intro + "\n\n" + lines.join("\n") + "\n\n" + outro;
    if (!window.confirm(msg)) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      window.__settingsDirty = false;
    }
  }, true);
})();
