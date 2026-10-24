/*
 * Phone play gate for game pages (iPhone and Android phones).
 *
 * iPhone Safari has no element Fullscreen API, so a tapped fullscreen button
 * can only ever give a pseudo-fullscreen. Rather than start the game inline and
 * offer that button, phones get a play button in place of the embed: the first
 * tap both loads the embed and opens it pseudo-fullscreen. Android phones take
 * the same path so the first tap fills the screen instead of leaving a
 * landscape game inside a small box; tablets, Chromebooks and TVs (no
 * "Mobile" token) keep the inline frame and native fullscreen button. The embed is asked
 * for its own bottom bar (?fs=1) so the exit control rides along with the game.
 *
 * The inline snippet beside #embed-frame has already parked the frame's src in
 * data-embed-src, so nothing loads before that tap.
 *
 * WHY THIS IS STILL USER-AGENT SNIFFING AND NOT A VIEWPORT-WIDTH CHECK
 * -------------------------------------------------------------------
 * The phone *layout* is a width question and lives in CSS at <=550.9px. This
 * gate is not a layout question: it exists because a device cannot put an
 * element into real fullscreen, which is a property of the browser, not of how
 * many pixels are currently across. Switching to a width test would get both
 * ends wrong -- an iPhone turned landscape is ~844px wide and would lose the
 * pseudo-fullscreen it is the whole reason for, and a small-windowed tablet or
 * Chromebook would gain a play gate it does not need because it has the real
 * Fullscreen API. So: layout by width, this gate by UA. Both are correct.
 *
 * WHAT THE GATE LOOKS LIKE (redesigned 2026-09-07, owner request: "like poki")
 * ---------------------------------------------------------------------------
 * The whole player box is one poster:
 *   - the game's artwork edge to edge (the same file the toolbar already
 *     shows, so it costs no extra request), upgraded after a beat to the short
 *     muted looping gameplay clip when the game has one;
 *   - the pulsing play button centred on top of it;
 *   - game name and creator bottom-left, over a gradient scrim so they stay
 *     readable on light artwork and on moving footage.
 * It is mounted on .game-container-inner rather than #fullscreen-wrapper so it
 * covers the game bar too -- otherwise the name and creator would appear twice,
 * once on the poster and again in the bar right beneath it.
 *
 * The clip list is NOT duplicated here. /jsload/hoverpreview.js owns it and
 * publishes it as window.PZ_PREVIEW_SLUGS; this file loads first, so it waits
 * for DOMContentLoaded before reading it. 186 of 278 games have a clip; the
 * other 92 simply keep the still artwork, which is a no-op, not a fallback.
 *
 * Nothing about the tap itself changed: still no embed until tapped, still
 * pseudo-fullscreen on iOS, still ?fs=1 for the embed's own bottom bar.
 *
 * LEAVING FULLSCREEN GOES BACK TO THE POSTER (owner request, 2026-09-07)
 * ---------------------------------------------------------------------
 * On a phone there is no state where the game sits inline. It is either
 * running pseudo-fullscreen or torn down behind the poster -- exit() unloads
 * the iframe and shows the poster again, so the page returns to exactly how it
 * loaded, and the poster is the only way back in. The toolbar's fullscreen
 * button therefore stays hidden for the life of the page. Tearing the frame
 * down also stops a finished game holding audio, CPU and battery. Desktop,
 * Chromebooks and tablets never reach this file and keep showing the inline
 * embed after a native fullscreen exit, exactly as before.
 */
(function () {
  if (!/iPhone|iPod|Android.*Mobile/.test(navigator.userAgent)) return;

  var STYLE_ID = "iphone-play-styles";
  var VIDEO_BASE = "/videos/preview/";
  // Keep in sync with hoverpreview.js's VIDEO_VERSION -- same files, same
  // cache-busting need. Bump both together whenever a clip's content changes.
  var VIDEO_VERSION = "2";
  // Long enough that someone who lands and bounces instantly never spends the
  // ~0.5MB, short enough that the poster is almost certainly still fully on
  // screen when the clip starts -- WebKit only autoplays a video that is
  // actually in the viewport, so a long delay races the visitor's first scroll
  // and can lose. Was 700ms; poki.com uses no delay at all, and this is the
  // compromise that keeps the bandwidth guard without fighting that rule.
  var VIDEO_DELAY_MS = 300;

  function mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      // The box is a plain static block in the stylesheet; the poster is
      // absolutely positioned against it. Harmless on its own.
      ".game-container-inner{position:relative}",
      "#iphone-play-overlay{position:absolute;inset:0;z-index:3;display:block;",
      "width:100%;height:100%;overflow:hidden;background:rgb(20,22,28);",
      "border:0;margin:0;padding:0;text-align:left;font:inherit;color:inherit;",
      "cursor:pointer;-webkit-tap-highlight-color:transparent;",
      "-webkit-appearance:none;appearance:none}",
      // Artwork is square-ish and the box is not, so cover-crop it exactly the
      // way the tiles and the hover clips already do. Never object-fit:fill.
      // The clip sits BEHIND the still and is always fully opaque; the STILL is
      // what fades, once playback has actually started. Never hide the video
      // with opacity/visibility and reveal it on `playing` -- WebKit refuses to
      // start playback on a media element whose own style is opacity:0, so that
      // arrangement deadlocks on iOS. See the long note in attachCoverVideo.
      "#iphone-play-overlay .ipo-art{position:absolute;inset:0;display:block;",
      "z-index:1;transition:opacity .3s ease}",
      "#iphone-play-overlay .ipo-art.ipo-art-faded{opacity:0}",
      "#iphone-play-overlay .ipo-art img,#iphone-play-overlay .ipo-video{",
      "position:absolute;top:0;left:0;display:block;width:100%;height:100%;",
      "object-fit:cover;object-position:center}",
      "#iphone-play-overlay .ipo-video{z-index:0;pointer-events:none;",
      "background:transparent}",
      "@media (prefers-reduced-motion:reduce){",
      "#iphone-play-overlay .ipo-art{transition:none}}",
      // Two jobs: darken the middle so a white play button reads on bright
      // artwork, and darken the bottom so the name and creator stay legible
      // over whatever the clip happens to be showing.
      "#iphone-play-overlay .ipo-scrim{position:absolute;inset:0;z-index:2;",
      "background:radial-gradient(circle at 50% 46%,rgba(6,14,25,.42),rgba(6,14,25,0) 58%),",
      "linear-gradient(180deg,rgba(6,14,25,0) 42%,rgba(6,14,25,.85) 100%)}",
      "#iphone-play-overlay .ipo-play{position:absolute;left:50%;top:50%;z-index:3;",
      "width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:9999px;",
      "background:rgb(75,92,219);display:flex;align-items:center;",
      "justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.5);",
      "animation:ipo-pulse 2.4s ease-out infinite}",
      "#iphone-play-overlay .ipo-play svg{width:32px;height:32px;",
      "margin-left:4px;fill:#fff}",
      "#iphone-play-overlay .ipo-meta{position:absolute;z-index:3;display:block;",
      "left:14px;right:14px;bottom:12px;text-align:left;",
      "font-family:'Rubik Toolbar','Rubik Fallback',Arial,sans-serif}",
      "#iphone-play-overlay .ipo-name{display:block;font-size:1.3125rem;",
      "font-weight:700;line-height:1.2;color:#fff;",
      "text-shadow:0 1px 6px rgba(0,0,0,.75);",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#iphone-play-overlay .ipo-by{display:block;margin-top:1px;",
      "font-size:.8125rem;font-weight:400;line-height:1.25;",
      "color:rgba(255,255,255,.8);text-shadow:0 1px 6px rgba(0,0,0,.75);",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#iphone-play-overlay:active .ipo-play{transform:scale(.94)}",
      "@keyframes ipo-pulse{0%{box-shadow:0 4px 16px rgba(0,0,0,.45),0 0 0 0 rgba(89,126,213,.6)}",
      "70%{box-shadow:0 4px 16px rgba(0,0,0,.45),0 0 0 22px rgba(89,126,213,0)}",
      "100%{box-shadow:0 4px 16px rgba(0,0,0,.45),0 0 0 0 rgba(89,126,213,0)}}",
      "@media (prefers-reduced-motion:reduce){#iphone-play-overlay .ipo-play{animation:none}}",
      // --- sticky mini-bar -------------------------------------------------
      // Slid out of frame rather than display:none so it can animate, and
      // pointer-events:none while it is off-screen so it can never eat a tap
      // meant for the page behind it. z-index sits above the page but well
      // below the nav's 1000 and the pseudo-fullscreen wrapper's max int.
      "#pz-mini-play{position:fixed;left:0;right:0;bottom:0;z-index:900;",
      "display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;",
      "margin:0;padding:9px 12px;",
      "padding-bottom:calc(9px + env(safe-area-inset-bottom,0px));",
      "border:0;border-top:1px solid rgba(255,255,255,.10);",
      "border-radius:16px 16px 0 0;text-align:left;font:inherit;color:inherit;",
      "background:var(--pz-panel,#1f1f1f);box-shadow:0 -8px 28px rgba(0,0,0,.55);",
      "cursor:pointer;-webkit-tap-highlight-color:transparent;",
      "-webkit-appearance:none;appearance:none;pointer-events:none;",
      "transform:translateY(115%);transition:transform .24s ease}",
      "#pz-mini-play.pzm-shown{transform:translateY(0);pointer-events:auto}",
      "#pz-mini-play .pzm-icon{position:relative;display:block;flex:0 0 auto;",
      "width:46px;height:46px;border-radius:11px;overflow:hidden}",
      "#pz-mini-play .pzm-icon img{position:static;display:block;width:100%;",
      "height:100%;object-fit:cover}",
      "#pz-mini-play .pzm-text{flex:1 1 auto;min-width:0;display:block}",
      "#pz-mini-play .pzm-name{display:block;",
      "font-family:'Bebas Neue','Bebas Neue Fallback',Arial,sans-serif;",
      "font-size:1.25rem;line-height:1.1;letter-spacing:.03em;color:#fff;",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#pz-mini-play .pzm-by{display:block;margin-top:1px;",
      "font-family:'Rubik Toolbar','Rubik Fallback',Arial,sans-serif;",
      "font-size:.75rem;font-weight:400;line-height:1.25;",
      "color:var(--pz-muted,#a7a7a7);",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      // Same blue and same glyph as the poster's play button, so the two read
      // as one control appearing in two places.
      "#pz-mini-play .pzm-play{flex:0 0 auto;width:46px;height:46px;",
      "border-radius:9999px;background:rgb(75,92,219);display:flex;",
      "align-items:center;justify-content:center;",
      "box-shadow:0 4px 14px rgba(0,0,0,.45)}",
      "#pz-mini-play .pzm-play svg{width:22px;height:22px;margin-left:2px;fill:#fff}",
      "#pz-mini-play:active{background:var(--pz-bg,#161616)}",
      "#pz-mini-play:active .pzm-play{transform:scale(.94)}",
      "@media (prefers-reduced-motion:reduce){#pz-mini-play{transition:none}}",
      // Anchor top-left and let the measured pixel size below decide the rest;
      // bottom/right would otherwise stretch the box to the fixed containing
      // block, which iOS sizes to the chrome-hidden viewport.
      "#fullscreen-wrapper.pseudo-fullscreen{top:0!important;left:0!important;",
      "right:auto!important;bottom:auto!important}"
    ].join("");
    document.head.appendChild(style);
  }

  // Reuse the artwork the page already ships in its toolbar; the image slug does
  // not always match the embed slug, so never derive it from the URL. Same URL
  // as the toolbar's own <img>, so it is one cache entry, not a second request.
  function artworkFor(title) {
    var source = document.querySelector(".game-toolbar picture source[type='image/avif']");
    var img = document.querySelector(".game-toolbar picture img");
    var avif = source && source.getAttribute("srcset");
    var png = img && img.getAttribute("src");
    var art = document.createElement("picture");
    art.className = "ipo-art";
    if (avif) {
      var s = document.createElement("source");
      s.setAttribute("srcset", avif);
      s.setAttribute("type", "image/avif");
      art.appendChild(s);
    }
    var i = document.createElement("img");
    i.setAttribute("src", png || "/favicon.ico");
    i.setAttribute("alt", "");
    i.setAttribute("aria-hidden", "true");
    art.appendChild(i);
    return art;
  }

  // The game bar already carries the two strings we want, correctly cased and
  // already localised into the page. Read them there rather than re-deriving
  // anything from the URL or from meta tags. ONE reader, shared by the poster
  // and the sticky mini-bar -- do not add a third way to get at these.
  function gameMeta(title) {
    var bar = document.querySelector(".game-toolbar");
    var nameEl = bar && bar.querySelector(".text-xl.font-bold");
    var byEl = bar && bar.querySelector(".text-sm.font-normal");
    return {
      name: (nameEl && nameEl.textContent.trim()) || title,
      by: ((byEl && byEl.textContent.trim()) || "").replace(/^by\s*:\s*/i, "")
    };
  }

  function playIconSvg() {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M8.6 5.2 19 12 8.6 18.8Z" fill="none" stroke="#fff" stroke-width="2.2" ' +
      'stroke-linejoin="round" stroke-linecap="round"/></svg>'
    );
  }

  function metaFor(title) {
    var m = gameMeta(title);
    var name = m.name;
    var by = m.by;

    var meta = document.createElement("span");
    meta.className = "ipo-meta";
    var n = document.createElement("span");
    n.className = "ipo-name";
    n.textContent = name;
    meta.appendChild(n);
    if (by) {
      var b = document.createElement("span");
      b.className = "ipo-by";
      b.textContent = by;
      meta.appendChild(b);
    }
    return meta;
  }

  function buildOverlay(title) {
    var overlay = document.createElement("button");
    overlay.id = "iphone-play-overlay";
    overlay.type = "button";
    overlay.setAttribute("aria-label", "Play " + title);

    overlay.appendChild(artworkFor(title));

    var scrim = document.createElement("div");
    scrim.className = "ipo-scrim";
    overlay.appendChild(scrim);

    var play = document.createElement("span");
    play.className = "ipo-play";
    play.innerHTML = playIconSvg();
    overlay.appendChild(play);

    overlay.appendChild(metaFor(title));

    return overlay;
  }

  /*
   * Sticky mini-bar (owner request 2026-09-07, modelled on Poki's).
   *
   * Once the poster has scrolled off the top, a bar pins to the bottom of the
   * screen: game icon, name and creator on the left, a round play button on
   * the right. Tapping anywhere on it starts the game.
   *
   * Same data as the poster (gameMeta / artworkFor) and the same tap path
   * (enter()) -- nothing about loading the embed is duplicated here.
   *
   * Poki's own bar is white; this one uses the site's dark tokens
   * (--pz-panel / --pz-muted from the nav's :root) with the poster's blue for
   * the play circle, so the two read as the same control in two places.
   */
  function buildMiniBar(title) {
    var m = gameMeta(title);

    var bar = document.createElement("button");
    bar.id = "pz-mini-play";
    bar.type = "button";
    bar.setAttribute("aria-label", "Play " + m.name);
    bar.setAttribute("aria-hidden", "true");

    var icon = artworkFor(title);
    icon.className = "pzm-icon";
    bar.appendChild(icon);

    var text = document.createElement("span");
    text.className = "pzm-text";
    var n = document.createElement("span");
    n.className = "pzm-name";
    n.textContent = m.name;
    text.appendChild(n);
    if (m.by) {
      var b = document.createElement("span");
      b.className = "pzm-by";
      b.textContent = m.by;
      text.appendChild(b);
    }
    bar.appendChild(text);

    var play = document.createElement("span");
    play.className = "pzm-play";
    play.innerHTML = playIconSvg();
    bar.appendChild(play);

    return bar;
  }

  // The live /g/<slug> segment, case-sensitive -- the same key hoverpreview.js
  // files its clips under.
  function currentSlug() {
    var m = /^\/g\/([^\/?#]+)/.exec(location.pathname || "");
    return m ? m[1] : null;
  }

  /*
   * Optional cover clip. Deliberately conservative, for the same reason
   * hoverpreview.js is: this is the only thing on the page that downloads
   * anything before the visitor asks for a game, so it must be easy to not do.
   * Skipped entirely when the browser has no <video>, when the visitor asked
   * for less motion, on Save-Data / 2G, when the game has no clip, and when
   * the tab is not actually being looked at.
   *
   * THE CLIP IS ALWAYS FULLY OPAQUE AND SITS BEHIND THE STILL. Do not "tidy"
   * this into the obvious shape -- video at opacity:0, faded in on `playing`.
   * That is what this did first and it never played a single frame on iOS, on
   * both Safari and Chrome (Chrome on iOS is WebKit too). WebKit's permission
   * check for starting playback without a user gesture inspects the media
   * element's OWN computed style and refuses when it is not visible, opacity:0
   * included. So the clip could not start until it was visible, and it was not
   * made visible until it started: a deadlock, and the reason the poster only
   * ever showed its still image on a real phone. Blink has no such check,
   * which is why it looked fine in every desktop and headless test.
   * Occlusion is fine -- WebKit looks at the element's own style, not at what
   * paints over it -- so the fix is to hide the clip behind an opaque image
   * rather than by making the clip itself transparent, and to fade THAT out
   * once playback is genuinely under way.
   */
  function attachCoverVideo(overlay, state) {
    function bail(why) { state.why = why; }

    if (state.done) return bail("already torn down");
    if (!("play" in document.createElement("video"))) return bail("no <video> support");
    // NOTE: this is a system-wide setting on iOS (Settings > Accessibility >
    // Motion > Reduce Motion) and both Safari and Chrome-on-iOS report it, so
    // it silently disables the clip on the whole device. That is deliberate,
    // but it looks identical to a bug from the outside -- hence ?pzdebug=1.
    if (mq("(prefers-reduced-motion: reduce)")) return bail("prefers-reduced-motion is ON");

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ""))) {
      return bail("Save-Data or 2G");
    }

    var has = window.PZ_PREVIEW_SLUGS;
    var slug = currentSlug();
    if (!has) return bail("PZ_PREVIEW_SLUGS missing (hoverpreview.js did not run)");
    if (!slug) return bail("no /g/<slug> in " + location.pathname);
    if (!has[slug]) return bail("no clip for " + slug);

    bail("waiting " + VIDEO_DELAY_MS + "ms");
    state.timer = setTimeout(function () {
      state.timer = null;
      if (state.done) return bail("torn down before start");
      if (document.hidden) return bail("tab hidden");
      if (overlay.hidden || !overlay.parentNode) return bail("poster not on screen");

      /*
       * Element shape copied from what poki.com actually ships, read off their
       * own mobile game page at runtime (390x844, iPhone UA) rather than
       * guessed: their cover clip sits at the same place ours does (358x358
       * over the poster) and carries
       *   autoplay=true (as an ATTRIBUTE), playsinline, loop, muted as a
       *   PROPERTY, no preload attribute at all, no poster
       * with a still <img> layered at the identical rect behind it -- the same
       * arrangement this file settled on for the WebKit opacity problem.
       *
       * Two real differences from what we had, both now adopted:
       *  - autoplay is declared on the element, so the browser's own autoplay
       *    algorithm starts the clip. We were setting autoplay=false and
       *    driving it entirely from a script play(), which is the weaker path:
       *    a script-initiated play() with no user activation is the one that
       *    reliably throws NotAllowedError.
       *  - no preload="none". It directly contradicts autoplay (autoplay means
       *    "load this"), and the two together are a confusing pair to hand
       *    WebKit. The bandwidth guard it was providing is preserved by the
       *    delay above instead: nothing is created, so nothing is fetched,
       *    until the visitor has been on the page a moment.
       *
       * Every attribute is set BEFORE src and BEFORE insertion, which is what
       * the autoplay algorithm inspects.
       */
      var v = document.createElement("video");
      v.className = "ipo-video";
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.loop = true;
      v.setAttribute("loop", "");
      v.autoplay = true;
      v.setAttribute("autoplay", "");
      v.controls = false;
      v.disablePictureInPicture = true;
      v.setAttribute("disableremoteplayback", "");
      // Decorative: the poster's own name, the bar and the page title all
      // already say which game this is.
      v.setAttribute("aria-hidden", "true");
      // Only once frames are genuinely on screen does the still get out of the
      // way. Fading the still rather than the clip is the whole fix; see above.
      v.addEventListener("playing", function () {
        if (state.done) return;
        state.why = "playing";
        var art = overlay.querySelector(".ipo-art");
        if (art) art.classList.add("ipo-art-faded");
      });
      // A missing or bad file must never blank the poster -- just leave the
      // still artwork showing on top and never ask again.
      v.addEventListener("error", function () {
        state.why = "media error " + (v.error ? v.error.code : "?");
        teardownVideo(state);
      });

      state.video = v;
      v.src = VIDEO_BASE + encodeURIComponent(slug) + ".mp4?v=" + VIDEO_VERSION;
      // First child: behind the still, which is behind the scrim, so the name
      // and creator stay readable whatever the footage is doing.
      overlay.insertBefore(v, overlay.firstChild);
      // The autoplay attribute above is what is expected to actually start it.
      // play() is still called as a belt-and-braces second path: if autoplay
      // already began, this resolves immediately and costs nothing, and if the
      // browser refuses, the rejection is what arms the first-touch retry.
      // No explicit load() any more -- with autoplay set and no preload
      // attribute, assigning src runs resource selection on its own.
      tryPlay(v, state, false);
    }, VIDEO_DELAY_MS);
  }

  /*
   * play(), with one retry on the visitor's first touch.
   *
   * iOS refuses autoplay for reasons we cannot see from here and cannot always
   * satisfy: Low Power Mode blocks it outright no matter how visible or muted
   * the element is, and there is no API to ask whether that is on. What it
   * never blocks is playback started from inside a real user gesture. So when
   * the first, unprompted attempt is refused we arm a one-shot listener and
   * try again from inside the visitor's first touch anywhere on the page --
   * which on a game page is usually just them starting to scroll, so it costs
   * them nothing and they see the clip start a moment later instead of never.
   *
   * touchstart AND click, because the same code runs on Android phones. The
   * listener is one-shot and is also dropped by teardownVideo, so a refusal
   * can never leave anything armed on the page.
   */
  function tryPlay(v, state, viaGesture) {
    function refused(err) {
      if (state.done || state.video !== v) return;
      state.why = (viaGesture ? "refused after gesture: " : "autoplay refused: ") +
        ((err && (err.name || err.message)) || "unknown");
      // Second failure means gestures do not help either -- stop holding a
      // decoder and a half-open request open for nothing.
      if (viaGesture) { teardownVideo(state); return; }
      armGestureRetry(v, state);
    }
    var p;
    try { p = v.play(); } catch (e) { refused(e); return; }
    if (p && p.catch) p.catch(refused);
  }

  function armGestureRetry(v, state) {
    if (state.gestureRetry) return;
    state.why += " (waiting for first touch)";
    var fire = function () {
      dropGestureRetry(state);
      if (state.done || state.video !== v) return;
      tryPlay(v, state, true);
    };
    state.gestureRetry = fire;
    document.addEventListener("touchstart", fire, { passive: true, once: true });
    document.addEventListener("click", fire, true);
  }

  function dropGestureRetry(state) {
    var fire = state.gestureRetry;
    if (!fire) return;
    state.gestureRetry = null;
    document.removeEventListener("touchstart", fire, { passive: true, once: true });
    document.removeEventListener("click", fire, true);
  }

  // Pause, drop the src and load() so the browser aborts whatever is still in
  // flight -- removing the element alone would let the download finish.
  function teardownVideo(state) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    dropGestureRetry(state);
    var v = state.video;
    if (!v) return;
    state.video = null;
    // Bring the still back before the clip goes, so the poster is never blank.
    var overlay = v.parentNode;
    var art = overlay && overlay.querySelector(".ipo-art");
    if (art) art.classList.remove("ipo-art-faded");
    try { v.pause(); } catch (e) {}
    v.removeAttribute("src");
    try { v.load(); } catch (e) {}
    if (v.parentNode) v.parentNode.removeChild(v);
  }

  function whenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  // NOT the same thing as whenReady. Every deferred script runs after
  // readyState has already flipped to "interactive" but before the
  // DOMContentLoaded event, and this file is deferred and sits near the top of
  // the page while hoverpreview.js sits near the bottom -- so "not loading any
  // more" is far too early to read window.PZ_PREVIEW_SLUGS. Only the event
  // itself is late enough. load() is the belt and braces for the case where
  // this file is ever pulled in dynamically, after DOMContentLoaded has fired.
  function afterDeferredScripts(fn) {
    var ran = false;
    function go() { if (ran) return; ran = true; fn(); }
    if (document.readyState === "complete") { go(); return; }
    document.addEventListener("DOMContentLoaded", go);
    window.addEventListener("load", go);
  }

  function init() {
    var wrapper = document.getElementById("fullscreen-wrapper");
    var frame = document.getElementById("embed-frame");
    if (!wrapper || !frame) return;

    var embedSrc = frame.getAttribute("data-embed-src");
    if (!embedSrc) return;

    // From here on this really is a phone on a game page, so the sticky
    // mini-bar below is going to own the bottom-right corner. Tell
    // /jsload/backtotop.js to stand down; it is deferred and further down the
    // page, so it reads this flag after we set it. Every other page, and this
    // page on any non-phone, never sets it and keeps its back-to-top button.
    window.PZ_NO_BACK_TO_TOP = true;

    // The toolbar button is behind the play poster and returns once the game is
    // running. Its click has to reach our pseudo-fullscreen, not the page's own
    // one, which would never tell the embed to show its bar, so the node is
    // cloned to shed the handler the page bound during parsing.
    var fsBtn = document.getElementById("fullscreen-btn");
    if (fsBtn && fsBtn.parentNode) {
      var freshBtn = fsBtn.cloneNode(true);
      fsBtn.parentNode.replaceChild(freshBtn, fsBtn);
      fsBtn = freshBtn;
      fsBtn.style.display = "none";
      fsBtn.addEventListener("click", function (e) {
        e.preventDefault();
        enter();
      });
    }

    var titleMeta = document.querySelector('meta[property="og:title"]');
    var title = (titleMeta && titleMeta.getAttribute("content")) || "this game";

    injectStyles();
    var overlay = buildOverlay(title);
    // The whole player box, game bar included, so the name and creator are on
    // the poster only. Falls back to the frame's own wrapper if a page ever
    // ships without the outer box.
    var mount = document.querySelector(".game-container-inner") || wrapper;
    mount.appendChild(overlay);

    var videoState = { done: false, video: null, timer: null, why: "not started", gestureRetry: null };

    /*
     * Opt-in on-screen readout: add ?pzdebug=1 to any game page URL.
     *
     * Inert -- no DOM, no listener, no cost -- unless the parameter is there.
     * It exists because the cover clip can only be diagnosed on a real phone,
     * where there is no console to read, and several of the reasons it will
     * legitimately not play are invisible device settings (Reduce Motion,
     * Low Power Mode, Save-Data) that look exactly like a bug from outside.
     * One tap on a ?pzdebug=1 link answers in one line what three rounds of
     * guessing could not.
     */
    if (/[?&]pzdebug=1\b/.test(location.search)) {
      var dbg = document.createElement("div");
      dbg.setAttribute("style",
        "position:fixed;left:0;right:0;bottom:0;z-index:2147483000;" +
        "background:rgba(0,0,0,.88);color:#0f0;font:11px/1.45 monospace;" +
        "padding:8px 10px;white-space:pre-wrap;word-break:break-word");
      document.body.appendChild(dbg);
      setInterval(function () {
        var v = videoState.video;
        var c = navigator.connection || {};
        dbg.textContent = [
          "why      : " + videoState.why,
          "clip     : " + (window.PZ_PREVIEW_SLUGS ? "list ok" : "LIST MISSING") +
            " / slug " + currentSlug(),
          "reduceMot: " + mq("(prefers-reduced-motion: reduce)") +
            "   saveData: " + (c.saveData === true) + " " + (c.effectiveType || ""),
          "video    : " + (v ? ("readyState " + v.readyState + " paused " + v.paused +
            " err " + (v.error ? v.error.code : "-")) : "none"),
          "poster   : hidden " + overlay.hidden + "   UA " +
            (/iPhone|iPod/.test(navigator.userAgent) ? "iOS" : "other")
        ].join("\n");
      }, 400);
    }
    // hoverpreview.js publishes window.PZ_PREVIEW_SLUGS and is deferred too,
    // further down the page, so the list only exists once every deferred script
    // has run -- see afterDeferredScripts.
    afterDeferredScripts(function () { attachCoverVideo(overlay, videoState); });

    var miniBar = buildMiniBar(title);
    document.body.appendChild(miniBar);

    // `scrolledPast` is what the observer saw; `showMiniBar` ANDs it with
    // "not currently playing", so the bar can never sit on top of the game.
    var scrolledPast = false;

    function showMiniBar() {
      var want = scrolledPast && !wrapper.classList.contains("pseudo-fullscreen");
      miniBar.classList.toggle("pzm-shown", want);
      miniBar.setAttribute("aria-hidden", want ? "false" : "true");
    }

    /*
     * Trigger: the poster's own bounding rect, never a fixed pixel threshold.
     * How far down the player sits depends on the nav and on anything above
     * it, so the back-to-top button's flat `scrollY > 600` would fire in the
     * wrong place. The test is the poster's midpoint, which is exactly where
     * .ipo-play sits -- "once you scroll past the play button", the owner's
     * own wording -- so the bar arrives while the tiles are still coming up
     * rather than waiting for the whole player to clear the screen.
     *
     * A plain passive scroll listener rather than IntersectionObserver.
     * IO is the tidier tool and would do less work, but it cannot be
     * exercised in the headless renderer this file is verified with: it
     * delivers its first callback and then never fires again under virtual
     * time, and there is no way to trigger it by hand. A scroll listener can
     * be driven with a synthetic `scroll` event, so the real logic below is
     * actually testable. (Neither native scroll events nor IO fire in that
     * renderer; rAF does, so coalescing would have been safe -- it is just not
     * worth the extra state for one getBoundingClientRect on one element,
     * which is no more than the back-to-top button this replaces already did.)
     */
    function measurePoster() {
      var r = mount.getBoundingClientRect();
      scrolledPast = r.top + r.height / 2 <= 0;
      showMiniBar();
    }

    window.addEventListener("scroll", measurePoster, { passive: true });
    window.addEventListener("resize", measurePoster, { passive: true });
    window.addEventListener("orientationchange", measurePoster);
    measurePoster();

    // Tapping the bar plays immediately rather than scrolling up and asking
    // for a second tap: enter() opens pseudo-fullscreen, which fills the
    // screen anyway, so a scroll-then-tap would just be a wasted step. It also
    // records the current scroll position, so leaving fullscreen drops the
    // visitor back exactly where they were reading.
    miniBar.addEventListener("click", function (e) {
      e.preventDefault();
      enter();
    });

    var loaded = false;
    var savedScrollY = 0;
    var resizeTimer = null;

    // The page's own rule sizes this with 100dvh/100vh, which iOS resolves
    // against the chrome-hidden viewport, so in landscape the game runs past
    // the visible bottom edge and letterboxes short of it. window.innerHeight
    // is the visible height, and the body is fixed while we are open so Safari
    // keeps its bars put. setProperty(..., "important") is required to outrank
    // the stylesheet's own !important.
    function applyViewportSize() {
      if (!wrapper.classList.contains("pseudo-fullscreen")) return;
      wrapper.style.setProperty("width", window.innerWidth + "px", "important");
      wrapper.style.setProperty("height", window.innerHeight + "px", "important");
    }

    function clearViewportSize() {
      wrapper.style.removeProperty("width");
      wrapper.style.removeProperty("height");
    }

    function remeasure() {
      applyViewportSize();
      // iOS still reports the pre-rotation size for a beat after the event.
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyViewportSize, 300);
    }

    window.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", remeasure);
    }

    // A cover clip must not keep downloading or decoding in a backgrounded tab.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) teardownVideo(videoState);
    });
    window.addEventListener("pagehide", function () { teardownVideo(videoState); });

    function tellFrame(message) {
      try {
        frame.contentWindow.postMessage(message, location.origin);
      } catch (_) {}
    }

    function enter() {
      savedScrollY = window.scrollY || 0;
      if (!loaded) {
        loaded = true;
        var url = embedSrc + (embedSrc.indexOf("?") === -1 ? "?" : "&") + "fs=1";
        // replace() rather than src= so playing a game does not bury the page
        // under an extra history entry for the reader's back button.
        try {
          frame.contentWindow.location.replace(url);
        } catch (_) {
          frame.src = url;
        }
      } else {
        tellFrame({ type: "pe-force-fullscreen", value: true });
      }
      if (!overlay.hidden) {
        // Before hiding: the clip's request has to be aborted, not orphaned, so
        // it never competes with the game for the phone's bandwidth.
        videoState.done = true;
        teardownVideo(videoState);
        // Hidden, not removed -- exit() puts this exact poster back.
        overlay.hidden = true;
      }
      // The toolbar's fullscreen button deliberately stays hidden for the whole
      // life of the page on phones. There is no state here where the game is
      // sitting inline waiting to be re-opened: it is either running
      // pseudo-fullscreen or torn down behind the poster, and the poster is the
      // way back in. See resetToGate.
      wrapper.classList.add("pseudo-fullscreen");
      document.body.classList.add("pseudo-fullscreen-active");
      // After the class is on, so showMiniBar sees "playing" and slides the
      // bar away rather than leaving it over the game.
      showMiniBar();
      window.scrollTo(0, 0);
      applyViewportSize();
    }

    /*
     * Put the page back exactly as it loaded: no game running, the poster
     * showing again, no fullscreen button.
     *
     * Owner request 2026-09-07 -- before this, leaving fullscreen dropped the
     * visitor onto the live embed squeezed into the small inline box with a
     * fullscreen button beside it, which is neither what Poki does nor useful
     * on a phone. Tearing the frame down also stops a game the visitor has
     * finished with from holding audio, CPU and battery in the background.
     *
     * Phones only, by construction: this whole file is behind the phone UA
     * gate, so Chromebooks, tablets and desktop keep their native fullscreen
     * exit and keep showing the inline embed afterwards, unchanged.
     */
    function resetToGate() {
      loaded = false;
      // Same-origin (/embed/<slug>), so this really does discard the game.
      // replace() rather than src= so unloading does not add a history entry.
      try {
        frame.contentWindow.location.replace("about:blank");
      } catch (_) {
        frame.src = "about:blank";
      }
      if (fsBtn) fsBtn.style.display = "none";
      overlay.hidden = false;
      // Re-arm the cover clip; attachCoverVideo re-applies every guard
      // (reduced motion, Save-Data, hidden tab) from scratch.
      videoState.done = false;
      attachCoverVideo(overlay, videoState);
    }

    function exit() {
      tellFrame({ type: "pe-force-fullscreen", value: false });
      wrapper.classList.remove("pseudo-fullscreen");
      document.body.classList.remove("pseudo-fullscreen-active");
      clearViewportSize();
      window.scrollTo(0, savedScrollY);
      resetToGate();
      // Back at savedScrollY, so if they tapped the mini-bar from far down the
      // page the bar comes straight back with them.
      showMiniBar();
    }

    overlay.addEventListener("click", function (e) {
      e.preventDefault();
      enter();
    });

    // The embed's bottom bar owns the exit control while we are pseudo-fullscreen.
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      if (e.source !== frame.contentWindow) return;
      if (!e.data || e.data.type !== "pe-exit-fullscreen") return;
      exit();
    });
  }

  whenReady(init);
})();
