/* sambawa.dev: live GitHub telemetry + theme toggle.
   No frameworks, no build step. All data client-side with caching + stale fallback. */

(function () {
  'use strict';

  var CONFIG = {
    user: 'samrathbawa',
    repos: ['ForzaFFB', 'macro'],       // curated list: add a name here to add a card
    repoCacheTtl: 30 * 60 * 1000,       // 30 min
    calendarCacheTtl: 60 * 60 * 1000    // 60 min
  };

  var SEP = ' · ';   // ·
  var STAR = '★ ';   // ★

  /* ---------- theme ---------- */

  var toggle = document.getElementById('theme-toggle');
  function applyToggleLabel() {
    var dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  toggle.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
    applyToggleLabel();
  });
  applyToggleLabel();

  document.getElementById('year').textContent = new Date().getFullYear();

  /* ---------- small cache helper ---------- */

  function cacheGet(key, ttl) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      return { data: entry.data, fresh: (Date.now() - entry.t) < ttl };
    } catch (e) { return null; }
  }
  function cacheSet(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: data })); } catch (e) {}
  }

  /* ---------- project cards ---------- */

  var telemetryDot = document.querySelector('.telemetry-dot');
  var telemetryText = document.getElementById('telemetry-text');

  function setTelemetry(state, text) {
    telemetryDot.dataset.state = state;
    telemetryText.textContent = text;
  }

  function relTime(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    var steps = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']];
    for (var i = 0; i < steps.length; i++) {
      if (s >= steps[i][0]) return Math.floor(s / steps[i][0]) + steps[i][1] + ' ago';
    }
    return 'just now';
  }

  function renderRepos(repos) {
    var byName = {};
    repos.forEach(function (r) { byName[r.name.toLowerCase()] = r; });

    document.querySelectorAll('.project-card').forEach(function (card) {
      var repo = byName[card.dataset.repo.toLowerCase()];
      if (!repo) return;
      var desc = card.querySelector('[data-slot="desc"]');
      var meta = card.querySelector('[data-slot="meta"]');
      var updated = card.querySelector('[data-slot="updated"]');

      if (repo.description) { desc.textContent = repo.description; desc.classList.add('swap'); }
      var parts = [];
      if (repo.language) parts.push(repo.language);
      if (repo.stargazers_count > 0) parts.push(STAR + repo.stargazers_count);
      meta.textContent = parts.join(SEP);
      meta.classList.add('swap');
      updated.textContent = 'updated ' + relTime(repo.pushed_at);
      updated.classList.add('swap');
    });
  }

  function loadRepos() {
    var cached = cacheGet('gh-repos-v3', CONFIG.repoCacheTtl);
    if (cached && cached.fresh) {
      renderRepos(cached.data);
      setTelemetry('cached', 'cached' + SEP + 'api.github.com/' + CONFIG.user);
      return;
    }
    fetch('https://api.github.com/users/' + CONFIG.user + '/repos?per_page=100')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (all) {
        var wanted = all.filter(function (r) {
          return CONFIG.repos.some(function (n) { return n.toLowerCase() === r.name.toLowerCase(); });
        });
        cacheSet('gh-repos-v3', wanted);
        renderRepos(wanted);
        setTelemetry('live', 'live' + SEP + 'api.github.com/' + CONFIG.user);
      })
      .catch(function () {
        if (cached) {
          renderRepos(cached.data);
          setTelemetry('cached', 'cached (offline)' + SEP + 'api.github.com/' + CONFIG.user);
        } else {
          setTelemetry('error', 'github api unreachable, links still work');
        }
      });
  }

  /* ---------- contribution calendar ---------- */

  var calendar = document.getElementById('calendar');
  var summary = document.getElementById('activity-summary');

  function renderCalendar(payload) {
    var days = payload.contributions;
    var frag = document.createDocumentFragment();
    // pad so the first column starts on Sunday
    var firstDow = new Date(days[0].date + 'T00:00:00').getDay();
    for (var p = 0; p < firstDow; p++) {
      var pad = document.createElement('i');
      pad.style.visibility = 'hidden';
      frag.appendChild(pad);
    }
    days.forEach(function (d) {
      var cell = document.createElement('i');
      if (d.level > 0) cell.dataset.l = String(d.level);
      cell.title = d.date + SEP + d.count + (d.count === 1 ? ' contribution' : ' contributions');
      frag.appendChild(cell);
    });
    calendar.textContent = '';
    calendar.appendChild(frag);

    var total = payload.total && payload.total.lastYear !== undefined
      ? payload.total.lastYear
      : days.reduce(function (sum, d) { return sum + d.count; }, 0);
    summary.textContent = total + ' contributions in the last year';

    // show the most recent weeks first on narrow screens
    var scroller = calendar.parentElement;
    scroller.scrollLeft = scroller.scrollWidth;
  }

  function loadCalendar() {
    var cached = cacheGet('gh-cal-v3', CONFIG.calendarCacheTtl);
    if (cached && cached.fresh) { renderCalendar(cached.data); return; }
    fetch('https://github-contributions-api.jogruber.de/v4/' + CONFIG.user + '?y=last')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.contributions || !data.contributions.length) throw new Error('empty');
        cacheSet('gh-cal-v3', data);
        renderCalendar(data);
      })
      .catch(function () {
        if (cached) { renderCalendar(cached.data); return; }
        calendar.parentElement.hidden = true;
        summary.innerHTML = 'calendar unavailable, see <a href="https://github.com/' +
          CONFIG.user + '" target="_blank" rel="noopener noreferrer">github.com/' + CONFIG.user + '</a>';
      });
  }

  loadRepos();
  loadCalendar();
})();
