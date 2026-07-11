/* Pointer-based drag-and-drop for the "Manage categories" expense board.
 *
 * Each column is an expense category; each chip is one of its subcategories.
 * Dragging a subcategory chip into another column moves it to that category
 * (reassigning its parent everywhere, incl. past transactions) — the move
 * {sub, from, to} is pushed to the `manage-submove` dcc.Store and a Dash
 * callback applies it and re-renders. A press with no movement is a tap on an
 * element carrying `data-select="kind|category"` (an expense column or an income
 * card) and selects that category via `manage-cat-selected`, opening the detail
 * panel. While dragging near the left/right edge the board auto-scrolls so
 * categories that are off-screen can still be reached.
 *
 * Listeners live on the document so they survive Dash's client-side navigation.
 */
(function () {
  var THRESHOLD = 5;        // px before a press becomes a drag
  var EDGE = 60;            // px from a board edge that triggers auto-scroll
  var SCROLL_STEP = 16;     // px scrolled per animation frame
  var cand = null;          // subcategory chip being dragged
  var originCat = null;     // its starting category
  var selectKey = null;     // "kind|category" to select on a plain tap
  var startX = 0, startY = 0, lastX = 0, lastY = 0;
  var moved = false;
  var clone = null;
  var board = null;         // #manage-cat-cols scroll container
  var scrollDir = 0, rafId = 0;

  function setProps(id, props) {
    if (window.dash_clientside && window.dash_clientside.set_props) {
      window.dash_clientside.set_props(id, props);
    }
  }

  function colUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("#manage-cat-cols .manage-col") : null;
  }

  function clearHover() {
    document.querySelectorAll(".manage-col.drop-hover")
      .forEach(function (c) { c.classList.remove("drop-hover"); });
  }

  function updateHover(x, y) {
    clearHover();
    var col = colUnder(x, y);
    if (col) {
      col.classList.add("drop-hover");
      var list = col.querySelector(".manage-chip-list");
      if (list && cand && cand.parentNode !== list) list.appendChild(cand);
    }
  }

  function tick() {
    rafId = 0;
    if (!cand || !scrollDir || !board) return;
    board.scrollLeft += scrollDir * SCROLL_STEP;
    updateHover(lastX, lastY);           // reveal newly on-screen columns as targets
    if (clone) {
      clone.style.left = (lastX + 10) + "px";
      clone.style.top = (lastY + 10) + "px";
    }
    rafId = requestAnimationFrame(tick);
  }

  function startScroll() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function stopScroll() {
    scrollDir = 0;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function cleanup() {
    stopScroll();
    if (clone) { clone.remove(); clone = null; }
    if (cand) cand.classList.remove("dragging");
    clearHover();
    cand = null; originCat = null; selectKey = null; moved = false; board = null;
  }

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !e.target.closest) return;
    var chip = e.target.closest("#manage-cat-cols .manage-chip[data-sub]");
    var selEl = e.target.closest("[data-select]");
    if (chip) {
      // Draggable subcategory chip; tapping it selects its parent category.
      var col = chip.closest("#manage-cat-cols .manage-col");
      cand = chip;
      originCat = col ? col.getAttribute("data-cat") : null;
      selectKey = selEl ? selEl.getAttribute("data-select") : null;
      startX = e.clientX; startY = e.clientY; lastX = e.clientX; lastY = e.clientY;
      moved = false;
      e.preventDefault();          // avoid text selection while dragging
    } else if (selEl) {
      // Non-draggable tap target (income card / column header / empty column).
      selectKey = selEl.getAttribute("data-select");
      startX = e.clientX; startY = e.clientY;
      moved = false;
    }
  });

  document.addEventListener("mousemove", function (e) {
    if (!cand) return;               // only subcategory chips drag
    lastX = e.clientX; lastY = e.clientY;
    if (!moved) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < THRESHOLD) return;
      moved = true;
      board = document.getElementById("manage-cat-cols");
      clone = cand.cloneNode(true);
      clone.classList.add("budget-drag-clone");
      clone.style.width = cand.offsetWidth + "px";
      document.body.appendChild(clone);
      cand.classList.add("dragging");
    }
    clone.style.left = (e.clientX + 10) + "px";
    clone.style.top = (e.clientY + 10) + "px";
    updateHover(e.clientX, e.clientY);
    // Auto-scroll when the pointer nears a horizontal edge of the board.
    if (board) {
      var r = board.getBoundingClientRect();
      if (e.clientX > r.right - EDGE) scrollDir = 1;
      else if (e.clientX < r.left + EDGE) scrollDir = -1;
      else scrollDir = 0;
      if (scrollDir) startScroll(); else stopScroll();
    }
  });

  document.addEventListener("mouseup", function (e) {
    if (cand) {
      var sub = cand.getAttribute("data-sub"), from = originCat, didMove = moved;
      var col = colUnder(e.clientX, e.clientY);
      var to = col ? col.getAttribute("data-cat") : null;
      var key = selectKey;
      cleanup();
      if (didMove) {
        if (to && to !== from) setProps("manage-submove", { data: { sub: sub, from: from, to: to } });
      } else if (key) {
        setProps("manage-cat-selected", { data: key });
      }
      return;
    }
    if (selectKey && !moved) {
      var k = selectKey; selectKey = null;
      setProps("manage-cat-selected", { data: k });
    }
    selectKey = null; moved = false;
  });
})();
