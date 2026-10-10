/**
 * The developer's stats page (GET /admin). It holds no data itself: it asks for the admin token, keeps it in
 * localStorage and loads /admin/stats with it. Player names are put in with textContent, never as HTML.
 * (No backticks or "${" below: this is one template literal.)
 */
export const ADMIN_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Flag Duel stats</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #1b1f24; --muted: #667085; --line: #e3e6ea; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111418; --card: #1a1e24; --text: #e7eaee; --muted: #98a2b3; --line: #2b3139; --accent: #60a5fa; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  h3 { font-size: 13px; margin: 14px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
  input, select, button { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--text); }
  button { cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 5px 10px; text-align: right; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  tr.group td { color: var(--muted); font-size: 12px; font-weight: 600; padding-top: 12px; }
  td.zero { color: var(--muted); }
  details { margin-top: 10px; }
  summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
  .boards th:nth-child(2), .boards td:nth-child(2) { text-align: left; }
  .boards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .muted { color: var(--muted); }
  .err { color: #dc2626; }
</style>
</head>
<body>
<main>
  <h1>Flag Duel stats</h1>
  <form class="bar" id="form">
    <input id="token" type="password" placeholder="Admin token" autocomplete="current-password" size="22">
    <select id="days">
      <option value="7">Last 7 days</option>
      <option value="14">Last 14 days</option>
      <option value="30">Last 30 days</option>
      <option value="60">Last 60 days</option>
    </select>
    <button class="primary" type="submit">Load</button>
    <button type="button" id="forget">Forget token</button>
    <span id="status" class="muted"></span>
  </form>
  <div id="out"></div>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function table(head, rows, rowClass) {
    return el('table', {}, [
      el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))]),
      el('tbody', {}, rows.map(function (r, i) {
        var tr = el('tr', rowClass && rowClass[i] ? { class: rowClass[i] } : {});
        if (rowClass && rowClass[i] === 'group') {
          tr.appendChild(el('td', { text: r[0], colspan: String(r.length) }));
          return tr;
        }
        r.forEach(function (c) {
          var empty = c === '' || c === 0 || c === '0';
          tr.appendChild(el('td', empty ? { class: 'zero', text: c === '' ? '–' : String(c) } : { text: String(c) }));
        });
        return tr;
      })),
    ]);
  }
  var secs = function (ms) { return (ms / 1000).toFixed(1) + 's'; };
  var short = function (date) { return date.slice(5); };
  var KIND = { duel: 'Lobby duels', ranked: 'Ranked', group: 'Group lobbies', quick: 'Find a game', challenge: 'Challenges' };

  function render(stats) {
    var days = stats.days;
    var out = $('out');
    out.textContent = '';
    var head = ['', ].concat(days.map(function (d) { return short(d.date); }));
    var rows = [], cls = [];
    function group(label) { rows.push([label].concat(days.map(function () { return ''; }))); cls.push('group'); }
    function row(label, f) { rows.push([label].concat(days.map(f))); cls.push(''); }

    group('Players');
    row('New accounts', function (d) { return d.newAccounts; });
    row('Played a daily', function (d) { return d.dailyPlayers; });

    var modes = {};
    days.forEach(function (d) { Object.keys(d.daily).forEach(function (m) { modes[m] = 1; }); });
    group('Daily games (finished / started)');
    Object.keys(modes).sort().forEach(function (m) {
      row(m, function (d) { var c = d.daily[m]; return c ? c.finished + ' / ' + c.started : ''; });
    });

    var kinds = {};
    days.forEach(function (d) {
      Object.keys(d.matches).forEach(function (k) {
        kinds[k] = kinds[k] || {};
        Object.keys(d.matches[k]).forEach(function (g) { kinds[k][g] = 1; });
      });
    });
    Object.keys(KIND).concat(Object.keys(kinds)).filter(function (k, i, a) { return kinds[k] && a.indexOf(k) === i; })
      .forEach(function (k) {
        group((KIND[k] || k) + ' (matches · players)');
        Object.keys(kinds[k]).sort().forEach(function (g) {
          row(g, function (d) { var c = (d.matches[k] || {})[g]; return c ? c.matches + ' · ' + c.players : ''; });
        });
      });
    if (!Object.keys(kinds).length) { group('Multiplayer'); row('No matches counted yet', function () { return ''; }); }

    out.appendChild(el('h2', { text: 'Plays per day' }));
    out.appendChild(el('div', { class: 'card' }, [table(head, rows, cls)]));

    out.appendChild(el('h2', { text: 'Daily rankings' }));
    days.forEach(function (d, i) {
      var boards = Object.keys(d.boards).filter(function (b) { return d.boards[b].length; });
      var cards = boards.map(function (b) {
        return el('div', { class: 'card' }, [
          el('h3', { text: b + ' · ' + d.boards[b].length + ' players' }),
          table(['#', 'Name', 'Score', 'Time'], d.boards[b].map(function (e) { return [e.rank, e.name, e.score, secs(e.timeMs)]; })),
        ]);
      });
      if (d.higher && d.higher.entries.length)
        cards.push(el('div', { class: 'card' }, [
          el('h3', { text: 'higher (' + d.higher.stat + ') · ' + d.higher.entries.length + ' players' }),
          table(['#', 'Name', 'Flawless', 'Correct', 'Time'], d.higher.entries.map(function (e) {
            return [e.rank, e.name, e.flawless, e.correct, secs(e.timeMs)];
          })),
        ]));
      var det = el('details', i === 0 ? { open: '' } : {}, [
        el('summary', { text: d.date + (cards.length ? '' : ' · nobody played') }),
        cards.length ? el('div', { class: 'boards' }, cards) : null,
      ]);
      out.appendChild(det);
    });
  }

  async function load() {
    var token = $('token').value.trim();
    if (!token) { $('status').textContent = 'Enter the admin token.'; return; }
    $('status').className = 'muted';
    $('status').textContent = 'Loading…';
    try {
      var res = await fetch('/admin/stats?days=' + $('days').value, { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 404) throw new Error('Wrong token.');
      if (!res.ok) throw new Error('Error ' + res.status);
      var stats = await res.json();
      store.set('adminToken', token);
      store.set('adminDays', $('days').value);
      render(stats);
      $('status').textContent = 'Updated ' + new Date(stats.now).toLocaleTimeString();
    } catch (e) {
      $('status').className = 'err';
      $('status').textContent = e.message;
    }
  }

  $('form').addEventListener('submit', function (e) { e.preventDefault(); load(); });
  $('days').addEventListener('change', load);
  $('forget').addEventListener('click', function () {
    store.del('adminToken');
    $('token').value = '';
    $('out').textContent = '';
    $('status').textContent = 'Token forgotten on this device.';
  });
  $('token').value = store.get('adminToken') || '';
  $('days').value = store.get('adminDays') || '7';
  if ($('token').value) load();
})();
</script>
</body>
</html>
`;
