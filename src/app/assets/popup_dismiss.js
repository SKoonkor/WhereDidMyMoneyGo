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
  document.addEventListener("click", function (e) {
    var menu = document.getElementById("menu-dropdown");
    if (menu) {
      var onToggle = e.target.closest && e.target.closest("#menu-toggle");
      if (onToggle) {
        menu.style.display = (menu.style.display === "block") ? "none" : "block";
      } else if (menu.style.display === "block"
                 && !(menu.contains && menu.contains(e.target))) {
        menu.style.display = "none";
      }
    }

    if (e.target.classList && e.target.classList.contains("modal-overlay")) {
      var cid = e.target.getAttribute("data-close");
      if (cid) {
        var btn = document.getElementById(cid);
        if (btn) btn.click();
      }
    }
  });
})();
