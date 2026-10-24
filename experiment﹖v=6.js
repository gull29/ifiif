/* experiment.js - A/B assignment for pizzaedition.com (see CLAUDE.md, "A/B tests").
 * Every visitor gets variant "A" or "B" once, stored in the `exp` cookie.
 * Split ratio is SPLIT_A (below) - keep it at 0.5 when idle; only one test can
 * be in flight against this shared cookie at a time (there is one exp cookie,
 * not one per test), so a non-50/50 ratio is only safe while exactly one test
 * needs it.
 * Variants are applied client-side, so Cloudflare caching is unaffected.
 * analytics.js reads window.PZ_EXP.variant and sends it as experiment_variant on every GA4 event.
 * Loaded with `defer` before analytics.js, so the DOM is parsed when this runs.
 */
(function (w, d) {
  var COOKIE = "exp", DAYS = 30;
  var SPLIT_A = 0.5; // P(variant === "A"). 0.5 when no test needs otherwise.

  function readCookie(name) {
    var m = d.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, value) {
    d.cookie = name + "=" + value + "; path=/; max-age=" + (DAYS * 86400) +
      "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  }

  var variant = null;
  try { variant = readCookie(COOKIE); } catch (e) {}
  if (variant !== "A" && variant !== "B") {
    // No (valid) cookie: assign now. School devices that wipe cookies get re-assigned
    // each visit; that is expected and is why the minimum run is 5 days / 2,000 sessions
    // -- and it also means most of our audience converges on the current SPLIT_A fast,
    // rather than being stuck on whatever ratio was in effect when they were first seen.
    variant = Math.random() < SPLIT_A ? "A" : "B";
    try { writeCookie(COOKIE, variant); } catch (e) {}
  }
  try { d.documentElement.className += " exp-" + variant; } catch (e) {}

  /* Active tests. To start one (after "go"), add an entry:
   *   {
   *     id: "home-tiles-2026-09",          // short name, goes into GA4 as experiment_id
   *     surface: "homepage",               // homepage | game | category | ads | global-nav
   *     match: function (path) { return path === "/"; },
   *     apply: function (variant) {        // runs only for matching pages
   *       if (variant === "B") { ... change the DOM ... }   // "A" is always control
   *     }
   *   }
   * Rules: max 3 tests, never two on the same surface. Variant B changes only;
   * A stays as shipped. Prefer CSS hooks via the html.exp-B class when possible.
   */
  var TESTS = [

  ];

  function addSiteDedication() {
    if (!d.body || d.querySelector(".dedication, .pz-site-dedication")) return;

    var style = d.createElement("style");
    style.id = "pzSiteDedicationStyles";
    style.textContent =
      ".pz-site-dedication{" +
        "max-width:1100px;margin:42px auto 28px;padding:22px 20px;" +
        "border-top:1px solid rgba(240,210,16,.35);" +
        "border-bottom:1px solid rgba(255,255,255,.1);text-align:center;" +
        "color:#a7a7a7;font-family:Rubik,\"Segoe UI\",sans-serif}" +
      ".pz-site-dedication strong{" +
        "display:block;margin-bottom:8px;color:#f0d210;" +
        "font-family:\"Bebas Neue\",sans-serif;font-size:1.35rem;" +
        "font-weight:400;letter-spacing:.08em}" +
      ".pz-site-dedication span{font-size:.95rem;line-height:1.5}";
    (d.head || d.documentElement).appendChild(style);

    var section = d.createElement("section");
    section.className = "pz-site-dedication";
    section.setAttribute("aria-label", "Dedication");
    section.innerHTML = "<strong>In dedication to RSU 34</strong>" +
      "<span>Made by a student for students.</span>";
    d.body.appendChild(section);
  }

  addSiteDedication();

  /* hover-preview-video-2026-09 (2026-09-08): ran briefly at 75/25, then
   * pulled the same day -- the timing of the pages/session dip it was meant
   * to test turned out to predate the feature by many hours (see CLAUDE.md),
   * so it was never the right explanation and the owner asked to give
   * everyone the video back rather than keep testing it. */

  /* ------------------------------------------------------------------ *
   * Mobile nav icons — shipped 2026-09-07 (owner: "didn't want this one as
   * an A/B test, just apply it"). NOT an experiment: runs for every visitor,
   * regardless of the exp cookie. Was proposed and briefly run gated behind
   * variant B under id mobile-nav-icons-2026-09; promoted straight to
   * production same day, before that test could accumulate any real data —
   * so there are no results to report, this was a straight ship.
   *
   * Mobile only (<=900px, the site's existing nav breakpoint). Replaces the
   * always-open inline search box + settings gear + hamburger (and the
   * .pz-mobile category drawer it opened) with three icon buttons:
   *   [two-controllers] All Games -> /g      (categories now live on that page)
   *   [magnifier]       Search    -> expands the existing #navbarSearch in place
   *   [gear]            Settings  -> /settings   (same destination as today)
   *
   * Search sheet (added 2026-09-07, owner request, "do what Poki does"):
   * tapping Search opens the input AND a Categories grid underneath it, the
   * way Poki's mobile search sheet works. The grid is a clone of the page's
   * existing `.pz-mobile-cats` markup (so it costs nothing and never drifts
   * from the desktop category menu) and hides itself the moment the visitor
   * types, handing the space to the existing search dropdown.
   *
   * The logo (.navbar-left) is untouched and stays on the left.
   *
   * Desktop safety: every visual rule that shows anything sits inside
   * `@media (max-width: 900px)`, and both the button strip and the category
   * panel are `display:none` by default. So the injected DOM is inert above
   * 900px — nothing to undo on resize, the media query handles it.
   * ------------------------------------------------------------------ */
  try { (function applyMobileNav() {
      var nav = d.getElementById("pzNav");
      if (!nav) return;                                // page without the nav: no-op
      var inner = nav.querySelector(".pz-nav-inner");
      var search = d.getElementById("navbarSearch");
      if (!inner || !search) return;
      if (d.getElementById("pzExpNav3")) return;       // never double-apply

      /* ---------- CSS (mobile-gated only — ships to every visitor) ---------- */
      var css = [
        /* base: the new strip does not exist above the mobile breakpoint */
        ".pz-exp-nav3{display:none}",

        "@media (max-width:900px){",

        /* show the three new buttons, pushed to the right */
        ".pz-nav .pz-exp-nav3{display:flex;align-items:center;gap:2px;margin-left:auto;flex:0 0 auto}",

        /* retire the old mobile controls: gear, hamburger, drawer */
        ".pz-nav .pz-nav-inner>a.pz-icon-btn,",
        ".pz-nav .pz-burger,",
        ".pz-nav .pz-mobile{display:none!important}",

        /* collapse the search box; it is opened by the Search button */
        ".pz-nav .pz-search{display:none}",
        ".pz-nav.pz-exp-search-open .pz-nav-inner{gap:8px}",
        ".pz-nav.pz-exp-search-open .pz-search{display:block;flex:1 1 auto;min-width:0;margin-left:0}",
        /* while searching, the logo and the other two buttons step aside */
        ".pz-nav.pz-exp-search-open .navbar-left,",
        ".pz-nav.pz-exp-search-open .pz-exp-allgames,",
        ".pz-nav.pz-exp-search-open .pz-exp-settings{display:none}",

        /* magnifier <-> close icon swap on the Search button */
        ".pz-nav .pz-exp-ico-close{display:none}",
        ".pz-nav.pz-exp-search-open .pz-exp-ico-search{display:none}",
        ".pz-nav.pz-exp-search-open .pz-exp-ico-close{display:block}",

        /* the site rotates .pz-icon-btn svg 45deg on hover; right for the gear,
           wrong for a gamepad or a magnifier (the burger opts out the same way) */
        ".pz-nav .pz-exp-allgames:hover svg,",
        ".pz-nav .pz-exp-searchbtn:hover svg{transform:none}",

        /* the expanded header becomes an opaque sheet so the category panel
           does not show the page through the nav's backdrop blur */
        ".pz-nav.pz-exp-search-open{background:var(--pz-bg,#161616)}",

        /* category panel: rides under the search box while it is open, and
           steps out of the way as soon as the visitor types (the search
           dropdown takes that space) */
        ".pz-nav.pz-exp-search-open .pz-exp-cats{display:block}",
        ".pz-nav.pz-exp-search-open.pz-exp-typing .pz-exp-cats{display:none}",

        "}"
      ].join("");

      /* not media-gated: the panel is hidden by default everywhere, the rule
         above is what reveals it (and only below 900px) */
      css +=
        ".pz-exp-cats{display:none;max-width:1500px;margin:0 auto;padding:2px 16px 14px;" +
        "border-top:1px solid var(--pz-line,rgba(255,255,255,.1));" +
        "max-height:calc(100vh - 59px);overflow-y:auto;-webkit-overflow-scrolling:touch}" +
        ".pz-exp-cats-title{font-family:Rubik,sans-serif;font-size:11px;font-weight:800;" +
        "letter-spacing:.1em;text-transform:uppercase;color:#8d8d8d;margin:12px 10px 6px}" +
        ".pz-exp-cats-all{display:block;margin:8px 0 2px;padding:11px 10px;border-radius:10px;" +
        "background:rgba(255,255,255,.06);color:#fff;text-decoration:none;" +
        "font-family:inherit;font-size:20px;letter-spacing:.03em}" +
        ".pz-exp-cats-all:hover,.pz-exp-cats-all:focus-visible{background:var(--pz-accent,#f0d210);color:#111}";

      try {
        var style = d.createElement("style");
        style.id = "pzExpNavCss";
        style.appendChild(d.createTextNode(css));
        (d.head || d.documentElement).appendChild(style);
      } catch (e) {}

      /* ---------- icons ---------- *
       * Two controllers side by side, per the owner's reference to Poki's
       * "Play Together" tab. The front pad is the site's own gamepad idiom
       * (rounded body + d-pad + two face buttons, cf. the "casual" category
       * icon); the back pad is drawn as an open outline that stops exactly
       * where the front pad covers it, so the two read as separate objects
       * without needing a fill. viewBox 0 0 24 24, stroke-width 2, to match
       * the existing gear and magnifier. */
      var ICON_PADS =
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1.7 12.6A4.2 4.2 0 0 1 1.3 10.8V9.7a4.2 4.2 0 0 1 4.2-4.2h8.6a4.2 4.2 0 0 1 4.1 3.4"/>' +
        '<rect x="4.5" y="8.9" width="17" height="9.5" rx="4.2"/>' +
        '<path d="M9.3 11.65v4M7.3 13.65h4"/>' +
        '<circle cx="16.3" cy="12.2" r="1" fill="currentColor" stroke="none"/>' +
        '<circle cx="18.6" cy="14.9" r="1" fill="currentColor" stroke="none"/>' +
        '</svg>';

      // same magnifier as the one already inside the search box
      var ICON_SEARCH =
        '<svg class="pz-exp-ico-search" viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
        '<path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' +
        '<svg class="pz-exp-ico-close" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

      // reuse the gear already in the nav so the two can never drift apart
      var ICON_GEAR = "";
      try {
        var oldGear = inner.querySelector('a.pz-icon-btn[href="/settings"] svg');
        if (oldGear) ICON_GEAR = oldGear.outerHTML;
      } catch (e) {}
      if (!ICON_GEAR) {
        ICON_GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linejoin="round" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5.1-1.2 ' +
          '2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-2-1.2l-.4-2.6H9.3l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 ' +
          '2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h5.4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6.1-1.2Z"/></svg>';
      }

      /* ---------- build the strip ---------- */
      function track(item) {
        try { if (w.PZ_track) w.PZ_track("nav_click", { nav_item: item }); } catch (e) {}
      }

      var strip = d.createElement("div");
      strip.className = "pz-exp-nav3";
      strip.id = "pzExpNav3";

      var allGames = d.createElement("a");
      allGames.className = "pz-icon-btn pz-exp-allgames";
      allGames.href = "/g";
      allGames.setAttribute("aria-label", "All games");
      allGames.title = "All games";
      allGames.innerHTML = ICON_PADS;
      allGames.addEventListener("click", function () { track("all_games"); });

      var searchBtn = d.createElement("button");
      searchBtn.type = "button";
      searchBtn.className = "pz-icon-btn pz-exp-searchbtn";
      searchBtn.setAttribute("aria-label", "Search");
      searchBtn.setAttribute("aria-expanded", "false");
      searchBtn.setAttribute("aria-controls", "navbarSearch");
      searchBtn.title = "Search";
      searchBtn.innerHTML = ICON_SEARCH;

      var settings = d.createElement("a");
      settings.className = "pz-icon-btn pz-exp-settings";
      settings.href = "/settings";
      settings.setAttribute("aria-label", "Settings");
      settings.title = "Settings";
      settings.innerHTML = ICON_GEAR;
      settings.addEventListener("click", function () { track("settings"); });

      strip.appendChild(allGames);
      strip.appendChild(searchBtn);
      strip.appendChild(settings);
      inner.appendChild(strip);

      /* ---------- categories panel (opens with the search box) ---------- *
       * Poki's mobile search sheet lists the categories under the input; this
       * does the same. The grid is a clone of the `.pz-mobile-cats` block that
       * is already in every page's markup (retired drawer, still in the DOM),
       * so it costs no extra bytes and stays in sync with the nav's category
       * list and icons automatically. Fallback builds it from PZ_CAT_ICONS. */
      var CATS = [
        ["action", "Action"], ["racing", "Racing"], ["sports", "Sports"],
        ["puzzle", "Puzzle"], ["platformer", "Platformer"], ["shooter", "Shooter"],
        ["2player", "2 Player"], ["clicker", "Clicker & Idle"], ["horror", "Horror"],
        ["casual", "Casual"]
      ];

      function buildCatsGrid() {
        try {
          var existing = d.querySelector(".pz-mobile-cats");
          if (existing && existing.children.length) {
            var clone = existing.cloneNode(true);
            clone.removeAttribute("id");
            return clone;
          }
        } catch (e) {}
        // fallback: no drawer markup on this page, draw it from the icon map
        var icons = (w.PZ_CAT_ICONS || {});
        var grid = d.createElement("div");
        grid.className = "pz-mobile-cats";
        for (var i = 0; i < CATS.length; i++) {
          var a = d.createElement("a");
          a.className = "pz-mobile-cat";
          a.href = "/g/" + CATS[i][0];
          a.innerHTML = '<span class="pz-cat-badge">' + (icons[CATS[i][0]] || "") + "</span>";
          a.appendChild(d.createTextNode(CATS[i][1]));
          grid.appendChild(a);
        }
        return grid;
      }

      var catsPanel = d.createElement("div");
      catsPanel.className = "pz-exp-cats";
      catsPanel.id = "pzExpCats";
      catsPanel.setAttribute("aria-label", "Categories");
      var catsTitle = d.createElement("div");
      catsTitle.className = "pz-exp-cats-title";
      catsTitle.appendChild(d.createTextNode("Categories"));
      catsPanel.appendChild(catsTitle);
      var catsGrid = buildCatsGrid();
      catsPanel.appendChild(catsGrid);
      var catsAll = d.createElement("a");
      catsAll.className = "pz-exp-cats-all";
      catsAll.href = "/g";
      catsAll.appendChild(d.createTextNode("All games"));
      catsPanel.appendChild(catsAll);
      nav.appendChild(catsPanel);

      // one delegated listener for the whole panel, so GA4 sees the taps
      catsPanel.addEventListener("click", function (e) {
        try {
          var el = e.target;
          while (el && el !== catsPanel && el.tagName !== "A") el = el.parentNode;
          if (!el || el === catsPanel || !el.getAttribute) return;
          var href = el.getAttribute("href") || "";
          var slug = href.replace(/^\/g\/?/, "") || "all";
          track("search_panel_category:" + slug);
        } catch (er) {}
      });

      /* ---------- search expand / collapse ---------- *
       * Only a class on #pzNav; the input, dropdown and results are the
       * existing ones (searchlogic2.js), so search behaviour is unchanged. */
      var OPEN = "pz-exp-search-open";
      var TYPING = "pz-exp-typing";

      // categories show on an empty box; the search dropdown takes over once
      // the visitor starts typing (same as Poki's mobile search sheet)
      function syncTyping() {
        try {
          var input = search.querySelector("input");
          var typing = !!(input && input.value && input.value.trim());
          nav.classList.toggle(TYPING, typing);
        } catch (e) {}
      }
      try {
        var searchInput = search.querySelector("input");
        if (searchInput) {
          searchInput.addEventListener("input", syncTyping);
          searchInput.addEventListener("change", syncTyping);
        }
        // the site's own clear button empties the field without an input event
        search.addEventListener("click", function () { setTimeout(syncTyping, 0); });
      } catch (e) {}

      function setSearch(open) {
        try {
          nav.classList.toggle(OPEN, open);
          searchBtn.setAttribute("aria-expanded", open ? "true" : "false");
          searchBtn.setAttribute("aria-label", open ? "Close search" : "Search");
          syncTyping();
          var input = search.querySelector("input");
          if (!input) return;
          if (open) {
            // let the display change land before focusing (slow Chromebooks)
            setTimeout(function () { try { input.focus(); } catch (e) {} }, 0);
          } else {
            try { input.blur(); } catch (e) {}
          }
        } catch (e) {}
      }

      searchBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var open = !nav.classList.contains(OPEN);
        setSearch(open);
        if (open) track("search");
      });

      // tap anywhere outside the nav collapses it again
      d.addEventListener("click", function (e) {
        try {
          if (!nav.classList.contains(OPEN)) return;
          if (nav.contains(e.target)) return;
          setSearch(false);
        } catch (er) {}
      });
      d.addEventListener("keydown", function (e) {
        try {
          if (e.key === "Escape" && nav.classList.contains(OPEN)) setSearch(false);
        } catch (er) {}
      });
  })(); } catch (e) {
    if (w.console && console.error) console.error("mobile nav failed", e);
  }

  var path = location.pathname;
  var active = [];
  for (var i = 0; i < TESTS.length; i++) {
    var t = TESTS[i];
    try {
      if (t.match(path)) {
        t.apply(variant);
        active.push(t.id);
      }
    } catch (e) {
      if (w.console && console.error) console.error("experiment " + t.id + " failed", e);
    }
  }

  w.PZ_EXP = { variant: variant, tests: active, cookie: COOKIE };
})(window, document);
