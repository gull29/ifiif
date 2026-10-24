(function () {
  if (document.readyState === "complete") return;

  var style = document.createElement("style");
  style.textContent =
    "#pageLoadBar{position:fixed;top:0;left:0;height:3px;width:100%;" +
    "background:linear-gradient(90deg,#f0d210,#fc5849);" +
    "transform-origin:0 50%;transform:scaleX(0);" +
    "transition:transform .25s ease,opacity .4s ease;" +
    "z-index:2147483647;pointer-events:none;" +
    "box-shadow:0 0 8px rgba(240,210,16,.55);}";
  document.head.appendChild(style);

  var bar = document.createElement("div");
  bar.id = "pageLoadBar";
  (document.body || document.documentElement).appendChild(bar);

  var p = 0.08;
  bar.style.transform = "scaleX(" + p + ")";

  var timer = setInterval(function () {
    p += (0.9 - p) * 0.12;
    bar.style.transform = "scaleX(" + p + ")";
  }, 200);

  function done() {
    clearInterval(timer);
    bar.style.transform = "scaleX(1)";
    setTimeout(function () {
      bar.style.opacity = "0";
      setTimeout(function () { bar.remove(); }, 450);
    }, 200);
  }

  if (document.readyState === "complete") done();
  else window.addEventListener("load", done);
})();
