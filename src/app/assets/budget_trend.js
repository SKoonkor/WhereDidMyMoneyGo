/* Click-to-drill "Spending trend" selection for the Budget page.
 *
 *  - Click a category / sub-category row in the Sub-category detail table to toggle it
 *    into the trend view; the pies are replaced by a monthly-spend bar chart.
 *  - The ✕ button (or clicking outside the Spending card) exits back to the pies.
 *
 * A module-level `sel` array is the source of truth; every change is pushed into the
 * `budget-trend-sel` dcc.Store via set_props (the same pattern as budget_dnd.js), and a
 * Dash callback re-renders the title / view / chart. One document listener, so it
 * survives Dash's client-side re-renders.
 */
(function () {
  var sel = [];   // [{cat, sub}] — sub "" means the whole category (a group row)

  function push() {
    if (window.dash_clientside && window.dash_clientside.set_props) {
      window.dash_clientside.set_props("budget-trend-sel", { data: sel.slice() });
    }
  }

  function indexOf(cat, sub) {
    for (var i = 0; i < sel.length; i++) {
      if (sel[i].cat === cat && (sel[i].sub || "") === (sub || "")) return i;
    }
    return -1;
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    // ✕ close → exit the trend view.
    if (t.closest("#budget-trend-close")) {
      if (sel.length) { sel = []; push(); }
      return;
    }

    // A clickable category / sub-category row → toggle it in the selection.
    var row = t.closest(".subcat-clickable");
    if (row) {
      var cat = row.getAttribute("data-cat");
      var sub = row.getAttribute("data-sub") || "";
      var i = indexOf(cat, sub);
      if (i >= 0) sel.splice(i, 1); else sel.push({ cat: cat, sub: sub });
      push();
      return;
    }

    // Header chrome — the light/dark toggle, privacy toggle and menu dropdown — must
    // not dismiss the trend view (they only change theme/privacy or open a menu).
    if (t.closest(".theme-switch, .censor-toggle, .menu-btn, .menu-dropdown")) return;

    // Clicking anywhere else outside the Spending card dismisses the trend view.
    // Clicks inside it (sort headers, the chart itself) are left alone so
    // sorting/panning don't exit.
    if (sel.length && !t.closest(".budget-spending-card")) {
      sel = [];
      push();
    }
  });
})();
