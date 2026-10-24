/* AppLixir parent-side rewarded-ad bridge  --  loaded by every /embed/<slug>/ page.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * AppLixir matches every ad request against the exact domains registered (and
 * manually approved) in their dashboard. Only "pizzaedition.com" is approved --
 * "games.pizzaedition.com", where the actual game builds live, is NOT, and
 * getting a second domain approved is a 1-2 business day manual review.
 *
 * The AppLixir SDK derives the domain it reports from its OWN frame's
 * window.location (verified by reading applixir.app.v6.1.0.js: it does
 * `href.substring(0, href.indexOf('/', 8))`). So it has to run in a frame whose
 * location is on pizzaedition.com -- i.e. here, in the /embed/<slug>/ wrapper --
 * and NOT inside the game iframe.
 *
 * So: the game (games.pizzaedition.com/scripts/sdk.js, showApplixirRewardedAd())
 * postMessages a request up to this page, this page plays the ad and posts the
 * outcome back down. Same cross-frame shape the PokiSDK stub already uses for
 * pokiMessageShowLeaderboard / pokiMessageOpenExternalLink.
 *
 *   game frame  --{pokiMessageShowRewardedAd, requestId}-->  this page
 *   this page   --{pokiMessageRewardedAdAck, requestId}-->   game frame   (immediately)
 *   this page   --{pokiMessageRewardedAdResult, requestId, success}--> game frame
 *
 * The ack is sent synchronously on receipt, before the SDK is even fetched,
 * because the game side uses a short ack timeout (2.5s) purely to detect "this
 * parent page is an old cached copy with no listener" and fail fast into its
 * GPT/house-video fallback chain. Once acked, the game side waits 90s, so this
 * side must always answer well inside that -- see AD_TIMEOUT_MS.
 *
 * SECURITY: a forged postMessage here is a free reward with no ad shown, so a
 * request is only honoured when BOTH the origin is exactly the games subdomain
 * AND event.source is this page's own game iframe (#gameframe). Replies are
 * posted back to that source with an explicit target origin, never '*'.
 *
 * REWARD RULE: only status.type === "complete" earns the reward. Confirmed
 * against the v6.1.0 bundle: that status is IMA's AdEvent.Type.COMPLETE passed
 * straight through. Every other status -- loaded/start/quartiles/click/pause/
 * skip/allAdsCompleted/thankYouModalClosed/adSkippedNoReward/manuallyEnded/
 * consentDeclined/consentUnavailable -- does not.
 *
 * CACHING: pizzaedition.com serves *.js with a public 7-day max-age, so this
 * file's ?v= MUST be bumped on every edit, on all /embed/<slug>/ pages at once
 * (they are all identical -- see tools/sweep-applixir-bridge.js). The embed HTML
 * itself is uncached (cf-cache-status: DYNAMIC), so the bump lands immediately.
 */
(function () {
    'use strict';

    if (window.__pzApplixirBridge) return;
    window.__pzApplixirBridge = true;

    var GAME_ORIGIN = 'https://games.pizzaedition.com';
    var SDK_URL = 'https://cdn.applixir.com/applixir.app.v6.1.0.js';
    var API_KEY = 'ab214212-f753-493a-a802-50d571cdce75';
    var CONTAINER_ID = 'applixir-ad-container';
    var STYLE_ID = 'pz-applixir-css';
    var FRAME_ID = 'gameframe';

    var MSG_REQUEST = 'pokiMessageShowRewardedAd';
    var MSG_ACK = 'pokiMessageRewardedAdAck';
    var MSG_RESULT = 'pokiMessageRewardedAdResult';

    // Fetching the SDK is the step a school content filter / ad blocker kills,
    // so it gets a short leash -- failing fast here means the visitor gets the
    // GPT or house-video ad instead of staring at a black box.
    var SDK_TIMEOUT_MS = 8000;
    // Hard ceiling on one ad. Must stay comfortably under the game side's
    // resultTimeoutMs (90000) or both sides time out and the game can end up
    // running its own fallback underneath a still-open ad.
    var AD_TIMEOUT_MS = 70000;
    // After "complete" the SDK shows its own short post-roll / thank-you card
    // inside our injected container. Owner-reported (2026-09-14): that card
    // reads as "a placeholder plays after the real ad" -- unwanted. Tear the
    // container down almost immediately instead of waiting it out; the reward
    // is already granted the instant "complete" fires, so there's nothing to
    // lose by cutting it short. Not 0ms: still one tick so a same-frame
    // "complete" -> "allAdsCompleted" pair (TERMINAL_AFTER_COMPLETE) is read as
    // one grant, not a teardown racing a status event.
    var POST_COMPLETE_GRACE_MS = 50;

    // Terminal statuses that mean "no reward" when they arrive without a prior
    // "complete".
    var TERMINAL_FAILURE = {
        skip: 1, skipped: 1, userClose: 1, manuallyEnded: 1,
        consentDeclined: 1, consentUnavailable: 1,
        adSkippedNoReward: 1, allAdsCompleted: 1, thankYouModalClosed: 1
    };
    // Terminal statuses that, after a "complete", just mean the SDK has finished
    // its end card -- reward already earned, close up now.
    var TERMINAL_AFTER_COMPLETE = {
        allAdsCompleted: 1, thankYouModalClosed: 1, adSkippedNoReward: 1,
        manuallyEnded: 1, userClose: 1
    };

    var active = null;
    var sdkPromise = null;

    // --- DOM -----------------------------------------------------------------

    // AppLixir's own stylesheet hard-codes #videoplayer at 1048x590 and its
    // confirm modal at 640x360, with no media queries at all. The embed frame is
    // the size of the game player -- ~374px square on a phone -- so without these
    // overrides the visitor sees the middle third of the ad and nothing else.
    // The SDK re-measures the player box (resizePlayerAndAds -> clientWidth /
    // clientHeight) and resizes IMA to match, so making it fluid is supported.
    // Nothing here touches .applixir-hide-element, which is how the SDK shows and
    // hides its own pieces.
    function injectCss() {
        if (document.getElementById(STYLE_ID)) return;
        var css =
            '#' + CONTAINER_ID + '{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;' +
            'z-index:2147483000;background:#000;display:block;}' +
            '#' + CONTAINER_ID + ' .pz-ax-wait{position:absolute;top:0;left:0;width:100%;height:100%;' +
            'display:flex;align-items:center;justify-content:center;gap:6px;}' +
            '#' + CONTAINER_ID + ' .pz-ax-wait i{width:10px;height:10px;border-radius:2px;background:#fff;' +
            'display:block;animation:pz-ax-dot 1.2s infinite ease-in-out;}' +
            '#' + CONTAINER_ID + ' .pz-ax-wait i:nth-child(2){animation-delay:.15s;}' +
            '#' + CONTAINER_ID + ' .pz-ax-wait i:nth-child(3){animation-delay:.3s;}' +
            '@keyframes pz-ax-dot{0%,100%{opacity:.3;transform:translateY(0);}50%{opacity:1;transform:translateY(-4px);}}' +
            '#' + CONTAINER_ID + ' .applixir-backdrop{background-color:#000 !important;}' +
            '#' + CONTAINER_ID + ' #videoplayer{width:100% !important;height:100% !important;' +
            'max-width:100% !important;max-height:100% !important;border:0 !important;' +
            'border-radius:0 !important;box-shadow:none !important;}' +
            '#' + CONTAINER_ID + ' #applixir-confirm-modal{max-width:calc(100% - 24px) !important;' +
            'max-height:calc(100% - 24px) !important;}';
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // Always a FRESH div: the SDK does `injectionDiv.innerHTML += <template>`, so
    // reusing one across two ads would duplicate its markup (and its ids).
    function makeContainer() {
        removeContainer();
        var el = document.createElement('div');
        el.id = CONTAINER_ID;
        el.innerHTML = '<div class="pz-ax-wait"><i></i><i></i><i></i></div>';
        (document.body || document.documentElement).appendChild(el);
        return el;
    }

    function removeContainer() {
        var el = document.getElementById(CONTAINER_ID);
        if (el) {
            // A detached media element is paused by the UA, but be explicit --
            // an ad that keeps its audio alive over the game is the worst bug
            // this file could ship.
            try {
                var vids = el.getElementsByTagName('video');
                for (var i = vids.length - 1; i >= 0; i--) {
                    try { vids[i].pause(); vids[i].removeAttribute('src'); vids[i].load(); } catch (e) {}
                }
            } catch (e) {}
            if (el.parentNode) el.parentNode.removeChild(el);
        }
        // The SDK's "no ad" toast is appended outside the injection div.
        try {
            var toasts = document.querySelectorAll('.applixir-toast');
            for (var j = 0; j < toasts.length; j++) {
                if (toasts[j].parentNode) toasts[j].parentNode.removeChild(toasts[j]);
            }
        } catch (e) {}
    }

    // --- messaging -----------------------------------------------------------

    function post(req, msg) {
        try { req.source.postMessage(msg, req.origin); } catch (e) {}
    }

    function finish(req, success, reason) {
        if (req.settled) return;
        req.settled = true;
        if (req.adTimer) clearTimeout(req.adTimer);
        if (req.graceTimer) clearTimeout(req.graceTimer);
        if (active === req) active = null;
        removeContainer();
        post(req, {
            type: MSG_RESULT,
            requestId: req.requestId,
            success: success === true,
            reason: String(reason || (success ? 'complete' : 'failed')).slice(0, 40)
        });
    }

    function onStatus(req, status) {
        if (req.settled) return;
        var type = (status && typeof status.type === 'string') ? status.type : '';
        if (!type) return;

        if (type === 'complete') {
            req.rewarded = true;
            if (req.graceTimer) clearTimeout(req.graceTimer);
            req.graceTimer = setTimeout(function () { finish(req, true, 'complete'); }, POST_COMPLETE_GRACE_MS);
            return;
        }
        if (req.rewarded) {
            if (TERMINAL_AFTER_COMPLETE[type]) finish(req, true, 'complete');
            return;
        }
        if (TERMINAL_FAILURE[type]) finish(req, false, type);
    }

    function onError(req, error) {
        if (req.settled) return;
        // An error raised during the post-roll must not take away a reward the
        // visitor already earned.
        if (req.rewarded) { finish(req, true, 'complete'); return; }
        var code = 'error';
        try {
            var data = error && typeof error.getError === 'function' ? error.getError().data : null;
            if (data) code = String(data.type || data.errorCode || 'error');
        } catch (e) {}
        finish(req, false, code);
    }

    // --- IAB GPP stub ----------------------------------------------------------
    // AppLixir's bundle constructs an IAB GPP (Global Privacy Platform) reader on
    // init and expects window.__gpp to already exist as a callable function --
    // this site has no CMP, so it was undefined and their library threw
    // "window.__gpp is not a function" (owner-reported, real console error).
    // This is the IAB's own reference "stub" (Global-Privacy-Platform repo, CMP
    // API Specification, "Example stub code"), copied verbatim and only
    // ES5-ified -- do not hand-roll a replacement, the queuing/postMessage
    // semantics are exactly specified and other vendors' scripts may rely on
    // them the same way. Installed once, before the AppLixir SDK script loads,
    // same idea as the GPT loader elsewhere in the sdk.js pair.
    function installGppStub() {
        if (('__gpp' in window) && typeof window.__gpp === 'function') return;
        window.__gpp_addFrame = function (n) {
            if (!window.frames[n]) {
                if (document.body) {
                    var i = document.createElement('iframe');
                    i.style.cssText = 'display:none';
                    i.name = n;
                    document.body.appendChild(i);
                } else {
                    window.setTimeout(function () { window.__gpp_addFrame(n); }, 10);
                }
            }
        };
        window.__gpp_stub = function () {
            var b = arguments;
            window.__gpp.queue = window.__gpp.queue || [];
            if (!b.length) { return window.__gpp.queue; }
            var cmd = b[0];
            var clb = b.length > 1 ? b[1] : null;
            var par = b.length > 2 ? b[2] : null;
            if (cmd === 'ping') {
                return {
                    gppVersion: '1.1', cmpStatus: 'stub', cmpDisplayStatus: 'hidden',
                    supportedAPIs: ['2:tcfeuv2', '5:tcfcav1', '6:uspv1'], cmpId: 31,
                    sectionList: [], applicableSections: [-1], gppString: ''
                };
            } else if (cmd === 'addEventListener') {
                window.__gpp.events = window.__gpp.events || [];
                if (!('lastId' in window.__gpp)) { window.__gpp.lastId = 0; }
                window.__gpp.lastId++;
                var lnr = window.__gpp.lastId;
                window.__gpp.events.push({ id: lnr, callback: clb, parameter: par });
                return {
                    eventName: 'listenerRegistered', listenerId: lnr, data: true,
                    pingData: {
                        gppVersion: '1.1', cmpStatus: 'stub', cmpDisplayStatus: 'hidden',
                        supportedAPIs: ['2:tcfeuv2', '5:tcfcav1', '9:usva', '7:usnat'], cmpId: 31,
                        sectionList: [], applicableSections: [-1], gppString: ''
                    }
                };
            } else if (cmd === 'removeEventListener') {
                var success = false;
                window.__gpp.events = window.__gpp.events || [];
                for (var i = 0; i < window.__gpp.events.length; i++) {
                    if (window.__gpp.events[i].id == par) {
                        window.__gpp.events.splice(i, 1);
                        success = true;
                        break;
                    }
                }
                return {
                    eventName: 'listenerRemoved', listenerId: par, data: success,
                    pingData: {
                        gppVersion: '1.1', cmpStatus: 'stub', cmpDisplayStatus: 'hidden',
                        supportedAPIs: ['2:tcfeuv2', '5:tcfcav1', '9:usva', '7:usnat'], cmpId: 31,
                        sectionList: [], applicableSections: [-1], gppString: ''
                    }
                };
            } else if (cmd === 'hasSection' || cmd === 'getSection' || cmd === 'getField') {
                return null;
            } else {
                window.__gpp.queue.push(Array.prototype.slice.call(b));
            }
        };
        window.__gpp_msghandler = function (event) {
            var msgIsString = typeof event.data === 'string';
            var json;
            try { json = msgIsString ? JSON.parse(event.data) : event.data; } catch (e) { json = null; }
            if (typeof json === 'object' && json !== null && '__gppCall' in json) {
                var i = json.__gppCall;
                window.__gpp(i.command, function (retValue, success) {
                    var returnMsg = { __gppReturn: { returnValue: retValue, success: success, callId: i.callId } };
                    event.source.postMessage(msgIsString ? JSON.stringify(returnMsg) : returnMsg, '*');
                }, 'parameter' in i ? i.parameter : null, 'version' in i ? i.version : '1.1');
            }
        };
        window.__gpp = window.__gpp_stub;
        window.addEventListener('message', window.__gpp_msghandler, false);
        window.__gpp_addFrame('__gppLocator');
    }

    // --- SDK -----------------------------------------------------------------

    function loadSdk() {
        installGppStub();
        if (typeof window.initializeAndOpenPlayer === 'function') return Promise.resolve();
        if (sdkPromise) return sdkPromise;
        sdkPromise = new Promise(function (resolve, reject) {
            var done = false;
            var script = document.createElement('script');
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                sdkPromise = null; // a later attempt may still succeed
                reject(new Error('sdk_timeout'));
            }, SDK_TIMEOUT_MS);
            script.src = SDK_URL;
            script.async = true;
            script.onload = function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            script.onerror = function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                sdkPromise = null;
                reject(new Error('sdk_blocked'));
            };
            (document.head || document.documentElement).appendChild(script);
        });
        return sdkPromise;
    }

    function start(req) {
        injectCss();
        makeContainer();
        req.adTimer = setTimeout(function () { finish(req, false, 'timeout'); }, AD_TIMEOUT_MS);

        loadSdk().then(function () {
            if (req.settled) return;
            if (typeof window.initializeAndOpenPlayer !== 'function') {
                finish(req, false, 'sdk_unavailable');
                return;
            }
            var opened;
            try {
                opened = window.initializeAndOpenPlayer({
                    apiKey: API_KEY,
                    injectionElementId: CONTAINER_ID,
                    adStatusCallbackFn: function (status) { onStatus(req, status); },
                    adErrorCallbackFn: function (error) { onError(req, error); }
                });
            } catch (e) {
                finish(req, false, 'init_threw');
                return;
            }
            // initializeAndOpenPlayer is async and rejects on setup failure. It
            // also calls adErrorCallbackFn on the way out, so whichever lands
            // first wins -- finish() is idempotent.
            if (opened && typeof opened.catch === 'function') {
                opened.catch(function () { finish(req, false, 'init_failed'); });
            }
        }, function (err) {
            finish(req, false, (err && err.message) || 'sdk_load_failed');
        });
    }

    // --- entry point ---------------------------------------------------------

    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type !== MSG_REQUEST) return;

        // Both checks matter. The origin check alone would still trust any
        // same-origin-with-games frame (an ad iframe, a nested game frame); the
        // source check alone would trust a frame that navigated itself anywhere.
        if (event.origin !== GAME_ORIGIN) return;
        var frame = document.getElementById(FRAME_ID);
        if (!frame || !event.source || event.source !== frame.contentWindow) return;

        var requestId = data.requestId;
        if (typeof requestId !== 'string' || !requestId || requestId.length > 64) return;

        var req = {
            requestId: requestId,
            source: event.source,
            origin: event.origin,
            settled: false,
            rewarded: false,
            adTimer: null,
            graceTimer: null
        };

        // Ack first, always, and before anything that can block -- the game side
        // is racing a 2.5s timer to decide whether this page even has a listener.
        post(req, { type: MSG_ACK, requestId: requestId });

        if (active && !active.settled) {
            // One ad at a time. Answer the new request rather than dropping it,
            // so the game falls through to its next strategy instead of hanging.
            post(req, { type: MSG_RESULT, requestId: requestId, success: false, reason: 'busy' });
            return;
        }

        active = req;
        start(req);
    }, false);

    // A navigation away mid-ad must not leave the ad running.
    window.addEventListener('pagehide', function () {
        if (active && !active.settled) finish(active, false, 'pagehide');
    }, false);
})();
