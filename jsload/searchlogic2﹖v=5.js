/* Navbar search v2: results only — nothing shows until at least one
   character is typed. Matches games (ranked fuzzy on title, then tags, then
   categories) and categories (with a game count). Query words are expanded
   through the alias tables that tools/build-search-tags.js appends to
   searchicons.js (window.PZ_SEARCH_ALIASES / _STOPWORDS / _WHOLE_ONLY), so
   "car", "bike", "shooting", "2 player", "io" find games by tag or category.
   Keyboard: up/down, Enter, Esc; "/" focuses the box. */
document.addEventListener('DOMContentLoaded', function () {
  const searchContainer = document.getElementById('navbarSearch');
  if (!searchContainer) return;
  const input = searchContainer.querySelector('input');
  const form = searchContainer.querySelector('form');
  const resultsContainer = document.getElementById('searchResults');
  /* Apps (window.SEARCH_APPS) are searchable but live outside SEARCH_GAMES, which is what the Random
     button picks from, so an app can never be chosen by randomizing. */
  const allGames = (Array.isArray(window.SEARCH_GAMES) ? window.SEARCH_GAMES : [])
    .concat(Array.isArray(window.SEARCH_APPS) ? window.SEARCH_APPS : []);
  const catIcons = window.PZ_CAT_ICONS || {};
  if (!input || !form || !resultsContainer) return;

  const MAX_RESULTS = 6;
  const OPEN = 'open';
  const pagePrefix = /\/(?:g|a)\//.test(location.pathname) ? '../' : '';
  const localPath = path => pagePrefix + String(path || '').replace(/^\/+/, '');

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'pz-clear';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.hidden = true;
  clearBtn.textContent = '✕';
  form.appendChild(clearBtn);

  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const squash = s => norm(s).replace(/ /g, '');
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const indexed = allGames.map(game => ({
    game, nameNorm: norm(game.name), nameSquash: squash(game.name),
    slug: squash((game.url || '').split('/').pop() || ''),
    cats: (game.categories || []).map(norm),
    tags: (game.tags || []).map(norm),
    tagsSquash: (game.tags || []).map(squash)
  }));

  /* alias tables (generated into searchicons.js); keys normalised once */
  const aliases = {};
  Object.keys(window.PZ_SEARCH_ALIASES || {}).forEach(k => {
    const key = norm(k);
    if (!key) return;
    aliases[key] = (aliases[key] || []).concat((window.PZ_SEARCH_ALIASES[k] || []).map(norm));
  });
  const stopwords = new Set((window.PZ_SEARCH_STOPWORDS || []).map(norm));
  const wholeOnly = new Set((window.PZ_SEARCH_WHOLE_ONLY || []).map(norm));
  const aliasMaxWords = Object.keys(aliases).reduce((m, k) => Math.max(m, k.split(' ').length), 1);

  /* "2 player racing games" -> [{text:"2 player", expand:["2 player"]}, {text:"racing", expand:["racing"]}]
     Stopwords are dropped unless that would leave nothing. Multi-word alias
     keys are consumed as one token so "2" never matches titles on its own.
     Whole-query-only aliases (vs, versus) expand nothing mid-query. */
  function tokenize(rawQuery) {
    const qNorm = norm(rawQuery);
    let words = qNorm.split(' ').filter(Boolean);
    const kept = words.filter(w => !stopwords.has(w));
    if (kept.length) words = kept;
    const tokens = [];
    let i = 0;
    while (i < words.length) {
      let matched = false;
      for (let len = Math.min(aliasMaxWords, words.length - i); len >= 2; len--) {
        const phrase = words.slice(i, i + len).join(' ');
        if (aliases[phrase]) { tokens.push({ text: phrase, expand: aliases[phrase] }); i += len; matched = true; break; }
      }
      if (matched) continue;
      const w = words[i++];
      let expand = aliases[w] || [];
      if (wholeOnly.has(w) && words.length > 1) expand = [];
      tokens.push({ text: w, expand });
    }
    return { qNorm: words.join(' '), tokens };
  }

  /* categories with counts, derived from the game list itself */
  const catSlug = name => {
    const n = String(name).toLowerCase();
    if (n.startsWith('2 player')) return '2player';
    if (n.startsWith('clicker')) return 'clicker';
    return n.replace(/[^a-z0-9]/g, '');
  };
  const catMap = new Map();
  allGames.forEach(g => (g.categories || []).forEach(c => {
    const key = catSlug(c);
    const cur = catMap.get(key) || { name: c, slug: key, count: 0, norm: norm(c) };
    cur.count++; catMap.set(key, cur);
  }));
  const categories = [...catMap.values()];

  function minSubsequenceWindow(q, s) {
    let best = Infinity;
    for (let start = 0; start <= s.length - q.length; start++) {
      if (s[start] !== q[0]) continue;
      let i = 0, j = start;
      for (; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
      if (i === q.length) best = Math.min(best, j - start);
    }
    return best;
  }
  function scoreEntry(entry, qNorm, qSquash) {
    if (entry.nameNorm === qNorm) return 100;
    if (entry.nameNorm.startsWith(qNorm)) return 90;
    const words = entry.nameNorm.split(' ');
    for (let i = 0; i < words.length; i++) if (words[i].startsWith(qNorm)) return 82 - Math.min(i, 5);
    /* substring checks need 3+ chars: "io" must not hit "dimensIOns" */
    if (qSquash.length >= 3 && entry.nameNorm.includes(qNorm)) return 70;
    if (qSquash.length >= 3 && entry.nameSquash.includes(qSquash)) return 62;
    if (qSquash.length >= 3 && entry.slug.includes(qSquash)) return 55;
    for (const cat of entry.cats) {
      if (cat.startsWith(qNorm)) return 45;
      if (qNorm.length >= 4 && cat.includes(qNorm)) return 40;
    }
    if (qSquash.length >= 4) {
      const w = minSubsequenceWindow(qSquash, entry.nameSquash);
      if (qSquash.length / w >= 0.5) return 25;
    }
    return -1;
  }
  /* Tags sit below every direct title match (>= 62) and above categories. */
  function tagScore(entry, tNorm, tSquash) {
    let best = -1;
    for (let i = 0; i < entry.tags.length; i++) {
      const t = entry.tags[i];
      if (t === tNorm) return 58;
      if (tNorm.length >= 3 && t.split(' ').some(w => w.startsWith(tNorm))) best = Math.max(best, 50);
      else if (tSquash.length >= 4 && entry.tagsSquash[i].includes(tSquash)) best = Math.max(best, 46);
    }
    return best;
  }
  function catScore(entry, tNorm) {
    for (const cat of entry.cats) {
      if (cat === tNorm) return 45;
      if (cat.startsWith(tNorm)) return 44;
      if (tNorm.length >= 4 && cat.includes(tNorm)) return 40;
    }
    return -1;
  }
  /* One token against one game: title (existing scoring) > own tags > alias
     expansions (a notch below a direct hit) > categories. */
  function scoreToken(entry, token) {
    const tNorm = token.text, tSquash = squash(tNorm);
    let s = Math.max(scoreEntry(entry, tNorm, tSquash), tagScore(entry, tNorm, tSquash));
    for (const e of token.expand) {
      s = Math.max(s, tagScore(entry, e, squash(e)) - 6, catScore(entry, e) - 2);
    }
    return s;
  }
  function matchCategories(qNorm) {
    if (!qNorm) return [];
    return categories.filter(c => c.norm.startsWith(qNorm) || c.norm.split(' ').some(w => w.startsWith(qNorm)) || (qNorm.length >= 3 && c.norm.includes(qNorm)));
  }
  /* Category chips: direct name matches plus any category an alias points at,
     so "car" offers Racing and "shooting" offers Shooter. */
  function matchCategoriesForQuery(rawQuery) {
    const { qNorm, tokens } = tokenize(rawQuery);
    const out = matchCategories(qNorm);
    const exp = new Set(tokens.reduce((a, t) => a.concat(t.expand), []));
    categories.forEach(c => {
      if (out.includes(c)) return;
      if (exp.has(c.norm) || exp.has(c.norm.split(' ')[0])) out.push(c);
    });
    return out;
  }

  function searchAllHtml(rawQuery, total) {
    return '<a href="' + localPath('search.html') + '?q=' + encodeURIComponent(rawQuery) + '" class="pz-opt pz-opt-all">' +
      '<span class="pz-opt-all-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></span>' +
      '<span class="pz-opt-all-text">Search all games for &ldquo;<b>' + escapeHtml(rawQuery) + '</b>&rdquo;</span>' +
      (total > MAX_RESULTS ? '<span class="pz-opt-all-count">' + total + ' results</span>' : '') +
      '<span class="pz-opt-all-arrow" aria-hidden="true">&rarr;</span></a>';
  }
  /* Games are ranked by how many query tokens they hit, then by score. A
     whole-query title or tag match (e.g. "moto x3m 2") counts as a full hit. */
  function rankGames(rawQuery) {
    const { qNorm, tokens } = tokenize(rawQuery);
    const qSquash = squash(qNorm);
    if (!qSquash || !tokens.length) return [];
    const multi = tokens.length > 1;
    return indexed
      .map(entry => {
        /* single-character tokens ("2" in "moto x3m 2") only count alongside
           a real hit, so every title with a 2 in it does not join the list */
        let hits = 0, total = 0, weakHits = 0, weakTotal = 0;
        for (const t of tokens) {
          const s = scoreToken(entry, t);
          if (s < 0) continue;
          if (t.text.length <= 1) { weakHits++; weakTotal += s; } else { hits++; total += s; }
        }
        const strongTokens = tokens.some(t => t.text.length > 1);
        if (hits || !strongTokens) { hits += weakHits; total += weakTotal; }
        if (multi) {
          const whole = Math.max(scoreEntry(entry, qNorm, qSquash), tagScore(entry, qNorm, qSquash));
          if (whole >= 0) { hits = tokens.length; total = Math.max(total, whole * tokens.length + 1); }
        }
        return { entry, hits, total };
      })
      .filter(m => m.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.total - a.total || a.entry.nameNorm.length - b.entry.nameNorm.length || a.entry.nameNorm.localeCompare(b.entry.nameNorm))
      .map(m => m.entry.game);
  }
  window.pzRankGames = rankGames;
  window.pzMatchCategories = q => matchCategoriesForQuery(q);
  window.pzTokenize = tokenize;

  function highlightName(name, rawQuery) {
    const q = rawQuery.trim();
    const idx = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (idx === -1) return escapeHtml(name);
    return escapeHtml(name.slice(0, idx)) + '<mark>' + escapeHtml(name.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(name.slice(idx + q.length));
  }
  const catLabel = g => (Array.isArray(g.categories) && g.categories.length) ? g.categories.join(' / ') : (g.app ? 'App' : 'Game');
  function gameHtml(game, rawQuery) {
    return '<a href="' + escapeHtml(localPath(game.url.replace(/^\/+/, "").replace(/\.html$/, "") + ".html")) + '" class="pz-opt pz-opt-game">' +
      '<img src="' + escapeHtml(localPath(game.image)) + '" alt="" class="pz-opt-thumb" loading="lazy">' +
      '<div class="pz-opt-text"><div class="pz-opt-title">' + highlightName(game.name, rawQuery) + '</div>' +
      '<div class="pz-opt-desc">' + escapeHtml(catLabel(game)) + '</div></div></a>';
  }
  function catHtml(cat, rawQuery) {
    const icon = catIcons[cat.slug] || '';
    return '<a href="' + localPath('g/' + cat.slug + '.html') + '" class="pz-opt pz-opt-cat">' +
      '<span class="pz-opt-caticon" aria-hidden="true">' + icon + '</span>' +
      '<div class="pz-opt-text"><div class="pz-opt-title">' + highlightName(cat.name, rawQuery) + '</div>' +
      '<div class="pz-opt-desc">Category</div></div>' +
      '<span class="pz-opt-count">' + cat.count + ' games</span></a>';
  }

  let activeIndex = -1;
  const getOptions = () => resultsContainer.querySelectorAll('a.pz-opt');
  function setActive(next) {
    const options = getOptions();
    if (!options.length) return;
    activeIndex = (next + options.length) % options.length;
    options.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
    options[activeIndex].scrollIntoView({ block: 'nearest' });
  }
  function open() { searchContainer.classList.add(OPEN); }
  function close() { searchContainer.classList.remove(OPEN); activeIndex = -1; }
  function setResultsHtml(html) { activeIndex = -1; resultsContainer.innerHTML = html; resultsContainer.scrollTop = 0; }

  function handleSearchInput() {
    const rawQuery = input.value.trim();
    const qNorm = norm(rawQuery), qSquash = squash(rawQuery);
    if (!qSquash) { setResultsHtml(''); close(); return; }
    const cats = matchCategoriesForQuery(rawQuery);
    const games = rankGames(rawQuery);
    let html = cats.map(c => catHtml(c, rawQuery)).join('') + games.slice(0, MAX_RESULTS).map(g => gameHtml(g, rawQuery)).join('');
    if (!html) html = '<div class="pz-opt-empty">No games found for &ldquo;<b>' + escapeHtml(rawQuery) + '</b>&rdquo;.</div>';
    html += searchAllHtml(rawQuery, games.length);
    setResultsHtml(html);
    open();
  }
  const syncClearButton = () => { clearBtn.hidden = !input.value; };

  form.addEventListener('submit', e => e.preventDefault());
  input.addEventListener('input', () => { syncClearButton(); handleSearchInput(); });
  input.addEventListener('focus', () => { if (input.value.trim()) handleSearchInput(); });
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const options = getOptions();
      const target = options[activeIndex >= 0 ? activeIndex : 0];
      if (target) window.location.href = target.getAttribute('href');
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; syncClearButton(); handleSearchInput(); input.focus(); });
  document.addEventListener('click', e => { if (!searchContainer.contains(e.target)) close(); });
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); input.focus();
  });
  syncClearButton();
  window.pzSearchDemo = q => { input.value = q; syncClearButton(); input.focus(); handleSearchInput(); };
});
