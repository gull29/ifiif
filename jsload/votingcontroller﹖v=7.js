(() => {
  const DEFAULT_API_URL = "/api/vote";
  const FALLBACK_API_URL = "https://game-votes-api.thepizzaedition.workers.dev/vote";

  // Same pair as the vote endpoints: the same-origin proxy first (one less
  // cross-origin round trip, and it survives a school filter that blocks
  // *.workers.dev), the worker itself as the fallback. Both are live and both
  // 400 on a bad body, so the fallback is a real safety net, not decoration.
  const DEFAULT_FEEDBACK_URL = "/api/feedback";
  const FALLBACK_FEEDBACK_URL = "https://game-votes-api.thepizzaedition.workers.dev/feedback";

  function toNumericId(raw) {
    const s = String(raw ?? "");
    if (/^\d+$/.test(s)) return s;
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return String(h >>> 0);
  }

  function getVoterId() {
    const voterKey = "vote:voterId";
    let id = localStorage.getItem(voterKey);
    if (id) {
      const normalized = toNumericId(id);
      if (normalized !== id) localStorage.setItem(voterKey, normalized);
      return normalized;
    }
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const normalized = toNumericId(id);
    localStorage.setItem(voterKey, normalized);
    return normalized;
  }

  function isAbsoluteUrl(value) {
    return /^[a-z][a-z\d+\-.]*:\/\//i.test(value) || String(value || "").startsWith("//");
  }

  function normalizeUrlForCompare(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  // Turn "https://...workers.dev/vote" into "/api/vote" when possible
  function resolvePrimaryApiUrl(rawUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return DEFAULT_API_URL;

    // Relative path already
    if (!isAbsoluteUrl(raw)) return raw;

    try {
      const parsed = new URL(raw, window.location.origin);

      // If it's same-origin absolute, strip origin to keep it relative
      if (parsed.origin === window.location.origin) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}` || DEFAULT_API_URL;
      }

      // If the HTML points to the workers URL, we still prefer /api/vote
      if (
        normalizeUrlForCompare(parsed.toString()) === normalizeUrlForCompare(FALLBACK_API_URL)
      ) {
        return DEFAULT_API_URL;
      }
    } catch {
      return DEFAULT_API_URL;
    }

    // Any other cross-origin absolute URL: ignore, use /api/vote
    return DEFAULT_API_URL;
  }

  function createApiCaller(primaryApiUrl, gameId, voterId) {
    const endpoints = [primaryApiUrl];
    if (normalizeUrlForCompare(primaryApiUrl) !== normalizeUrlForCompare(FALLBACK_API_URL)) {
      endpoints.push(FALLBACK_API_URL);
    }

    async function request(endpoint, method, action) {
      if (method === "GET") {
        const u = new URL(endpoint, window.location.origin);
        u.searchParams.set("gameId", gameId);
        u.searchParams.set("voterId", voterId);

        const res = await fetch(u.toString(), { method: "GET" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`GET /vote failed: ${res.status} ${body}`.trim());
        }
        return res.json();
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, voterId, action }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`POST /vote failed: ${res.status} ${body}`.trim());
      }
      return res.json();
    }

    return async function callApi(method, action) {
      let lastError;
      for (let i = 0; i < endpoints.length; i += 1) {
        try {
          return await request(endpoints[i], method, action);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError || new Error("Vote API request failed");
    };
  }

  function formatVoteCount(value) {
    const count = Number(value) || 0;
    if (count > 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return String(count);
  }

  /* ------------------------------------------------------------------ *
   * "What don't you like about it?" toast (Poki-style)
   *
   * Shown bottom-right on the transition INTO a dislike only -- never when
   * the visitor clicks dislike a second time to REMOVE their vote, never on a
   * like (the owner tried a like-side version and asked for it to go), and
   * never more than once per game per browser (see FEEDBACK_ASKED_PREFIX).
   * The backend takes free text, so this is a single field, not reason chips.
   *
   * Self-contained on purpose: styles are injected from here the same way
   * hoverpreview.js / iphone-play.js do theirs, so nothing has to be added to
   * style.css and re-versioned across 278 game pages.
   * ------------------------------------------------------------------ */

  const FEEDBACK_MAX_CHARS = 500; // backend cap is 2000; a toast field is not an essay box
  const FEEDBACK_AUTO_DISMISS_MS = 14000;
  const FEEDBACK_THANKS_MS = 2200;
  const FEEDBACK_THANKS_TEXT = "Thanks for the feedback!";

  // The "electric blue" the owner asked for on the Submit button. Deliberately
  // NOT --pz-accent (the site yellow): this one button is meant to stand apart.
  const FEEDBACK_BLUE = "#1f6dff";
  const FEEDBACK_BLUE_HOVER = "#3d82ff";

  const FEEDBACK_ASKED_PREFIX = "vote:fb:";
  const FEEDBACK_PLACEHOLDER = "Tell us what's off - bugs, controls, ads, anything.";
  // Rounded thumbs-down: a soft-filled thumb plus a separate cuff. Its own
  // drawing, not the sprite's blocky `thumbDownIcon`.
  const FEEDBACK_ICON =
    '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" ' +
    'fill="currentColor" fill-opacity=".16"/>' +
    '<path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>';

  let feedbackStyleInjected = false;
  let openFeedback = null; // { close(how) } for the one toast that may exist at a time

  // Called from the vote buttons: the moment the visitor's vote leaves "down"
  // (they clicked Like, or clicked Dislike again to take the vote back) the
  // question is moot, so the form goes away at once. No "asked" marker is
  // written for this exit -- they never declined to answer, so a later real
  // dislike may ask again.
  function dismissDislikeFeedback() {
    if (openFeedback) openFeedback.close("retracted");
  }

  function feedbackAlreadyAsked(key) {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  function markFeedbackAsked(key, how) {
    try {
      localStorage.setItem(key, how);
    } catch {
      /* private mode / storage full: worst case we ask once more later */
    }
  }

  function injectFeedbackStyle() {
    if (feedbackStyleInjected) return;
    feedbackStyleInjected = true;

    // Every piece of text in this feature uses the game-description font
    // (`.game-description p` in style.css), never Bebas Neue -- owner request.
    const FONT = "font-family:'Rubik Toolbar','Rubik Fallback',Arial,sans-serif;";

    const style = document.createElement("style");
    style.id = "pz-fb-style";
    style.textContent = [
      // Bottom-right toast, NOT a modal -- the game stays clickable behind it.
      // z-index sits above the back-to-top button and the phone mini play bar
      // (both 900) but below the nav (1000), same ladder those files use.
      // `bottom` is transitioned because it is recomputed on scroll to stay
      // clear of whatever else is anchored down there.
      ".pz-vote-fb{position:fixed;right:22px;bottom:22px;z-index:950;",
      "width:328px;max-width:calc(100vw - 28px);box-sizing:border-box;",
      "padding:16px 16px 14px;border-radius:16px;",
      "border:1px solid var(--pz-line,rgba(255,255,255,.1));",
      "background:var(--pz-panel,#1f1f1f);",
      "box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.35);",
      FONT, "color:#fff;",
      "opacity:0;transform:translateY(14px);pointer-events:none;",
      "transition:opacity .22s ease,transform .22s cubic-bezier(.2,.9,.3,1.2),bottom .2s ease}",
      ".pz-vote-fb.pzfb-in{opacity:1;transform:translateY(0);pointer-events:auto}",

      // Dismiss. Always present, never disabled, never hidden -- the visitor
      // can always walk away without answering.
      ".pz-vote-fb .pzfb-x{position:absolute;top:8px;right:8px;",
      "width:28px;height:28px;padding:0;border:0;border-radius:50%;",
      "background:transparent;color:var(--pz-muted,#a7a7a7);cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;",
      "-webkit-tap-highlight-color:transparent;transition:color .15s ease,background-color .15s ease}",
      ".pz-vote-fb .pzfb-x:hover{color:#fff;background:rgba(255,255,255,.08)}",
      ".pz-vote-fb .pzfb-x svg{width:13px;height:13px;display:block}",

      // Header: the red thumbs-down in a soft red disc, next to the question.
      // The disc keeps its size when a long game name wraps the title.
      ".pz-vote-fb .pzfb-head{display:flex;align-items:center;gap:11px;",
      "margin:0 28px 12px 0}",
      ".pz-vote-fb .pzfb-badge{flex:0 0 auto;width:38px;height:38px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;",
      "background:rgba(252,88,73,.14);box-shadow:inset 0 0 0 1px rgba(252,88,73,.28)}",
      ".pz-vote-fb .pzfb-icon{width:21px;height:21px;display:block;",
      "color:var(--pz-hot,#fc5849)}",
      ".pz-vote-fb .pzfb-title{display:block;",
      "font-size:.95rem;font-weight:600;line-height:1.3;color:#fff;",
      "overflow-wrap:anywhere}",

      ".pz-vote-fb .pzfb-input{display:block;width:100%;box-sizing:border-box;",
      "margin:0;padding:10px 12px;resize:none;",
      "border:1px solid var(--pz-line,rgba(255,255,255,.1));border-radius:11px;",
      "background:var(--pz-bg,#161616);color:#fff;", FONT,
      "font-size:.875rem;line-height:1.4;outline:none;",
      "transition:border-color .15s ease,box-shadow .15s ease}",
      ".pz-vote-fb .pzfb-input::placeholder{color:var(--pz-muted,#a7a7a7);opacity:1}",
      ".pz-vote-fb .pzfb-input:focus{border-color:", FEEDBACK_BLUE, ";",
      "box-shadow:0 0 0 3px rgba(31,109,255,.22)}",

      ".pz-vote-fb .pzfb-row{display:flex;align-items:center;",
      "justify-content:space-between;gap:10px;margin-top:11px}",
      ".pz-vote-fb .pzfb-hint{display:flex;align-items:center;gap:5px;",
      "font-size:.72rem;line-height:1;color:var(--pz-muted,#a7a7a7);user-select:none}",
      ".pz-vote-fb .pzfb-hint kbd{display:inline-block;padding:3px 5px 2px;border-radius:5px;",
      FONT, "font-size:.66rem;font-weight:500;line-height:1;color:#d6d6d6;",
      "background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 1px 0 rgba(255,255,255,.08)}",

      // Always solid: there is no disabled/greyed state. An empty submit just
      // refocuses the box (see submit()), it never dims the button.
      ".pz-vote-fb .pzfb-send{flex:0 0 auto;border:0;border-radius:9999px;cursor:pointer;",
      "padding:9px 20px;background:", FEEDBACK_BLUE, ";color:#fff;", FONT,
      "font-size:.8125rem;font-weight:700;line-height:1;letter-spacing:.01em;",
      "box-shadow:0 4px 14px rgba(31,109,255,.35);",
      "-webkit-tap-highlight-color:transparent;",
      "transition:background-color .15s ease,transform .1s ease,box-shadow .15s ease}",
      ".pz-vote-fb .pzfb-send:hover{background:", FEEDBACK_BLUE_HOVER, "}",
      ".pz-vote-fb .pzfb-send:active{transform:translateY(1px);box-shadow:0 2px 8px rgba(31,109,255,.3)}",
      ".pz-vote-fb .pzfb-send:focus-visible{outline:2px solid #fff;outline-offset:2px}",

      // Empty-submit nudge: a short shake on the input, nothing else.
      ".pz-vote-fb .pzfb-input.pzfb-shake{animation:pzfb-shake .3s ease;border-color:var(--pz-hot,#fc5849)}",
      "@keyframes pzfb-shake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}",
      "60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}",

      // The thank-you is NOT the toast: it is a separate small pill, centred
      // horizontally, sitting a little above the bottom of the viewport.
      "#pz-feedback-thanks{position:fixed;left:50%;bottom:max(72px,11vh);z-index:950;",
      "display:flex;align-items:center;gap:8px;",
      "max-width:calc(100vw - 28px);box-sizing:border-box;",
      "padding:10px 16px 10px 13px;border-radius:9999px;",
      "border:1px solid var(--pz-line,rgba(255,255,255,.1));",
      "background:var(--pz-panel,#1f1f1f);box-shadow:0 12px 34px rgba(0,0,0,.55);",
      FONT, "font-size:.8125rem;font-weight:500;line-height:1.2;color:#fff;",
      "white-space:nowrap;pointer-events:none;",
      "opacity:0;transform:translate(-50%,10px);",
      "transition:opacity .22s ease,transform .22s cubic-bezier(.2,.9,.3,1.2)}",
      "#pz-feedback-thanks.pzfb-in{opacity:1;transform:translate(-50%,0)}",
      "#pz-feedback-thanks .pzfb-check{flex:0 0 auto;width:18px;height:18px;border-radius:50%;",
      "display:flex;align-items:center;justify-content:center;background:", FEEDBACK_BLUE, "}",
      "#pz-feedback-thanks .pzfb-check svg{width:10px;height:10px;display:block}",

      // Phones: the vote buttons are hidden below 551px today
      // (`.voting.max-[550.9px]:hidden`), so this is belt and braces -- but if
      // they are ever shown, a 328px box pinned to `right:22px` would crowd a
      // 360px screen, so go edge to edge with the same 14px gutter the
      // back-to-top button uses there.
      "@media (max-width:520px){.pz-vote-fb{left:14px;right:14px;width:auto;max-width:none}}",

      // Never float over a game that is playing fullscreen.
      "body.isFullscreen .pz-vote-fb,body.isFullscreen #pz-feedback-thanks{display:none}",
      "@media (prefers-reduced-motion:reduce){.pz-vote-fb,#pz-feedback-thanks{transition:none}",
      ".pz-vote-fb .pzfb-input.pzfb-shake{animation:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  // Whatever else is pinned to the bottom of a game page has to be cleared:
  // the phone sticky play bar (#pz-mini-play, full width) and the desktop
  // back-to-top button (#backToTop, same corner). Both only occupy space while
  // they carry their "shown" class, so measure rather than guess.
  function feedbackBottomOffset() {
    const gutter = window.innerWidth <= 520 ? 14 : 22;

    const miniBar = document.getElementById("pz-mini-play");
    if (miniBar && miniBar.classList.contains("pzm-shown")) {
      return Math.round(miniBar.getBoundingClientRect().height) + 10;
    }

    const backToTop = document.getElementById("backToTop");
    if (backToTop && backToTop.classList.contains("show")) {
      return gutter + Math.round(backToTop.getBoundingClientRect().height) + 10;
    }

    return gutter;
  }

  // `gameName` rides along so the worker's Discord mirror can print the game's
  // name instead of its numeric id; the worker ignores it otherwise.
  async function postFeedback(votingEl, gameId, voterId, text, gameName) {
    const override = String(votingEl.dataset.feedbackUrl || "").trim();
    const endpoints = override ? [override] : [DEFAULT_FEEDBACK_URL, FALLBACK_FEEDBACK_URL];

    let lastError;
    for (let i = 0; i < endpoints.length; i += 1) {
      try {
        const res = await fetch(endpoints[i], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId, voterId, text, gameName })
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`POST /feedback failed: ${res.status} ${body}`.trim());
        }
        return res.json().catch(() => ({}));
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error("Feedback request failed");
  }

  // The clean display name, not the SEO page title. Same source the phone play
  // gate reads (`.game-toolbar .text-xl.font-bold`), which every game page
  // carries identically, so no extra request and no "... Unblocked" suffix.
  // og:title is the fallback; both were spot-checked to agree.
  function gameDisplayName() {
    const bar = document.querySelector(".game-toolbar .text-xl.font-bold");
    const fromBar = bar ? bar.textContent.trim() : "";
    if (fromBar) return fromBar;

    const og = document.querySelector('meta[property="og:title"]');
    const fromOg = og ? String(og.getAttribute("content") || "").trim() : "";
    if (fromOg) return fromOg;

    return String(document.title || "")
      .split(/[|\-–]/)[0]
      .replace(/\bunblocked\b/i, "")
      .trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function showDislikeFeedback(votingEl, gameId, voterId) {
    // One at a time, never twice for the same game, never over a fullscreen game.
    if (openFeedback) return;
    const askedKey = FEEDBACK_ASKED_PREFIX + gameId;
    if (feedbackAlreadyAsked(askedKey)) return;
    if (document.body.classList.contains("isFullscreen")) return;

    injectFeedbackStyle();

    const name = gameDisplayName();
    const question = name
      ? `What don't you like about ${name}?`
      : "What don't you like about this game?";

    const box = document.createElement("div");
    box.id = "pz-dislike-feedback";
    box.className = "pz-vote-fb";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", question);
    box.innerHTML =
      // X, top-right. Always there, never disabled.
      '<button class="pzfb-x" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>' +
      "</button>" +
      // Red thumbs-down in a soft red disc (see FEEDBACK_ICON).
      '<div class="pzfb-head">' +
      '<span class="pzfb-badge">' +
      '<svg class="pzfb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      FEEDBACK_ICON + "</svg>" +
      "</span>" +
      '<span class="pzfb-title">' + escapeHtml(question) + "</span>" +
      "</div>" +
      '<textarea class="pzfb-input" rows="3" maxlength="' + FEEDBACK_MAX_CHARS + '" ' +
      'aria-label="' + escapeHtml(question) + '" ' +
      'placeholder="' + escapeHtml(FEEDBACK_PLACEHOLDER) + '"></textarea>' +
      '<div class="pzfb-row">' +
      '<span class="pzfb-hint"><kbd>Enter</kbd> to send</span>' +
      '<button class="pzfb-send" type="button">Submit</button>' +
      "</div>";
    document.body.appendChild(box);

    const closeBtn = box.querySelector(".pzfb-x");
    const input = box.querySelector(".pzfb-input");
    const sendBtn = box.querySelector(".pzfb-send");

    let autoTimer = null;
    let closed = false;

    function reposition() {
      box.style.bottom = `${feedbackBottomOffset()}px`;
    }

    function cancelAuto() {
      if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
    }

    // `how` is the exit path. Every path but "retracted" (the vote left
    // "down" -- see dismissDislikeFeedback) writes the once-per-game marker.
    function close(how) {
      if (closed) return;
      closed = true;
      cancelAuto();
      openFeedback = null;

      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("keydown", onKeyDown);

      if (how !== "retracted") markFeedbackAsked(askedKey, how);

      box.classList.remove("pzfb-in");
      setTimeout(() => box.remove(), 260);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") close("dismissed");
    }

    reposition();
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    document.addEventListener("keydown", onKeyDown);

    // Animate in on the next frame so the initial transform is painted first.
    requestAnimationFrame(() => box.classList.add("pzfb-in"));

    // Goes away on its own if it is ignored -- but the moment the visitor
    // starts writing, the countdown is cancelled for good so it can never pull
    // the box out from under them mid-sentence. The X stays either way.
    autoTimer = setTimeout(() => close("ignored"), FEEDBACK_AUTO_DISMISS_MS);
    box.addEventListener("pointerdown", cancelAuto);
    input.addEventListener("focus", cancelAuto);

    input.addEventListener("input", () => {
      cancelAuto();
      input.classList.remove("pzfb-shake");
    });

    // Enter sends, Shift+Enter makes a new line.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    closeBtn.addEventListener("click", () => close("dismissed"));
    sendBtn.addEventListener("click", submit);

    let submitted = false;

    function submit() {
      if (submitted || closed) return;

      const text = input.value.trim().slice(0, FEEDBACK_MAX_CHARS);
      if (!text) {
        // The button is always solid, so an empty click gets a nudge instead
        // of a dead button: focus the box and shake it once.
        cancelAuto();
        input.classList.remove("pzfb-shake");
        void input.offsetWidth; // restart the animation if it is mid-run
        input.classList.add("pzfb-shake");
        input.focus();
        return;
      }
      submitted = true;

      // Optimistic: the visitor is told it landed and the box leaves either
      // way. A failed write is logged, not shown -- nothing they could do.
      postFeedback(votingEl, gameId, voterId, text, name).catch((e) => console.warn(e));

      close("submitted");
      showFeedbackThanks();
    }

    openFeedback = { close };
  }

  // Small centred pill near the bottom of the screen, shown for a moment
  // after a dislike-form submit. Separate from the toast on purpose: the
  // toast slides away in its corner and this fades in mid-screen where the
  // eye lands. Only ever called from submit(), so the CSS is already in.
  let thanksTimer = null;

  function showFeedbackThanks() {
    const old = document.getElementById("pz-feedback-thanks");
    if (old) old.remove();
    if (thanksTimer) clearTimeout(thanksTimer);

    const pill = document.createElement("div");
    pill.id = "pz-feedback-thanks";
    pill.setAttribute("role", "status");
    pill.innerHTML =
      '<span class="pzfb-check" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>' +
      "</span>" + escapeHtml(FEEDBACK_THANKS_TEXT);
    document.body.appendChild(pill);

    requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add("pzfb-in")));

    thanksTimer = setTimeout(() => {
      thanksTimer = null;
      pill.classList.remove("pzfb-in");
      setTimeout(() => pill.remove(), 260);
    }, FEEDBACK_THANKS_MS);
  }

  function initVoting(votingEl) {
    // Your HTML: document.querySelector(".voting").dataset -> { gameId, url, up, down }
    const gameId = votingEl.dataset.gameId;
    if (!gameId) return;

    const primaryApiUrl = resolvePrimaryApiUrl(votingEl.dataset.url);

    const upCountEl = votingEl.querySelector(".up-votes-count");
    const downCountEl = votingEl.querySelector(".down-votes-count");

    // Your buttons: #btn-like and #btn-dislike (also supports data-vote fallback)
    const likeBtn = votingEl.querySelector("#btn-like") || votingEl.querySelector('[data-vote="up"]');
    const dislikeBtn =
      votingEl.querySelector("#btn-dislike") || votingEl.querySelector('[data-vote="down"]');

    if (!likeBtn || !dislikeBtn || !upCountEl || !downCountEl) return;

    const ratingValueEl = document.querySelector(".game-rating .game-rating-value");
    const ratingVotesEl = document.querySelector(".game-rating .game-rating-votes");

    const voteKey = `vote:${gameId}`;
    const countKey = `vote:counts:${gameId}`;
    const countTsKey = `vote:counts:ts:${gameId}`;

    const voterId = getVoterId();
    const callApi = createApiCaller(primaryApiUrl, gameId, voterId);

    let up = Number(votingEl.dataset.up ?? upCountEl.textContent ?? 0);
    let down = Number(votingEl.dataset.down ?? downCountEl.textContent ?? 0);

    let state = null; // "up" | "down" | null
    let confirmedState = null;
    let desiredState = null;

    let isSyncingVote = false;
    let isLoadingVotes = false;
    let voteSyncTimer = null;
    let lastPostAt = 0;

    let confirmedUp = up;
    let confirmedDown = down;
    let desiredUp = up;
    let desiredDown = down;

    const POLL_INTERVAL_MS = 3_600_000; // 1 hour
    const CACHE_TTL_MS = 3_600_000; // 1 hour
    const CLICK_DEBOUNCE_MS = 120; // collapse spam clicks
    const MIN_POST_GAP_MS = 500; // backend sync cap

    function render() {
      const likeTip = likeBtn.querySelector(".game-toolbar-vote-button-tip");
      const dislikeTip = dislikeBtn.querySelector(".game-toolbar-vote-button-tip");

      upCountEl.textContent = formatVoteCount(up);
      downCountEl.textContent = formatVoteCount(down);

      likeBtn.classList.toggle("active", state === "up");
      dislikeBtn.classList.toggle("active", state === "down");

      if (likeTip) likeTip.textContent = state === "up" ? "Remove" : "Like";
      if (dislikeTip) dislikeTip.textContent = state === "down" ? "Remove" : "Dislike";

      const total = up + down;
      if (ratingValueEl) {
        ratingValueEl.textContent = total > 0 ? `${((up / total) * 5).toFixed(1)}/5` : "–/5";
      }
      if (ratingVotesEl) {
        ratingVotesEl.textContent = `${total.toLocaleString("en-US")} ${total === 1 ? "VOTE" : "VOTES"}`;
      }
    }

    function applyOptimisticCounts(nextState) {
      const prevState = desiredState;

      if (prevState === "up") desiredUp = Math.max(0, desiredUp - 1);
      else if (prevState === "down") desiredDown = Math.max(0, desiredDown - 1);

      if (nextState === "up") desiredUp += 1;
      else if (nextState === "down") desiredDown += 1;

      up = desiredUp;
      down = desiredDown;
    }

    function loadCachedCounts() {
      const raw = localStorage.getItem(countKey);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.up !== "number" || typeof parsed?.down !== "number") return false;

        up = parsed.up;
        down = parsed.down;

        votingEl.dataset.up = String(up);
        votingEl.dataset.down = String(down);
        return true;
      } catch {
        return false;
      }
    }

    function applyServerData(data, fallbackState = state) {
      if (!data || typeof data !== "object") return;

      if (typeof data.up === "number") up = data.up;
      if (typeof data.down === "number") down = data.down;

      confirmedUp = up;
      confirmedDown = down;
      desiredUp = up;
      desiredDown = down;

      if (data.userVote === 1) state = "up";
      else if (data.userVote === -1) state = "down";
      else if (Object.prototype.hasOwnProperty.call(data, "userVote")) state = null;
      else state = fallbackState;

      if (state) localStorage.setItem(voteKey, state);
      else localStorage.removeItem(voteKey);

      confirmedState = state;
      desiredState = state;

      localStorage.setItem(countKey, JSON.stringify({ up, down }));
      localStorage.setItem(countTsKey, String(Date.now()));

      votingEl.dataset.up = String(up);
      votingEl.dataset.down = String(down);

      render();
    }

    function getCachedAgeMs() {
      const ts = Number(localStorage.getItem(countTsKey) || 0);
      if (!Number.isFinite(ts) || ts <= 0) return Number.POSITIVE_INFINITY;
      return Date.now() - ts;
    }

    async function loadVotes() {
      if (isLoadingVotes) return;
      isLoadingVotes = true;
      try {
        const data = await callApi("GET");
        if (desiredState === confirmedState && !isSyncingVote) {
          applyServerData(data);
        }
      } finally {
        isLoadingVotes = false;
      }
    }

    async function postVote(action) {
      const nextState = action === "up" || action === "down" ? action : null;
      applyServerData(await callApi("POST", action), nextState);
    }

    // Init from local cache
    const cachedVote = localStorage.getItem(voteKey);
    if (cachedVote === "up" || cachedVote === "down") state = cachedVote;
    confirmedState = state;
    desiredState = state;

    loadCachedCounts();

    confirmedUp = up;
    confirmedDown = down;
    desiredUp = up;
    desiredDown = down;

    render();

    likeBtn.disabled = true;
    dislikeBtn.disabled = true;
    loadVotes()
      .catch((e) => console.warn(e))
      .finally(() => {
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;
      });

    // Periodic refresh
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (getCachedAgeMs() <= CACHE_TTL_MS) return;
      loadVotes().catch((e) => console.warn(e));
    }, POLL_INTERVAL_MS);

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function scheduleSyncVote() {
      if (voteSyncTimer) clearTimeout(voteSyncTimer);
      voteSyncTimer = setTimeout(() => {
        voteSyncTimer = null;
        syncVote();
      }, CLICK_DEBOUNCE_MS);
    }

    async function syncVote() {
      if (isSyncingVote) return;
      if (desiredState === confirmedState) return;

      isSyncingVote = true;
      likeBtn.disabled = true;
      dislikeBtn.disabled = true;

      try {
        const gap = Date.now() - lastPostAt;
        if (gap < MIN_POST_GAP_MS) await wait(MIN_POST_GAP_MS - gap);

        await postVote(desiredState ?? "remove");
        lastPostAt = Date.now();
      } catch (e) {
        // rollback
        state = confirmedState;
        desiredState = confirmedState;

        up = confirmedUp;
        down = confirmedDown;
        desiredUp = confirmedUp;
        desiredDown = confirmedDown;

        render();
        console.warn(e);
      } finally {
        isSyncingVote = false;
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;

        if (desiredState !== confirmedState) scheduleSyncVote();
      }
    }

    function afterVoteChange(prevState, nextState) {
      if (prevState === "down" && nextState !== "down") dismissDislikeFeedback();
    }

    function onVoteClick(dir) {
      if (isSyncingVote || voteSyncTimer) return;

      const prevState = desiredState;
      const nextState = desiredState === dir ? null : dir;
      applyOptimisticCounts(nextState);
      desiredState = nextState;
      state = desiredState;
      render();
      scheduleSyncVote();
      afterVoteChange(prevState, nextState);
    }

    likeBtn.addEventListener("click", () => onVoteClick("up"));
    dislikeBtn.addEventListener("click", () => onVoteClick("down"));
  }

  function restoreToolbarIcons() {
    const paths = {
      thumbUpIcon: '<path d="M7 10v10H4V10h3Zm2 10V10l4.2-7.1c.5-.8 1.7-.9 2.3-.2.3.3.4.8.3 1.2L15 8h4.2c1.1 0 1.9 1 1.7 2.1l-1.5 8.5c-.1.8-.8 1.4-1.7 1.4H9Z" fill="currentColor"></path>',
      thumbDownIcon: '<path d="M17 14V4h3v10h-3ZM15 4v10l-4.2 7.1c-.5.8-1.7.9-2.3.2-.3-.3-.4-.8-.3-1.2L9 16H4.8c-1.1 0-1.9-1-1.7-2.1l1.5-8.5C4.7 4.6 5.4 4 6.3 4H15Z" fill="currentColor"></path>',
      enterFullscreenIcon: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>',
      exitFullscreenIcon: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'
    };
    document.querySelectorAll('use[href*="game-icons.svg#"]').forEach((use) => {
      const iconName = use.getAttribute("href").split("#").pop();
      if (paths[iconName]) use.parentElement.innerHTML = paths[iconName];
    });
  }

  restoreToolbarIcons();

  const votingBlocks = document.querySelectorAll(".voting[data-game-id]");
  if (!votingBlocks.length) return;

  votingBlocks.forEach((el) => {
    try {
      initVoting(el);
    } catch (e) {
      console.warn(e);
    }
  });
})();
