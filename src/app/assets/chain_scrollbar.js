/* Always-visible scroll indicator for the option-chain table.
 *
 * macOS overlay scrollbars auto-hide (and current Chrome ignores
 * ::-webkit-scrollbar styling under that setting), so `.paper-chain-outer`
 * renders its own track+thumb next to the scroller and this script keeps the
 * thumb's size/position in sync. Scroll events don't bubble, so listen in the
 * capture phase; a MutationObserver re-syncs after Dash re-renders the chain.
 */
(function () {
  function sync(sc) {
    var outer = sc.closest && sc.closest(".paper-chain-outer");
    var thumb = outer && outer.querySelector(".paper-scroll-thumb");
    if (!thumb) return;
    var h = sc.clientHeight, sh = sc.scrollHeight;
    if (sh <= h + 1) {                      // nothing to scroll — full thumb
      thumb.style.top = "0%";
      thumb.style.height = "100%";
      return;
    }
    thumb.style.height = Math.max(8, (h / sh) * 100) + "%";
    thumb.style.top = (sc.scrollTop / sh) * 100 + "%";
  }

  function syncAll() {
    document.querySelectorAll(".paper-chain-scroll").forEach(sync);
  }

  document.addEventListener("scroll", function (e) {
    if (e.target && e.target.classList
        && e.target.classList.contains("paper-chain-scroll")) {
      sync(e.target);
    }
  }, true);

  new MutationObserver(syncAll).observe(document.documentElement,
                                        { childList: true, subtree: true });
})();
