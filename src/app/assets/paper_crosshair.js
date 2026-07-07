/* Cursor price crosshair + cursor-pinned hover box for the Paper Trading charts.
 *
 * Plotly draws the vertical x-spike (see add_cursor_spike) but has no native axis
 * label for spikelines, so this adds the horizontal half: a dotted line that tracks
 * the cursor height plus a small price box sitting over the y-axis ticks — like a
 * TradingView crosshair. It reads the live plot geometry from Plotly's internal
 * `_fullLayout` (plot-area size + linear y range).
 *
 * It also moves Plotly's unified hover box (`.hoverlayer .legend`) to follow the
 * cursor: its top-left corner sits just below-right of the cursor (flipping left/up
 * near the right/bottom edges). Plotly throttles its own hover redraw and keeps
 * re-anchoring the box to the trace point, so we re-apply our position every animation
 * frame while hovering — rAF is paint-synced, so the box never visibly snaps back.
 *
 * Listeners live on `document` so they survive Dash's re-renders; the crosshair overlay
 * divs are `pointer-events:none`, so Plotly's own hover keeps working.
 */
(function () {
  var last = null;                 // gd (.js-plotly-plot) currently hovered
  var cur = { px: 0, py: 0 };      // cursor position within that gd
  var raf = null;

  function ensureOverlay(gd) {
    if (gd._xhair && gd._xhair.line.isConnected) return gd._xhair;
    var line = document.createElement("div");
    line.className = "xhair-line";
    var label = document.createElement("div");
    label.className = "xhair-label";
    gd.appendChild(line);
    gd.appendChild(label);
    gd._xhair = { line: line, label: label };
    return gd._xhair;
  }

  function hide(gd) {
    if (gd && gd._xhair) {
      gd._xhair.line.style.display = "none";
      gd._xhair.label.style.display = "none";
    }
  }

  function fmt(v) {
    return v.toLocaleString("en-US", { minimumFractionDigits: 2,
                                       maximumFractionDigits: 2 });
  }

  // Pin Plotly's unified hover box so its top-left corner sits just below-right of the
  // cursor, flipping left/up when it would overflow the right/bottom of the plot area.
  function positionHoverBox(gd) {
    var fl = gd._fullLayout;
    if (!fl || !fl._size) return;
    var s = fl._size;
    var hover = gd.querySelector(".hoverlayer .legend");
    if (!hover) return;
    var bb;
    try { bb = hover.getBBox(); } catch (e) { return; }
    if (!bb || !bb.width) return;

    var gap = 12;
    var tx = cur.px + gap - bb.x;   // default: top-left near cursor (lower-right)
    var ty = cur.py + gap - bb.y;
    if (tx + bb.x + bb.width > s.l + s.w) {         // too far right → flip to the left
      tx = cur.px - gap - bb.width - bb.x;
    }
    if (ty + bb.y + bb.height > s.t + s.h) {        // too low → flip above the cursor
      ty = cur.py - gap - bb.height - bb.y;
    }
    hover.setAttribute("transform", "translate(" + tx + "," + ty + ")");
  }

  function loop() {
    if (last) {
      positionHoverBox(last);
      raf = requestAnimationFrame(loop);
    } else {
      raf = null;
    }
  }

  document.addEventListener("mousemove", function (e) {
    var gd = e.target && e.target.closest ? e.target.closest(".js-plotly-plot") : null;
    if (last && last !== gd) { hide(last); last = null; }
    if (!gd || !gd.closest("#paper-main")) { last = null; return; }

    var fl = gd._fullLayout;
    if (!fl || !fl._size || !fl.yaxis || !fl.yaxis.range) { hide(gd); last = null; return; }
    var s = fl._size, ya = fl.yaxis;
    var rect = gd.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;

    // Only inside the plot area (not over margins / axes).
    if (px < s.l || px > s.l + s.w || py < s.t || py > s.t + s.h) {
      hide(gd); last = null; return;
    }

    cur.px = px; cur.py = py; last = gd;

    var dataY = ya.range[1] - (py - s.t) / s.h * (ya.range[1] - ya.range[0]);
    var ov = ensureOverlay(gd);

    ov.line.style.display = "block";
    ov.line.style.left = s.l + "px";
    ov.line.style.width = s.w + "px";
    ov.line.style.top = py + "px";

    ov.label.style.display = "block";
    ov.label.textContent = fmt(dataY);
    ov.label.style.top = py + "px";
    ov.label.style.left = s.l + "px";

    positionHoverBox(gd);
    if (!raf) raf = requestAnimationFrame(loop);   // keep it pinned between mouse moves
  });

  // Hide when the pointer leaves any element (e.g. leaves the graph/window).
  document.addEventListener("mouseleave", function () {
    if (last) { hide(last); last = null; }
  }, true);
})();
