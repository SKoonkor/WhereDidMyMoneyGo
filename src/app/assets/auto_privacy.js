/* Auto-privacy: hide amounts after the Home page sits idle.
 *
 * When the Home page is showing and auto-privacy is enabled (config comes from
 * the hidden #home-privacy-cfg element the page renders from settings.toml), a
 * period of no user activity flips the app into censor mode — exactly as if the
 * eye toggle had been pressed. Per the design, activity does NOT bring the
 * amounts back: once hidden, only clicking the eye restores them (which then
 * re-arms the idle timer).
 *
 * Listeners live on the document so they survive Dash's client-side navigation;
 * the config element only exists on Home, so cfg() returns null elsewhere and
 * the timer disarms.
 */
(function () {
  var ACTIVITY = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
  var timer = null;

  function cfg() {
    var el = document.getElementById("home-privacy-cfg");
    if (!el) return null;  // not on the Home page
    return {
      enabled: el.getAttribute("data-enabled") === "1",
      seconds: parseInt(el.getAttribute("data-seconds") || "10", 10) || 10,
    };
  }

  function isCensored() {
    return document.documentElement.getAttribute("data-censor") === "on";
  }

  function setCensored() {
    document.documentElement.setAttribute("data-censor", "on");
    if (window.dash_clientside && window.dash_clientside.set_props) {
      // Update the store so figure callbacks re-render in privacy mode too.
      window.dash_clientside.set_props("censor-store", { data: true });
    }
  }

  function clear() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // Arm (or re-arm) the idle countdown. Called on user activity, so activity
  // keeps pushing the deadline out — until the app is already censored, where we
  // stay put and wait for the eye toggle instead.
  function arm() {
    var c = cfg();
    if (!c || !c.enabled || isCensored()) { clear(); return; }
    clear();
    timer = setTimeout(function () {
      timer = null;
      if (cfg() && !isCensored()) setCensored();
    }, Math.max(1, c.seconds) * 1000);
  }

  ACTIVITY.forEach(function (ev) {
    document.addEventListener(ev, arm, true);
  });

  // Heartbeat: arm once we land on Home (or after the eye clears censoring), and
  // disarm when we leave or are already private. Doesn't reset a live countdown.
  setInterval(function () {
    var c = cfg();
    if (c && c.enabled && !isCensored() && !timer) arm();
    else if ((!c || !c.enabled || isCensored()) && timer) clear();
  }, 1500);
})();
