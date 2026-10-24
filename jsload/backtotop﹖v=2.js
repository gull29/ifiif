(function () {
  if (document.getElementById("backToTop")) return;

  // Phone game pages replace this with a sticky "play this game" mini-bar in
  // the same corner -- /jsload/iphone-play.js sets the flag when it has
  // actually built the play gate, i.e. only on a phone, only on /g/<slug>.
  // That file is deferred and sits far above this one, so the flag is already
  // there by the time we run. Everywhere else -- every non-game page, and
  // every game page on a Chromebook, tablet or desktop -- is untouched and
  // keeps this button.
  if (window.PZ_NO_BACK_TO_TOP) return;

  var style = document.createElement("style");
  style.textContent =
    ".back-to-top{position:fixed;right:22px;bottom:22px;width:48px;height:48px;border-radius:50%;border:0;" +
    "background:#f0d210;color:#171717;cursor:pointer;z-index:900;opacity:0;pointer-events:none;" +
    "transform:translateY(12px);transition:opacity .25s ease,transform .25s cubic-bezier(.2,.9,.3,1.2),background-color .2s ease;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;}" +
    ".back-to-top.show{opacity:1;pointer-events:auto;transform:translateY(0);}" +
    ".back-to-top:hover{background:#fc5849;color:#fff;}" +
    ".back-to-top svg{width:22px;height:22px;display:block;}" +
    "@media (max-width:500px){.back-to-top{right:14px;bottom:14px;width:42px;height:42px;}}";
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.id = "backToTop";
  btn.className = "back-to-top";
  btn.type = "button";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>';
  document.body.appendChild(btn);

  var onScroll = function () {
    var y = window.scrollY || document.documentElement.scrollTop;
    btn.classList.toggle("show", y > 600);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
