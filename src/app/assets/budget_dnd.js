/* Pointer-based drag-and-drop for the Budget "Category buckets" board.
 *
 * Native HTML5 DnD proved unreliable here (a trailing click after the drop
 * flipped the chip straight back), so this uses plain mouse events instead:
 *   mousedown on a .budget-chip → past a small move threshold a floating clone
 *   follows the cursor → mouseup over a .budget-col drops it there. A press with
 *   no movement is treated as a tap and flips the chip to the other bucket.
 *
 * The board is store-driven: on drop/tap we push the full {category: bucket}
 * map into the `budget-assign-store` dcc.Store; a Dash callback re-renders the
 * columns (React owns the DOM) and persists the change. Listeners live on the
 * document so they survive Dash's client-side navigation and re-renders.
 */
(function () {
  var THRESHOLD = 5;             // px before a press becomes a drag
  var cand = null;               // chip under an active press
  var cat = null;                // its data-cat
  var startX = 0, startY = 0;
  var moved = false;
  var clone = null;

  function colUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest(".budget-col") : null;
  }

  function clearHover() {
    document.querySelectorAll(".budget-col.drop-hover")
      .forEach(function (c) { c.classList.remove("drop-hover"); });
  }

  function isLocked(chip) {
    return chip && chip.getAttribute("data-locked") === "1";
  }

  function showToast(msg) {
    var t = document.createElement("div");
    t.className = "budget-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 300);
    }, 2200);
  }

  function pushMap(movedCat, bucket) {
    var map = {};
    document.querySelectorAll(".budget-col").forEach(function (col) {
      var b = col.getAttribute("data-bucket");
      col.querySelectorAll(".budget-chip").forEach(function (chip) {
        if (isLocked(chip)) return;  // locked chips (Hidden cost) are never stored
        map[chip.getAttribute("data-cat")] = b;
      });
    });
    map[movedCat] = bucket;
    if (window.dash_clientside && window.dash_clientside.set_props) {
      window.dash_clientside.set_props("budget-assign-store", { data: map });
    }
  }

  var LOCK_MSG = "Hidden cost can’t be moved to Needs.";

  function cleanup() {
    if (clone) { clone.remove(); clone = null; }
    if (cand) cand.classList.remove("dragging");
    clearHover();
    cand = null; cat = null; moved = false;
  }

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var chip = e.target.closest && e.target.closest(".budget-chip");
    if (!chip) return;
    cand = chip;
    cat = chip.getAttribute("data-cat");
    startX = e.clientX; startY = e.clientY;
    moved = false;
    e.preventDefault();          // avoid text selection while dragging
  });

  document.addEventListener("mousemove", function (e) {
    if (!cand) return;
    if (!moved) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < THRESHOLD) return;
      moved = true;
      clone = cand.cloneNode(true);
      clone.classList.add("budget-drag-clone");
      clone.style.width = cand.offsetWidth + "px";
      document.body.appendChild(clone);
      cand.classList.add("dragging");
    }
    clone.style.left = (e.clientX + 10) + "px";
    clone.style.top = (e.clientY + 10) + "px";
    clearHover();
    var col = colUnder(e.clientX, e.clientY);
    if (col) col.classList.add("drop-hover");
  });

  document.addEventListener("mouseup", function (e) {
    if (!cand) return;
    var theCat = cat, didMove = moved, chip = cand, locked = isLocked(cand);
    if (didMove) {
      var col = colUnder(e.clientX, e.clientY);
      cleanup();
      if (!col) return;
      var bucket = col.getAttribute("data-bucket");
      if (locked) { if (bucket === "Needs") showToast(LOCK_MSG); }
      else pushMap(theCat, bucket);
    } else {
      // Tap with no drag → flip to the other bucket.
      var cur = chip.closest(".budget-col");
      var other = Array.from(document.querySelectorAll(".budget-col"))
        .find(function (c) { return c !== cur; });
      cleanup();
      if (locked) { showToast(LOCK_MSG); }
      else if (other) pushMap(theCat, other.getAttribute("data-bucket"));
    }
  });
})();
