// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// three views from the URL hash: the ranked board (with search, filters and sorting), one
// protocol's detail (its figures, the model's working and its farm plan), the live-token set the
// radar sets aside, and the method page that states the model. No network: every byte is data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUSD(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtPct(n) {
    if (n == null) return '<span class="flat">n/a</span>';
    var cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function barPct(n) {
    if (n == null) return '';
    var w = Math.min(100, Math.abs(n) * 2.2);
    var cls = n >= 0 ? 'up' : 'down';
    return '<span class="bar"><i class="' + cls + '" style="width:' + w.toFixed(0) + '%"></i></span>';
  }
  function fmtAge(days) {
    if (days == null) return 'unknown';
    if (days < 365) return days + 'd';
    var y = Math.floor(days / 365);
    var rest = days - y * 365;
    return y + 'y ' + rest + 'd';
  }
  function fmtMult(x) {
    return x == null ? '—' : '×' + x.toFixed(2);
  }
  function ringsSVG() {
    return '<svg class="rings" viewBox="0 0 40 40" fill="none" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="17" stroke="#1e2c38" stroke-width="2"/>' +
      '<circle cx="20" cy="20" r="11" stroke="#2fe8a7" stroke-width="2" opacity="0.55"/>' +
      '<circle cx="20" cy="20" r="5" stroke="#2fe8a7" stroke-width="2"/>' +
      '<circle cx="27" cy="13" r="2.4" fill="#ffb454"/></svg>';
  }
  function masthead(active) {
    var tabs = [['board', 'The board', '#/'], ['live', 'Live tokens', '#/live'], ['method', 'Method', '#/method']];
    var tabHtml = tabs.map(function (t) {
      return '<a href="' + t[2] + '"' + (active === t[0] ? ' class="on"' : '') + '>' + t[1] + '</a>';
    }).join('');
    return '<header class="masthead"><div class="wordmark">' + ringsSVG() +
      '<div><h1>TOKEN <span class="thin">RADAR</span></h1>' +
      '<p class="tagline">Protocols that record no token yet, ranked by what a token would be worth if the record stayed as it is — and how to farm each one before it issues.</p></div></div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="v">' + DATA.board_size + '</div><div class="k">pre-token ranked</div></div>' +
      '<div class="stat"><div class="v">' + DATA.watchlist_size + '/' + DATA.watchlist_size + '</div><div class="k">watchlist covered</div></div>' +
      '<div class="stat"><div class="v">' + DATA.early_size + '</div><div class="k">early finds</div></div>' +
      '<div class="stat"><div class="v">' + esc(DATA.as_of) + '</div><div class="k">snapshot date</div></div>' +
      '</div></header><nav class="tabs">' + tabHtml + '</nav>';
  }
  function foot() {
    return '<p class="foot">Built from one sealed snapshot of DefiLlama\'s protocol list (' + esc(DATA.source) + '). ' +
      'A protocol here <i>records</i> no token in that snapshot; that is not proof it has none. An implied value is this board\'s own model claim — ' +
      'what a token might be worth if the protocol\'s record stayed as it is — not a prediction that a token will be issued, or when. Model: ' + esc(DATA.model_version) + '.</p>';
  }

  // ---------------------------------------------------------------- board
  function parseHash() {
    var h = window.location.hash.replace(/^#/, '');
    var q = {};
    var path = h;
    var qi = h.indexOf('?');
    if (qi >= 0) {
      path = h.slice(0, qi);
      h.slice(qi + 1).split('&').forEach(function (pair) {
        var kv = pair.split('=');
        if (kv.length === 2) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
      });
    }
    return { path: path, q: q };
  }
  function boardHash(st) {
    var parts = [];
    if (st.q) parts.push('q=' + encodeURIComponent(st.q));
    if (st.cat) parts.push('cat=' + encodeURIComponent(st.cat));
    if (st.chain) parts.push('chain=' + encodeURIComponent(st.chain));
    if (st.watch !== 'all') parts.push('watch=' + st.watch);
    if (st.sort !== 'rank') parts.push('sort=' + st.sort + '&dir=' + st.dir);
    return '#/' + (parts.length ? '?' + parts.join('&') : '');
  }
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
    change: function (a, b) { return (a.change_7d == null ? -1e9 : a.change_7d) - (b.change_7d == null ? -1e9 : b.change_7d); },
    age: function (a, b) { return (a.age_days == null ? -1 : a.age_days) - (b.age_days == null ? -1 : b.age_days); },
    mult: function (a, b) { return a.model.peer_multiple - b.model.peer_multiple; },
    implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
  };
  function renderBoard(q) {
    var st = {
      q: q.q || '', cat: q.cat || '', chain: q.chain || '',
      watch: q.watch || 'all', sort: SORTS[q.sort] ? q.sort : 'rank', dir: q.dir === '-1' ? -1 : 1
    };
    var rows = DATA.rows.filter(function (r) {
      if (st.watch === 'watch' && !r.watchlist) return false;
      if (st.watch === 'early' && r.watchlist) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    });
    var cmp = SORTS[st.sort];
    rows = rows.slice().sort(function (a, b) { return cmp(a, b) * st.dir; });

    var catOpts = '<option value="">All categories</option>' + categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (st.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="">All chains</option>' + chains().map(function (c) {
      return '<option value="' + esc(c) + '"' + (st.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    function segBtn(v, label) {
      return '<button data-watch="' + v + '"' + (st.watch === v ? ' class="on"' : '') + '>' + label + '</button>';
    }
    function th(key, label, cls) {
      var arrow = st.sort === key ? (st.dir === 1 ? ' ↑' : ' ↓') : '';
      return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
    }
    var body = rows.map(function (r) {
      var badge = r.watchlist ? '<span class="badge watch">watchlist</span>' : '<span class="badge early">early find</span>';
      return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td class="l proto"><div class="name">' + esc(r.name) + badge + '</div><div class="sub">' + esc(r.category || 'Uncategorised') + '</div></td>' +
        '<td class="mut hide-s">' + r.chains.length + '</td>' +
        '<td class="tvl">' + fmtUSD(r.tvl_usd) + '</td>' +
        '<td>' + barPct(r.change_7d) + fmtPct(r.change_7d) + '</td>' +
        '<td class="mut hide-s">' + fmtAge(r.age_days) + '</td>' +
        '<td class="mut hide-s">' + fmtMult(r.model.peer_multiple) + '</td>' +
        '<td class="implied">' + fmtUSD(r.implied_value_usd) + '</td></tr>';
    }).join('');
    main.innerHTML = masthead('board') +
      '<div class="controls">' +
      '<input type="search" id="f-q" placeholder="Search protocols…" value="' + esc(st.q) + '">' +
      '<select id="f-cat">' + catOpts + '</select>' +
      '<select id="f-chain">' + chainOpts + '</select>' +
      '<span class="seg">' + segBtn('all', 'All') + segBtn('watch', 'Watchlist') + segBtn('early', 'Early finds') + '</span>' +
      '<span class="count">' + rows.length + ' of ' + DATA.board_size + ' protocols</span></div>' +
      (rows.length
        ? '<table class="board"><thead><tr>' + th('rank', '#', 'l') + th('name', 'Protocol', 'l') +
          '<th class="hide-s">Chains</th>' + th('tvl', 'TVL') + th('change', '7d change') +
          th('age', 'Age', 'hide-s') + th('mult', 'Peer ×', 'hide-s') + th('implied', 'Implied value') +
          '</tr></thead><tbody>' + body + '</tbody></table>'
        : '<div class="empty">No protocol matches that filter. Loosen it — the radar sees ' + DATA.board_size + ' pre-token protocols.</div>') +
      foot();
    main.setAttribute('aria-busy', 'false');
    wireBoard(st);
  }
  function wireBoard(st) {
    function go(patch) {
      var next = Object.assign({}, st, patch);
      window.location.hash = boardHash(next);
    }
    var q = document.getElementById('f-q');
    var timer = null;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { go({ q: q.value }); }, 220);
    });
    document.getElementById('f-cat').addEventListener('change', function (e) { go({ cat: e.target.value }); });
    document.getElementById('f-chain').addEventListener('change', function (e) { go({ chain: e.target.value }); });
    Array.prototype.forEach.call(main.querySelectorAll('[data-watch]'), function (b) {
      b.addEventListener('click', function () { go({ watch: b.getAttribute('data-watch') }); });
    });
    Array.prototype.forEach.call(main.querySelectorAll('th.sortable'), function (t) {
      t.addEventListener('click', function () {
        var key = t.getAttribute('data-sort');
        go({ sort: key, dir: st.sort === key ? String(-st.dir) : (key === 'name' ? '1' : '-1') });
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        window.location.hash = '#/protocol/' + tr.getAttribute('data-slug');
      });
    });
  }

  // ---------------------------------------------------------------- detail
  function renderDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { renderBoard({}); return; }
    var m = r.model;
    var factors = [
      ['TVL (the snapshot\'s figure)', fmtUSD(r.tvl_usd)],
      ['Peer multiple — ' + esc(r.category || 'Uncategorised') + ', ' + m.peer_count + (m.peer_count === 1 ? ' tokenised peer' : ' tokenised peers'), fmtMult(m.peer_multiple)],
      ['= Base value', fmtUSD(Math.round(r.tvl_usd * m.peer_multiple))],
      ['Momentum × (7d TVL change ' + (r.change_7d == null ? 'unreported' : r.change_7d.toFixed(1) + '%') + ')', '×' + m.momentum_multiplier.toFixed(2)],
      ['Maturity × (tracked ' + fmtAge(m.age_days) + ' with no token)', '×' + m.maturity_multiplier.toFixed(2)],
      ['Breadth × (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')', '×' + m.breadth_multiplier.toFixed(2)],
      ['Implied value', fmtUSD(r.implied_value_usd)]
    ];
    var plan = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var chips = r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
    main.innerHTML = masthead('board') +
      '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="cat">' + esc(r.category || 'Uncategorised') + ' · rank #' + r.rank + ' of ' + DATA.board_size + '</span>' +
      (r.watchlist ? '<span class="badge watch">watchlist</span>' : '<span class="badge early">early find — below the watchlist floor</span>') +
      '<div class="big-implied"><div class="v">' + fmtUSD(r.implied_value_usd) + '</div><div class="k">implied value</div></div></div>' +
      '<div class="cards">' +
      '<div class="card"><div class="v">' + fmtUSD(r.tvl_usd) + '</div><div class="k">TVL</div></div>' +
      '<div class="card"><div class="v">' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div><div class="k">TVL change, 7d</div></div>' +
      '<div class="card"><div class="v">' + fmtAge(r.age_days) + '</div><div class="k">tracked, no token</div></div>' +
      '<div class="card"><div class="v">' + (r.listed_at || 'unknown') + '</div><div class="k">tracked since</div></div>' +
      '<div class="card"><div class="v">none recorded</div><div class="k">token in snapshot</div></div>' +
      '</div>' +
      '<section class="panel"><h3>How the model prices ' + esc(r.name) + '</h3>' +
      '<table class="factors">' + factors.map(function (f) { return '<tr><td>' + f[0] + '</td><td class="r">' + f[1] + '</td></tr>'; }).join('') + '</table>' +
      '<p class="mut" style="font-size:13px;margin:10px 0 0">The multiple is the median market-cap/TVL of the category\'s tokenised protocols, shrunk toward the global median (' + fmtMult(DATA.global_median_multiple) + ') by the peer count. No protocol is priced by name.</p></section>' +
      '<section class="panel"><h3>Farm plan</h3><ol class="plan">' + plan + '</ol></section>' +
      '<section class="panel"><h3>Chains</h3><div class="chips">' + chips + '</div></section>' +
      foot();
    main.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- live
  function renderLive() {
    var body = DATA.live.map(function (r, i) {
      return '<tr><td class="rank">' + (i + 1) + '</td>' +
        '<td class="l proto"><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.category || 'Uncategorised') + '</div></td>' +
        '<td class="tvl">' + fmtUSD(r.tvl_usd) + '</td>' +
        '<td class="tvl">' + fmtUSD(r.mcap_usd) + '</td>' +
        '<td class="mut">' + fmtMult(r.multiple) + '</td>' +
        '<td>' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    main.innerHTML = masthead('live') +
      '<div class="empty" style="text-align:left;border-top:none">' +
      '<b style="color:var(--text)">These protocols already have a token.</b> <span class="mut">The radar sets them aside — but they are its yardstick: ' +
      'each category\'s peer multiple is the median market-cap/TVL of its tokenised protocols, shrunk toward the global median of ' + fmtMult(DATA.global_median_multiple) + '. ' +
      'The largest ' + DATA.live_size + ' by market cap are shown.</span></div>' +
      '<table class="board"><thead><tr><th class="l">#</th><th class="l">Protocol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th><th>7d change</th></tr></thead><tbody>' + body + '</tbody></table>' +
      foot();
    main.setAttribute('aria-busy', 'false');
  }

  // ---------------------------------------------------------------- method
  function renderMethod() {
    var peerRows = DATA.peers.map(function (p) {
      return '<tr><td class="l">' + esc(p.category) + '</td><td>' + p.peers + '</td><td>' + (p.median_multiple == null ? '—' : fmtMult(p.median_multiple)) + '</td><td>' + fmtMult(p.used_multiple) + '</td></tr>';
    }).join('');
    main.innerHTML = masthead('method') +
      '<div class="method"><div class="panel"><h3>The model — ' + esc(DATA.model_version) + '</h3>' +
      '<p>The board ranks <b>every pre-token protocol in the snapshot</b> — one whose record carries no market cap, no CoinGecko id and no symbol — except exchanges and versioned pools of another protocol. ' +
      'All ' + DATA.watchlist_size + ' watchlist protocols are on it; the watchlist is a floor, and the other ' + DATA.early_size + ' rows are early finds below it. Each row\'s implied value is priced off the snapshot\'s own comparables:</p>' +
      '<div class="formula">implied = TVL × peer multiple × momentum × maturity × breadth</div>' +
      '<p><b>Peer multiple.</b> For the protocol\'s category, the median market-cap/TVL of its tokenised protocols, shrunk toward the global median (' + fmtMult(DATA.global_median_multiple) + ') with weight n/(n+4), so a category with two peers leans on the market and one with forty stands on its own. Clamped to ×0.03–×2.50. A category with no tokenised peer prices at the global median.</p>' +
      '<p><b>Momentum.</b> 1 + 0.6 × the seven-day TVL change, clamped between −50% and +100%: growth supports a richer launch price, but one hot week never doubles a valuation.</p>' +
      '<p><b>Maturity.</b> 0.75 + 0.25 × ln(1 + age)/ln(1 + 1825 days): a protocol tracked for years with no token has a record a launch can be priced on; a new one is discounted, on a curve that flattens. An unreported start date prices at the ranked set\'s median age.</p>' +
      '<p><b>Breadth.</b> 1 + 2% per extra chain, up to ten: distribution across chains is worth something at launch, and not much.</p>' +
      '<p><b>Farm plans</b> are generated per protocol from its category, its main chain\'s gas costs, a capital size scaled to its TVL, and a hold window scaled to its age. Every step states its cost and its time. No protocol name is special-cased anywhere in the model or the plans.</p>' +
      '</div>' +
      '<div class="panel"><h3>Peer multiples by category</h3>' +
      '<table class="peers"><thead><tr><th class="l">Category</th><th>Tokenised peers</th><th>Median mcap/TVL</th><th>Multiple used</th></tr></thead><tbody>' + peerRows + '</tbody></table></div></div>' +
      foot();
    main.setAttribute('aria-busy', 'false');
  }

  // ---------------------------------------------------------------- router
  function render() {
    var parsed = parseHash();
    var path = parsed.path || '/';
    if (path.indexOf('/protocol/') === 0) renderDetail(decodeURIComponent(path.slice('/protocol/'.length)));
    else if (path === '/live') renderLive();
    else if (path === '/method') renderMethod();
    else renderBoard(parsed.q);
  }
  window.addEventListener('hashchange', render);
  render();
})();
