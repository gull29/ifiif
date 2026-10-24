/* analytics.js - GA4 for pizzaedition.com.
 * Events: page_view (gtag config), game_start (game page loaded),
 * game_click (a link to a game page was clicked; from_page_type says where),
 * game_engaged (30 s of visible time on a game page).
 * Every event carries experiment_variant from the `exp` cookie (set by experiment.js).
 */

(function (w, d) {
  var GA_ID = "G-ZL2MS6ZDBK";
  var ENGAGED_MS = 30000;
  var CATEGORIES = { action: 1, racing: 1, sports: 1, puzzle: 1, platformer: 1,
                     shooter: 1, "2player": 1, clicker: 1, horror: 1, casual: 1 };

  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }

  function readCookie(name) {
    try {
      var m = d.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function variant() {
    if (w.PZ_EXP && w.PZ_EXP.variant) return w.PZ_EXP.variant;
    var v = readCookie("exp");
    return (v === "A" || v === "B") ? v : "none";
  }
  function experimentId() {
    return (w.PZ_EXP && w.PZ_EXP.tests && w.PZ_EXP.tests.length) ? w.PZ_EXP.tests.join(",") : "none";
  }

  // /g/<slug> is a game page unless <slug> is a category. Returns the slug or null.
  function gameSlug(path) {
    var m = /^\/g\/([a-z0-9-]+)\/?$/i.exec(path || "");
    if (!m) return null;
    var s = m[1].toLowerCase();
    return CATEGORIES[s] ? null : s;
  }
  function pageType(path) {
    if (path === "/" || path === "/index.html") return "home";
    if (gameSlug(path)) return "game";
    if (/^\/g\/?$/.test(path)) return "all_games";
    var m = /^\/g\/([a-z0-9]+)\/?$/i.exec(path);
    if (m && CATEGORIES[m[1].toLowerCase()]) return "category";
    if (path.indexOf("/popular") === 0) return "popular";
    if (path.indexOf("/search") === 0) return "search";
    return "other";
  }

  var path = location.pathname;
  var thisPageType = pageType(path);
  var thisGame = gameSlug(path);

  function track(name, params) {
    var p = params || {};
    p.experiment_variant = variant();
    p.experiment_id = experimentId();
    p.page_type = p.page_type || thisPageType;
    gtag("event", name, p);
  }
  w.PZ_track = track; // for one-off events from page scripts: PZ_track("name", {...})

  d.addEventListener("DOMContentLoaded", function () {
    var v = variant();

    // Google tag (gtag.js)
    var gaScript = d.createElement("script");
    gaScript.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    gaScript.async = true;
    d.head.appendChild(gaScript);
    gtag("js", new Date());
    gtag("set", { experiment_variant: v, experiment_id: experimentId() }); // on every event, page_view included
    gtag("config", GA_ID, { experiment_variant: v, experiment_id: experimentId(), page_type: thisPageType });

    // game_start + game_engaged on game pages
    var isGame = !!thisGame || !!d.querySelector("[data-embed-src]");
    if (isGame) {
      var game = thisGame || path;
      track("game_start", { game: game, page_type: "game" });

      // Count only time while the tab is visible; fire once at 30 s.
      var acc = 0, since = d.hidden ? 0 : Date.now(), fired = false, timer = null;
      function check() {
        if (fired) return;
        var total = acc + (since ? Date.now() - since : 0);
        if (total >= ENGAGED_MS) {
          fired = true;
          if (timer) clearInterval(timer);
          track("game_engaged", { game: game, page_type: "game", seconds: ENGAGED_MS / 1000 });
        }
      }
      d.addEventListener("visibilitychange", function () {
        var now = Date.now();
        if (d.hidden) { if (since) { acc += now - since; since = 0; } }
        else if (!since) { since = now; }
        check();
      });
      timer = setInterval(check, 1000);
    }

    // game_click: any click on a link that leads to a game page.
    // from_page_type "home" is the homepage -> game click-through metric.
    d.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el !== d && !(el.tagName === "A" && el.getAttribute("href"))) el = el.parentNode;
      if (!el || el === d) return;
      var href = el.getAttribute("href");
      var target;
      try { target = new URL(href, location.href); } catch (err) { return; }
      if (target.hostname !== location.hostname) return;
      var to = gameSlug(target.pathname);
      if (!to) return;
      track("game_click", {
        game: to,
        from_page_type: thisPageType,
        from_game: thisGame || "",
        link_text: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60)
      });
    }, true);
  });
})(window, document);
