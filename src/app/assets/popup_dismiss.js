/* Click-outside-to-dismiss for the header "☰ Menu" dropdown and for modal
 * pop-ups (so they behave like the calendar popup).
 *
 *  - Menu: clicking #menu-toggle flips #menu-dropdown open/closed; a click
 *    anywhere outside the open dropdown closes it. The JS fully owns the menu's
 *    open state (the old Dash parity callback was removed).
 *  - Modals: clicking the backdrop of a `.modal-overlay` that carries
 *    `data-close="<id>"` (the overlay element itself, not a child card) triggers
 *    that close button, so the existing Dash close callback runs. Clicks inside
 *    the `.modal-card` never match, so they don't dismiss it.
 *
 * One document listener; survives Dash's client-side navigation.
 */
(function () {
  // Close: hide and clear any inline position overrides so the next open
  // recomputes from the CSS default (absolute, right:0 under the button).
  function closeMenu(menu) {
    menu.style.display = "none";
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
  }

  // Open: show, then if the natural (right-aligned) dropdown would run off
  // either screen edge, re-anchor it as a viewport-fixed box clamped to kiss
  // the nearer edge. No overflow ⇒ no override, so desktop is untouched.
  function openMenu(menu) {
    closeMenu(menu);                 // reset overrides before measuring
    menu.style.display = "block";
    var btn = document.getElementById("menu-toggle");
    if (!btn) return;
    var r = menu.getBoundingClientRect();
    var m = 8;
    var vw = document.documentElement.clientWidth;
    if (r.left < m || r.right > vw - m) {
      var b = btn.getBoundingClientRect();
      var left = Math.min(Math.max(b.right - r.width, m), vw - r.width - m);
      menu.style.position = "fixed";
      menu.style.top = (b.bottom + 6) + "px";
      menu.style.left = left + "px";
      menu.style.right = "auto";
    }
  }

  document.addEventListener("click", function (e) {
    var menu = document.getElementById("menu-dropdown");
    if (menu) {
      var onToggle = e.target.closest && e.target.closest("#menu-toggle");
      if (onToggle) {
        if (menu.style.display === "block") { closeMenu(menu); }
        else { openMenu(menu); }
      } else if (menu.style.display === "block"
                 && !(menu.contains && menu.contains(e.target))) {
        closeMenu(menu);
      }
    }

    // Paper-trading dropdowns (Buy/Sell side, qty mode): same toggle/outside-
    // dismiss as the menu, except a click on an item (inside the dropdown)
    // also closes it — the item buttons are Dash components whose n_clicks
    // still fire.
    [["paper-side-toggle", "paper-side-dd"],
     ["paper-mode-toggle", "paper-mode-dd"]].forEach(function (pair) {
      var dd = document.getElementById(pair[1]);
      if (!dd) return;
      var onToggle = e.target.closest && e.target.closest("#" + pair[0]);
      if (onToggle) {
        dd.style.display = (dd.style.display === "block") ? "none" : "block";
      } else if (dd.style.display === "block") {
        dd.style.display = "none";
      }
    });

    if (e.target.classList && e.target.classList.contains("modal-overlay")) {
      var cid = e.target.getAttribute("data-close");
      if (cid) {
        var btn = document.getElementById(cid);
        if (btn) btn.click();
      }
    }
  });
})();
