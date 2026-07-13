/* Click-to-toggle info popovers for form-field labels (the "ⓘ" buttons).
 *
 *  - Click a ".info-dot" to reveal its ".info-pop" details; click it again to hide.
 *  - Clicking anywhere else — or pressing Escape — closes any open popover.
 *  - A click inside an open popover keeps it open (e.g. to select the text).
 *
 * One document listener; survives Dash's client-side re-renders.
 */
(function () {
  function closeAll(except) {
    document.querySelectorAll(".info-wrap.open").forEach(function (w) {
      if (w !== except) w.classList.remove("open");
    });
  }

  document.addEventListener("click", function (e) {
    var dot = e.target.closest && e.target.closest(".info-dot");
    if (dot) {
      e.preventDefault();
      var wrap = dot.closest(".info-wrap");
      var wasOpen = wrap.classList.contains("open");
      closeAll(null);                       // close everything, including this one
      if (!wasOpen) wrap.classList.add("open");   // reopen only if it was closed
      return;
    }
    // Keep an open popover when clicking inside it; otherwise dismiss.
    if (e.target.closest && e.target.closest(".info-pop")) return;
    closeAll(null);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll(null);
  });
})();
