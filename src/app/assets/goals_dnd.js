/* Pointer-based drag-to-reorder for the Financial Goals list.
 *
 * Mirrors budget_dnd.js, but sorts a single vertical list instead of moving
 * chips between columns:
 *   mousedown on a .goal-row → past a small threshold a floating clone follows
 *   the cursor and the row is live-reordered among its siblings → mouseup pushes
 *   the new order to `goals-order-store`. A press with no movement is a tap and
 *   toggles the goal's selection via `goals-select-store`.
 *
 * Both stores are dcc.Stores; Dash callbacks persist the order / update the
 * gauge and re-render the list (React then owns the authoritative DOM). Listeners
 * live on the document so they survive Dash's client-side navigation.
 */
(function () {
  var THRESHOLD = 5;        // px before a press becomes a drag
  var cand = null;          // row under an active press
  var goal = null;          // its data-goal
  var startX = 0, startY = 0;
  var moved = false;
  var clone = null;

  function setProps(id, props) {
    if (window.dash_clientside && window.dash_clientside.set_props) {
      window.dash_clientside.set_props(id, props);
    }
  }

  function pushOrder() {
    var order = [];
    document.querySelectorAll("#goals-list .goal-row").forEach(function (r) {
      order.push(r.getAttribute("data-goal"));
    });
    setProps("goals-order-store", { data: order });
  }

  function pushSelected(toggled) {
    var sel = [];
    document.querySelectorAll("#goals-list .goal-row").forEach(function (r) {
      var g = r.getAttribute("data-goal");
      var on = r.classList.contains("selected");
      if (g === toggled) on = !on;     // flip the tapped row
      if (on) sel.push(g);
    });
    setProps("goals-select-store", { data: sel });
  }

  // The first row whose vertical midpoint is below the cursor (insert before it).
  function rowUnder(y) {
    var rows = document.querySelectorAll("#goals-list .goal-row:not(.dragging)");
    for (var i = 0; i < rows.length; i++) {
      var box = rows[i].getBoundingClientRect();
      if (y < box.top + box.height / 2) return rows[i];
    }
    return null;  // past the last row → append
  }

  function cleanup() {
    if (clone) { clone.remove(); clone = null; }
    if (cand) cand.classList.remove("dragging");
    cand = null; goal = null; moved = false;
  }

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var row = e.target.closest && e.target.closest("#goals-list .goal-row");
    if (!row) return;
    cand = row;
    goal = row.getAttribute("data-goal");
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
      clone.classList.add("goal-drag-clone");
      clone.style.width = cand.offsetWidth + "px";
      document.body.appendChild(clone);
      cand.classList.add("dragging");
    }
    clone.style.left = (e.clientX + 10) + "px";
    clone.style.top = (e.clientY + 10) + "px";
    var list = document.getElementById("goals-list");
    if (!list) return;
    var ref = rowUnder(e.clientY);
    if (ref) list.insertBefore(cand, ref);
    else list.appendChild(cand);
  });

  document.addEventListener("mouseup", function (e) {
    if (!cand) return;
    var theGoal = goal, didMove = moved;
    cleanup();
    if (didMove) pushOrder();
    else pushSelected(theGoal);
  });
})();
