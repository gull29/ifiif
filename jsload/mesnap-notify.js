/* ME Snap notifications, site-wide.
   While you are logged in to ME Snap, this shows a toast (top right, X to dismiss, gone after 5s) and
   adds an entry to the bell menu when you get a message, snap, GIF or game invite, when someone sends
   you a friend request, and when someone accepts yours.

   It only loads Firebase when localStorage "mesnap_token" (set by the app at login, removed at logout)
   exists, and listens only for NEW data (push-id range queries), so it stays cheap on other pages. */
(function () {
  "use strict";
  if (window.__meSnapNotify) return;
  window.__meSnapNotify = true;

  var CONFIG = {
    apiKey: "AIzaSyBmqoyt-mwejmRHcPfxdZsrMTr6ZmYQG1U",
    authDomain: "mesnapdata.firebaseapp.com",
    databaseURL: "https://mesnapdata-default-rtdb.firebaseio.com",
    projectId: "mesnapdata",
    appId: "1:924209720534:web:21a1849a99a9e9b3faad77"
  };
  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  var TOAST_MS = 5000, MAX_STORED = 30;

  var inApp = /\/a\/mesnap\.html$/.test(location.pathname);
  var base = /\/(?:g|a)\/[^/]*$/.test(location.pathname) ? "../" : "";
  var appUrl = base + "a/mesnap.html";

  /* ---------- state ---------- */
  var uid = null, db = null, items = [], bells = [], toastBox = null, panel = null;
  var cache = { names: {} }, listeners = [];
  var key = function (k) { return "mesnap_notify_" + k + "_" + uid; };
  var read = function (k, d) { try { var v = JSON.parse(localStorage.getItem(key(k))); return v == null ? d : v; } catch (e) { return d; } };
  var write = function (k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) {} };

  /* ---------- UI ---------- */
  var BELL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var css = document.createElement("style");
  css.textContent =
    ".mn-bell{position:relative;width:40px;height:40px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:transparent;border:0;cursor:pointer;flex:0 0 auto;padding:0;transition:background-color .15s ease,color .15s ease}" +
    ".mn-bell svg{width:22px;height:22px}.mn-bell:hover,.mn-bell:focus-visible,.mn-bell.open{background:rgba(255,255,255,.08);color:#f0d210;outline:none}" +
    ".mn-bell-nav3{display:none}@media (max-width:900px){.mn-bell-nav3{display:inline-flex}.mn-bell-main{display:none}}" +
    ".mn-badge{position:absolute;top:3px;right:3px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#F23C57;color:#fff;font:700 10px/16px Rubik,sans-serif;text-align:center;display:none}" +
    ".mn-bell.has-unread .mn-badge{display:block}" +
    ".mn-toasts{position:fixed;top:72px;right:16px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(340px,calc(100vw - 32px));pointer-events:none}" +
    ".mn-toast{pointer-events:auto;position:relative;display:flex;align-items:center;gap:12px;padding:12px 38px 12px 12px;border-radius:14px;background:#1c1c1c;border:1px solid #333;border-left:4px solid #FFFC00;box-shadow:0 12px 32px rgba(0,0,0,.55);color:#fff;font-family:Rubik,sans-serif;text-decoration:none;cursor:pointer;animation:mn-in .25s ease}" +
    ".mn-toast.out{animation:mn-out .25s ease forwards}" +
    "@keyframes mn-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}@keyframes mn-out{to{opacity:0;transform:translateX(24px)}}" +
    ".mn-toast img{width:40px;height:40px;border-radius:10px;flex:0 0 auto}" +
    ".mn-toast-title{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#FFFC00}" +
    ".mn-toast-body{font-size:14px;font-weight:500;line-height:1.3;word-break:break-word}" +
    ".mn-x{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#ddd;font:700 14px/1 Rubik,sans-serif;cursor:pointer;padding:0}" +
    ".mn-x:hover{background:#f0d210;color:#111}" +
    ".mn-panel{position:fixed;z-index:2147483000;top:64px;right:16px;width:min(360px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#1c1c1c;border:1px solid #333;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.55);color:#fff;font-family:Rubik,sans-serif;display:none}" +
    ".mn-panel.open{display:block}" +
    ".mn-panel-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #333;font-weight:700;font-size:14px}" +
    ".mn-panel-head button{background:none;border:0;color:#9a9a9a;font:600 12px Rubik,sans-serif;cursor:pointer}.mn-panel-head button:hover{color:#f0d210}" +
    ".mn-item{display:flex;gap:10px;padding:11px 14px;color:#fff;text-decoration:none;border-bottom:1px solid #262626;font-size:13px;line-height:1.35}" +
    ".mn-item:hover{background:rgba(255,255,255,.06)}.mn-item.unread{background:rgba(255,252,0,.06)}" +
    ".mn-item small{display:block;color:#9a9a9a;font-size:11px;margin-top:2px}" +
    ".mn-dot{flex:0 0 8px;height:8px;border-radius:50%;margin-top:5px;background:transparent}.mn-item.unread .mn-dot{background:#FFFC00}" +
    ".mn-empty{padding:22px 14px;text-align:center;color:#9a9a9a;font-size:13px}.mn-empty a{color:#f0d210}";
  document.head.appendChild(css);

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }

  function makeBell(extraClass) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mn-bell " + extraClass; b.setAttribute("aria-label", "Notifications"); b.title = "Notifications";
    b.innerHTML = BELL + '<span class="mn-badge"></span>';
    b.addEventListener("click", function (e) { e.stopPropagation(); togglePanel(b); });
    bells.push(b);
    return b;
  }

  function mountBells() {
    var inner = document.querySelector(".pz-nav .pz-nav-inner");
    if (!inner) return;
    var settings = inner.querySelector(':scope > a[href$="settings.html"]');
    inner.insertBefore(makeBell("mn-bell-main"), settings || null);
    var row = document.getElementById("pzExpNav3");
    if (row) row.insertBefore(makeBell("mn-bell-nav3"), row.querySelector(".pz-exp-searchbtn"));
    document.addEventListener("click", function (e) { if (panel && !panel.contains(e.target)) closePanel(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });
  }

  function unreadCount() { return items.filter(function (i) { return !i.read; }).length; }
  function refreshBadge() {
    var n = unreadCount();
    bells.forEach(function (b) {
      b.classList.toggle("has-unread", n > 0);
      b.querySelector(".mn-badge").textContent = n > 9 ? "9+" : String(n);
    });
  }

  function renderPanel() {
    if (!panel) { panel = document.createElement("div"); panel.className = "mn-panel"; document.body.appendChild(panel); }
    var html = '<div class="mn-panel-head"><span>Notifications</span>' + (items.length ? '<button type="button" data-clear>Clear all</button>' : "") + "</div>";
    if (!uid) html += '<div class="mn-empty">No notifications yet. Log in to <a href="' + appUrl + '">ME Snap</a> to get message and friend alerts here.</div>';
    else if (!items.length) html += '<div class="mn-empty">No notifications yet.</div>';
    else html += items.map(function (i) {
      return '<a class="mn-item' + (i.read ? "" : " unread") + '" href="' + appUrl + '"><span class="mn-dot"></span><span>' + esc(i.text) + "<small>" + ago(i.t) + "</small></span></a>";
    }).join("");
    panel.innerHTML = html;
    var clear = panel.querySelector("[data-clear]");
    if (clear) clear.addEventListener("click", function (e) { e.stopPropagation(); items = []; persist(); renderPanel(); refreshBadge(); });
  }
  function togglePanel(btn) {
    renderPanel();
    var open = !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    bells.forEach(function (b) { b.classList.toggle("open", open && b === btn); });
    if (open) { items.forEach(function (i) { i.read = true; }); persist(); refreshBadge(); }
  }
  function closePanel() { if (panel) panel.classList.remove("open"); bells.forEach(function (b) { b.classList.remove("open"); }); }

  function toast(text) {
    if (!toastBox) { toastBox = document.createElement("div"); toastBox.className = "mn-toasts"; document.body.appendChild(toastBox); }
    var el = document.createElement("a");
    el.className = "mn-toast"; el.href = appUrl;
    el.innerHTML = '<img src="' + base + 'apnggames/mesnap.png" alt=""><div><div class="mn-toast-title">ME Snap notification</div><div class="mn-toast-body">' + esc(text) + '</div></div><button type="button" class="mn-x" aria-label="Dismiss">\u00d7</button>';
    var gone = false;
    function close() { if (gone) return; gone = true; el.classList.add("out"); setTimeout(function () { el.remove(); }, 260); }
    el.querySelector(".mn-x").addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); close(); });
    toastBox.appendChild(el);
    setTimeout(close, TOAST_MS);
  }

  /* ---------- notification store ---------- */
  function persist() { write("items", items.slice(0, MAX_STORED)); }
  function notify(id, text, when) {
    if (items.some(function (i) { return i.id === id; })) return;   // already shown (e.g. by another page)
    items.unshift({ id: id, text: text, t: when || Date.now(), read: inApp });
    items = items.slice(0, MAX_STORED);
    persist(); refreshBadge();
    if (panel && panel.classList.contains("open")) renderPanel();
    if (!inApp) toast(text);   // inside ME Snap itself the app already shows the message
  }

  /* ---------- firebase ---------- */
  var PUSH = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  function pushKeyAt(ts) {   // smallest push id for a timestamp, so orderByKey().startAt() = "newer than ts"
    var s = "";
    for (var i = 0; i < 8; i++) { s = PUSH.charAt(ts % 64) + s; ts = Math.floor(ts / 64); }
    return s + "------------";
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function userName(id, hint) {
    if (hint) { cache.names[id] = hint; return Promise.resolve(hint); }
    if (cache.names[id]) return Promise.resolve(cache.names[id]);
    return db.ref("users/" + id + "/username").once("value").then(function (s) { return (cache.names[id] = s.val() || "Someone"); }, function () { return "Someone"; });
  }
  function messageType(m) {
    if (m.image) return "snap";
    if (m.gif) return "GIF";
    if (m.blackjackGameId) return "Blackjack invite";
    if (m.poolGameId) return "Pool invite";
    return "message";
  }
  function listen(ref, event, fn) { ref.on(event, fn, function () {}); listeners.push([ref, event, fn]); }
  function stopAll() { listeners.forEach(function (l) { try { l[0].off(l[1], l[2]); } catch (e) {} }); listeners = []; }

  var blocked = {};
  function onMessage(snap, group) {
    var m = snap.val(); if (!m || m.system || m.senderId === uid || blocked[m.senderId]) return;
    if (!group && m.receiverId !== uid) return;
    var when = m.createdAt || Date.now();
    if (when < sinceTs - 60000) return;
    userName(m.senderId, m.senderName).then(function (name) {
      var type = messageType(m);
      notify("m:" + snap.key, group ? name + " sent a " + type + " in " + group : name + " sent you a " + type, when);
    });
  }

  var sinceTs = Date.now();
  function start(user) {
    uid = user.uid;
    items = read("items", []);
    refreshBadge();
    var lastSeen = read("lastSeen", 0);
    sinceTs = lastSeen && Date.now() - lastSeen < 24 * 3600 * 1000 ? lastSeen : Date.now();
    var offset = 0;
    db.ref(".info/serverTimeOffset").once("value").then(function (s) { offset = s.val() || 0; }, function () {}).then(function () {
      var from = pushKeyAt(Math.floor(sinceTs + offset) - 5000);

      listen(db.ref("users/" + uid + "/blocked"), "value", function (s) { blocked = s.val() || {}; });

      listen(db.ref("messages").orderByKey().startAt(from), "child_added", function (s) { onMessage(s, null); });

      listen(db.ref("users/" + uid + "/groups"), "value", function (s) {
        var ids = Object.keys(s.val() || {});
        listeners = listeners.filter(function (l) { if (l[3] === "group") { try { l[0].off(l[1], l[2]); } catch (e) {} return false; } return true; });
        ids.forEach(function (gid) {
          var ref = db.ref("groupMessages/" + gid).orderByKey().startAt(from);
          var fn = function (ms) {
            db.ref("groups/" + gid + "/name").once("value").then(function (n) { onMessage(ms, n.val() || "a group chat"); });
          };
          ref.on("child_added", fn, function () {});
          var entry = [ref, "child_added", fn, "group"]; listeners.push(entry);
        });
      });

      listen(db.ref("friendRequests/" + uid), "child_added", function (s) {
        var r = s.val(); if (!r || blocked[r.fromUid || s.key]) return;
        if ((r.createdAt || 0) < sinceTs - 5000) return;
        userName(s.key, r.fromUsername).then(function (name) { notify("r:" + s.key + ":" + (r.createdAt || ""), name + " sent you a friend request", r.createdAt); });
      });

      /* Accepted requests: the acceptor adds us to users/<uid>/friends. A new friend we had sent a request to = accepted. */
      var sent = read("sent", {}), known = read("friends", null);
      listen(db.ref("users/" + uid + "/sentRequests"), "value", function (s) {
        var cur = s.val() || {}; Object.keys(cur).forEach(function (k) { sent[k] = 1; }); write("sent", sent);
      });
      listen(db.ref("users/" + uid + "/friends"), "value", function (s) {
        var cur = Object.keys(s.val() || {});
        if (known) {
          cur.filter(function (id) { return known.indexOf(id) < 0 && sent[id]; }).forEach(function (id) {
            delete sent[id]; write("sent", sent);
            userName(id).then(function (name) { notify("f:" + id + ":" + Math.floor(Date.now() / 60000), name + " accepted your friend request"); });
          });
        }
        known = cur; write("friends", cur);
      });
    });
  }

  function stop() { stopAll(); uid = null; items = []; refreshBadge(); }

  function boot() {
    mountBells();
    if (!localStorage.getItem("mesnap_token")) return;
    var scripts = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-database-compat.js"];
    (window.firebase && firebase.apps ? Promise.resolve() : scripts.reduce(function (p, f) { return p.then(function () { return loadScript(SDK + f); }); }, Promise.resolve()))
      .then(function () {
        var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(CONFIG);
        db = firebase.database(app);
        firebase.auth(app).onAuthStateChanged(function (user) {
          stopAll();
          if (user && localStorage.getItem("mesnap_token")) start(user); else stop();
        });
      }).catch(function () {});
    var saveSeen = function () { if (uid) write("lastSeen", Date.now()); };
    document.addEventListener("visibilitychange", function () { if (document.hidden) saveSeen(); });
    window.addEventListener("pagehide", saveSeen);
    setInterval(saveSeen, 30000);
    window.addEventListener("storage", function (e) {   // keep bell in sync / stop after logout in another tab
      if (e.key === "mesnap_token" && !e.newValue) { stopAll(); uid = null; items = []; refreshBadge(); }
      if (uid && e.key === key("items")) { items = read("items", []); refreshBadge(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
