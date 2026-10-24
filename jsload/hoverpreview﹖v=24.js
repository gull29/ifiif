/*!
 * hoverpreview.js - Poki-style hover preview clips on game tiles.
 *
 * Shipped 2026-09-07. NOT an A/B test: every visitor on the covered surfaces
 * gets it. Covered surfaces are decided by which pages load this file, so the
 * homepage (/index.html) is deliberately left out -- do not add the script tag
 * there without asking. See CLAUDE.md > Shipped features.
 *
 * Behaviour, deliberately matching what poki.com itself does:
 *   - no <video> exists until a tile is actually hovered (nothing preloads);
 *   - ~200ms of sustained hover before playback starts, so dragging the mouse
 *     across a grid does not fire off a burst of requests;
 *   - exactly one <video> element exists for the whole page, so at most one
 *     clip is ever decoding;
 *   - mouseleave pauses, clears the src and aborts the in-flight request.
 *
 * Kill switch: set window.PZ_NO_HOVER_PREVIEW = true before this file loads,
 * or just drop the <script> tag from a page/template.
 *
 * Videos live at /videos/preview/<slug>.mp4 where <slug> is the live /g/<slug>
 * segment (case-sensitive). To cover more games: drop the mp4 in that folder
 * and add the slug to SLUGS below. Games missing from SLUGS simply keep their
 * static thumbnail. Bump the ?v= on the script tags after editing this file --
 * it is Cloudflare-cached for weeks.
 *
 * SLUGS is now shared, not private: it is turned into a lookup and published as
 * window.PZ_PREVIEW_SLUGS at the very top of the IIFE, ahead of every early
 * return, so it is available even on the devices this file does nothing on.
 * /jsload/iphone-play.js reads it to decide whether a phone's play gate shows a
 * looping cover video or just the static thumbnail. That file loads BEFORE this
 * one, so it waits for DOMContentLoaded before looking. Add clips here only --
 * never copy the list into a second file.
 *
 * Two upstream sources, self-hosted once downloaded (the player does not care
 * which one a file came from -- one SLUGS list covers both):
 *   - Poki      .3x3 clips, already 314x314 SQUARE;
 *   - CrazyGames  landscape clips, 494x276 / 364x208 -- 16:9, NOT square.
 * The tiles this runs on are square (#search-results .game img is
 * aspect-ratio:1/1; .game-grid cells are 94px squares), so the 16:9 files must
 * be CROPPED, never stretched. That is what object-fit:cover + object-position:
 * center below does: it scales the clip until it covers the square and throws
 * the overflowing left/right edges away, preserving the aspect ratio. Do NOT
 * change it to object-fit:fill / 100% width+height on the intrinsic box -- that
 * squishes the widescreen sources. No per-source CSS is needed or wanted.
 */
(function () {
  "use strict";

  // Live /g/<slug> values that have a clip in /videos/preview/. Case-sensitive.
  //
  // Published as window.PZ_PREVIEW_SLUGS *before* any of the early returns
  // below, because this list is the single source of truth for "does this game
  // have a preview clip?" and a second consumer needs it on exactly the devices
  // this file bails out on: /jsload/iphone-play.js uses it to decide whether a
  // phone's play gate shows a looping cover video or the static thumbnail.
  // Keep it here -- do not copy the list into that file.
  var SLUGS = (
    '2048,adventuredrivers,adventureminer,airplanemanager,americanfootballreal,appleworm,archeryworldto' +
    'ur,asmallworldcup,asmallworldcup2,backroomsrecovery,baconmaydie,baconsurvivor,basketballreal,baske' +
    'tballstars,basketballsuperstars,basketrandom,bigtowertinysquare2,blockblast,blumgiball,blumgibloom' +
    ',blumgibounce,blumgidragon,blumgimerge,blumgipaintball,blumgiracers,BlumgiSlime,blumgisoccer,blumg' +
    'isplash,bouncemasters,boxingrandom,boxrob,braintest,buckbounce,bulletbros,capitalistbusdriver,carc' +
    'ircle,carmachines,carnadostuntcar,circloo,colorpencilrun,crazybikes,crazycars,crossyroad,cuttherop' +
    'e,dayofmeatradiation,deadlydecent,diggingmaster,dinobros,dreadheadparkour,driftboss,drivemad,duckl' +
    'ingsio,duckmerge,eagleride,eggycar,escaperoad3,fearresponse,flipbros,freeriderjumps,fridaynightfunkin,' +
    'fruitninja,fruitsoffury,funnyshooter2,gasstation,geometrydash,getawayshootout,gladihoppers,gobble,' +
    'golforbit,goodsmaster,googlefeud,granny,grindcraft,gunspin,happyglass,harvestloop,harvestsimulator' +
    ',henrybreakingthebank,henryescapingtheprison,henryfleeingthecomplex,henryinfiltratingtheairship,he' +
    'nrystealingthediamond,hexellent,hillclimbracing,holeio,hordekilleryouvs100,idleants,idlebreakout,i' +
    'dledices,idlediggingtycoon,idlelumberinc,idleminingempire,idlesuccess,impossiblequiz,ironsnout,jet' +
    'packjoyride,johnnytrigger,johnnytriggersniper,jumpingshell,jumponly,kickthebuddy,kiwiclicker,level' +
    'devil,littlealc,longcat,madskillsmotocross2,magicbattleground,marblerun3d,masterchess,mergeroundra' +
    'cers,mineline,monkeymart,monstermatch,monstertracks,mopheaddash,mototrap,motox3m,motox3mpool,motox' +
    '3mspooky,motox3mwinter,mrbullet,mrracer,murder,myperfecthotel,nopainnogain,OvO,ovodimensions,papas' +
    'freezeria,paperio2,pathtoglory,penaltyshooters2,perfectlandingplanepilot,perfectpeel,perfectshape,' +
    'pingponggo,plonky,policechase,polytrack,pooreddie,punchyguy,racesurvival,raftwars,ragdollarchers,r' +
    'agdollchaos,ragdollfall,ragdollfight,redball4,retrobowl,retrobowlcollege,retrohighway,rocketsoccerderby,rodeost' +
    'ampede,roller,rooftopsnipers,roper,run3,sandtris,sausageflip,skyriders,slicemaster,slimedunk,slime' +
    'journey,slope,smashit,snakepivot,snowrider3d,snowtrainodyssey,soccerrandom,soccerreal,spacewaves,speedst' +
    'ars,stacktris,stealabrainrot,steelhills,stickdefenders,stickfighter,stickmanbattle,stickmanbike,st' +
    'ickmanclimb2,stickmanclimb3d,stickmanhook,stickmanmerge,stickmanrun,stickmerge,stickrush,stuntbike' +
    'extreme,stuntcarextreme,subwaysurfers,supercarlegends,superfowlst,superhot,superliquidsoccer,super' +
    'starcar,swingo,tabletennisworldtour,tag,TanukiSunset,templeofboom,templerun2,thefinalearth2,therei' +
    'snog,timeshooter3,tinyfishing,tinytowers,tubejumpers,tunnelrush2,unicyclehero,unicyclelegend,volle' +
    'yrandom,waverider,worldofscrew'
  ).split(",");

  var HAS = Object.create(null);
  for (var i = 0; i < SLUGS.length; i++) HAS[SLUGS[i]] = true;
  window.PZ_PREVIEW_SLUGS = HAS;

  if (window.PZ_NO_HOVER_PREVIEW) return;
  if (!document.addEventListener || !document.documentElement.classList) return;
  if (!("play" in document.createElement("video"))) return;

  function mq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); }
    catch (e) { return false; }
  }

  // Visitors who asked for less motion keep the static thumbnail.
  if (mq("(prefers-reduced-motion: reduce)")) return;
  // Touch-only devices never get a hover, and a tap must not start a video.
  if (!mq("(hover: hover) and (pointer: fine)")) return;

  // Data Saver / 2G: a ~0.5MB clip is not worth it. Static thumbnail instead.
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ""))) return;

  // Only these two grids. The nav search dropdown and the homepage tile grids
  // are intentionally not listed.
  //   #search-results .game a  -> /g, the 10 category pages, and /search
  //   .game-grid a             -> the "more games" tiles on every game page
  var TILES = '#search-results .game a[href^="/g/"], .game-grid a[href^="/g/"]';

  var HOVER_INTENT_MS = 200;
  var SRC_BASE = "/videos/preview/";
  // Video files have no query-string cache-buster of their own, unlike this
  // script. Cloudflare/browsers cache them for ~62 days at the same URL, so
  // swapping a clip's *content* at the same filename (fixing a wrong match,
  // as happened with waverider and ragdollfall 2026-09-08) does not reach
  // visitors who already cached the old bytes. Bump this whenever ANY clip
  // file's content changes -- it busts every clip at once, cheap and simple.
  var VIDEO_VERSION = "3";

  var video = null;      // the single reusable element
  var playing = null;    // tile that currently owns `video`
  var pending = null;    // tile waiting out the hover-intent delay
  var timer = null;
  var broken = Object.create(null);

  // Styles ship with the script so the feature is one self-contained file.
  // z-index 0 keeps the clip above the (statically positioned) thumbnail but
  // below both tile labels: `.overlay` on /g and /search (z-index 2) and
  // `.game-grid a.focusable::after` on game pages (z-index 1).
  // No brightness tint. There used to be a brightness(.7) here, matching what
  // the thumbnails got on hover; both were removed 2026-09-07 at the owner's
  // request ("remove the grey filter on all image hover"). Removing it here is
  // not optional cosmetics -- on the 187 games that have a clip, the clip IS
  // what the visitor sees while hovering, so leaving it would have meant the
  // grey never actually went away for those tiles. The white game name stays
  // readable because both tile labels now carry their own gradient scrim.
  // object-fit:cover is load-bearing, not cosmetic: it is the only thing that
  // crops the 16:9 CrazyGames clips to the square tile instead of squishing
  // them. It is the same rule `#search-results .game img` already uses for the
  // thumbnails, so clip and thumbnail frame the game identically.
  var style = document.createElement("style");
  style.textContent =
    ".pz-preview-video{position:absolute;top:0;left:0;width:100%;height:100%;" +
    "object-fit:cover;object-position:center;border-radius:inherit;display:block;" +
    "z-index:0;pointer-events:none;background:transparent;" +
    "opacity:0;transition:opacity .18s ease}" +
    ".pz-preview-video.pz-preview-shown{opacity:1}";
  (document.head || document.documentElement).appendChild(style);

  function slugOf(a) {
    var href = a.getAttribute("href") || "";
    var m = /^\/g\/([^\/?#]+)/.exec(href);
    return m ? m[1] : null;
  }

  function tileOf(node) {
    if (!node || node.nodeType !== 1 || !node.closest) return null;
    return node.closest(TILES);
  }

  function cancelPending() {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
  }

  // Tear the current clip down completely: pause, detach, drop the src and
  // call load() so the browser aborts whatever is still downloading.
  // Deliberately does NOT touch `pending`: browsers disagree on whether
  // mouseout(old tile) or mouseover(new tile) fires first, and clearing the
  // timer here would cancel a hover that had already legitimately started.
  function stop() {
    if (!playing) return;
    playing = null;
    if (!video) return;
    video.classList.remove("pz-preview-shown");
    try { video.pause(); } catch (e) {}
    video.removeAttribute("src");
    try { video.load(); } catch (e) {}
    if (video.parentNode) video.parentNode.removeChild(video);
  }

  function makeVideo() {
    var v = document.createElement("video");
    v.className = "pz-preview-video";
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.autoplay = false;
    v.controls = false;
    v.preload = "none";
    v.playsInline = true;
    v.tabIndex = -1;
    v.disablePictureInPicture = true;
    v.setAttribute("muted", "");
    v.setAttribute("loop", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("preload", "none");
    v.setAttribute("disableremoteplayback", "");
    // Decorative: the tile's link, title and label already name the game.
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("playing", function () {
      if (playing) v.classList.add("pz-preview-shown");
    });
    v.addEventListener("error", function () {
      // A missing or bad file must never break the tile - fall back to the
      // thumbnail and never ask for this one again.
      if (playing) broken[slugOf(playing) || ""] = true;
      stop();
    });
    return v;
  }

  function start(tile) {
    if (!tile) return;
    var attached = ("isConnected" in tile) ? tile.isConnected : document.contains(tile);
    if (!attached) return;
    var slug = slugOf(tile);
    if (!slug || !HAS[slug] || broken[slug]) return;
    stop();
    if (!video) video = makeVideo();
    playing = tile;
    video.src = SRC_BASE + encodeURIComponent(slug) + ".mp4?v=" + VIDEO_VERSION;
    tile.appendChild(video);
    var p;
    try { p = video.play(); } catch (e) { return; }
    // Rejects when the hover ended before playback began - nothing to do.
    if (p && p.catch) p.catch(function () {});
  }

  // Delegated so that JS-rendered grids (/g, /search, category filters) are
  // covered without any hook into their renderers.
  document.addEventListener("mouseover", function (e) {
    var tile = tileOf(e.target);
    if (!tile) return;
    if (tile === playing || tile === pending) return;
    var slug = slugOf(tile);
    cancelPending();
    stop();
    if (!slug || !HAS[slug] || broken[slug]) return;
    pending = tile;
    timer = setTimeout(function () {
      timer = null;
      var t = pending;
      pending = null;
      start(t);
    }, HOVER_INTENT_MS);
  }, false);

  document.addEventListener("mouseout", function (e) {
    var tile = tileOf(e.target);
    if (!tile) return;
    // Moving between children of the same tile is not a leave.
    var to = e.relatedTarget;
    if (to && to.nodeType === 1 && tile.contains(to)) return;
    if (tile === pending) cancelPending();
    if (tile === playing) stop();
  }, false);

  function stopAll() { cancelPending(); stop(); }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopAll();
  });
  window.addEventListener("pagehide", stopAll);
})();
