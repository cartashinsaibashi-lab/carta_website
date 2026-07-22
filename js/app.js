/* =========================================================
 * CARTA POKER SERIES - モック UI 制御
 *  - 大会種別タブ (ウルフ / 宴 / その他)
 *  - 開催状況フィルタ (すべて / 進行中 / 開催予定 / 終了)
 *  - カード → アコーディオン展開
 *  - アコーディオン内タブ (大会情報 / ストラクチャー / +状態別タブ)
 *  - 進行中イベントのレベル残り時間カウントダウン(演出用)
 * ========================================================= */
(function () {
  'use strict';

  var state = {
    category: 'wolf',
    status: 'all',
    scope: 'all',                       // 'all' = 全日程 | 'month' = 月単位 | 'day' = 日単位
    dispYear: CALENDAR.today.year,      // 日付バーに表示中の年
    dispMonth: CALENDAR.today.month,    // 日付バーに表示中の月
    date: null,                         // scope が 'day' のときの日付
    pickerOpen: false,                  // 年月ピッカーの開閉
    pickerYear: CALENDAR.today.year,    // ピッカー内で選択中の年
    favOnly: false,                     // お気に入りのみ表示
    openedId: null
  };

  /* ---------- お気に入り / 申込状態(モックでは localStorage に保存) ----------
   * 本番では POST /v1/device/favorites(お気に入り)と
   * PUT /v1/player/ticket type=eventReservation(申込)を使用する。 */

  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }

  function storeToggle(key, id) {
    var list = storeGet(key);
    var i = list.indexOf(id);
    if (i === -1) list.push(id); else list.splice(i, 1);
    localStorage.setItem(key, JSON.stringify(list));
  }

  function storeAdd(key, id) {
    var list = storeGet(key);
    if (list.indexOf(id) === -1) list.push(id);
    localStorage.setItem(key, JSON.stringify(list));
  }

  var FAV_KEY = 'carta_favorites';
  var APPLIED_KEY = 'carta_applied';
  var LOGIN_KEY = 'carta_logged_in';

  function isFav(id) { return storeGet(FAV_KEY).indexOf(id) !== -1; }
  function isApplied(id) { return storeGet(APPLIED_KEY).indexOf(id) !== -1; }

  function findEvent(id) {
    for (var i = 0; i < MOCK_EVENTS.length; i++) {
      if (MOCK_EVENTS[i].id === id) return MOCK_EVENTS[i];
    }
    return null;
  }

  var listEl = document.getElementById('eventList');
  var emptyEl = document.getElementById('emptyMessage');
  var timers = [];

  /* 種別ごとのテーマ(モバイルブラウザのアドレスバー色も追従) */
  var THEME_COLORS = { wolf: '#141138', utage: '#f2eee3', other: '#2a0f14' };

  function applyTheme(category) {
    document.body.dataset.theme = category;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLORS[category];
  }

  /* ---------- ユーティリティ ---------- */

  function yen(n) {
    return '¥' + Number(n).toLocaleString('ja-JP');
  }

  function num(n) {
    return Number(n).toLocaleString('ja-JP');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtSec(total) {
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- タブ定義 ---------- */

  function tabsFor(ev) {
    var tabs = [];
    if (ev.status === 'running') tabs.push({ key: 'live', label: 'Live' });
    if (ev.status === 'past') tabs.push({ key: 'results', label: 'Results' });
    tabs.push({ key: 'info', label: 'Info' });
    tabs.push({ key: 'prize', label: 'Prize' });
    tabs.push({ key: 'structure', label: 'Structure' });
    return tabs;
  }

  /* ---------- 各パネルの HTML ---------- */

  function infoPanel(ev) {
    var rows = [
      ['Date & Time', ev.dateLabel + ' Start'],
      ['Venue', ev.venue],
      ['Buy-in', yen(ev.buyin) + ' + ' + yen(ev.fee) + ' (total ' + yen(ev.buyin + ev.fee) + ')'],
      ['Guarantee', ev.guarantee ? yen(ev.guarantee) : 'None'],
      ['Starting Stack', num(ev.startingStack) + ' chips'],
      ['Level Length', ev.levelMinutes + ' min'],
      ['Late Reg', ev.lateReg],
      ['Re-entry', ev.reentry],
      ['Game', ev.gameType]
    ];
    var dl = rows.map(function (r) {
      return '<div class="info-row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('');
    /* 大会詳細(本番では GET /v1/event/{id} の dailyDetails.description から取得) */
    var detailsHtml = '';
    if (ev.details && ev.details.length) {
      detailsHtml =
        '<h3 class="detail-notes-title">Details</h3>' +
        '<ul class="detail-notes">' +
        ev.details.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
        '</ul>';
    }
    return (
      '<p class="event-description">' + esc(ev.description) + '</p>' +
      '<dl class="info-grid">' + dl + '</dl>' +
      detailsHtml
    );
  }

  function structurePanel(ev) {
    /* レイトレジ終了は Lv 列に inline で入れず全幅の注記行にすることで、
     * 4 列テーブルが横スワイプ無しでも画面幅に収まるようにする。 */
    var body = ev.structure.map(function (row) {
      if (row.type === 'break') {
        return '<tr class="row-break"><td colspan="4">— Break ' + row.minutes + ' min —</td></tr>';
      }
      var cls = row.lateRegClose ? ' class="row-latereg"' : '';
      var levelRow = (
        '<tr' + cls + '>' +
        '<td>' + row.level + '</td>' +
        '<td>' + num(row.sb) + ' / ' + num(row.bb) + '</td>' +
        '<td>' + num(row.ante) + '</td>' +
        '<td>' + row.minutes + 'm</td>' +
        '</tr>'
      );
      if (row.lateRegClose) {
        levelRow += '<tr class="row-latereg-note"><td colspan="4">' +
          '<span class="latereg-tag">Late Reg Close</span></td></tr>';
      }
      return levelRow;
    }).join('');
    return (
      '<div class="structure-meta">Starting Stack ' + num(ev.startingStack) + ' / BB Ante format</div>' +
      '<div class="table-scroll"><table class="data-table structure-table">' +
      '<thead><tr><th>Lv</th><th>Blinds (SB/BB)</th><th>Ante</th><th>Time</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  }

  function resultsPanel(ev) {
    var hasBounty = ev.results.some(function (r) { return r.bounty > 0; });
    var body = ev.results.map(function (r) {
      var posCls = r.pos === 1 ? ' class="row-winner"' : '';
      var medalCls = r.pos <= 3 ? ' pos-' + r.pos : '';
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + r.pos + '</span></td>' +
        '<td class="col-player">' + esc(r.player) + ' <span class="player-country">' + esc(r.country) + '</span></td>' +
        '<td class="col-prize">' + yen(r.prize) + '</td>' +
        (hasBounty ? '<td class="col-prize">' + (r.bounty ? yen(r.bounty) : '—') + '</td>' : '') +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="result-summary">' +
      summaryItem('Total Entries', num(ev.stats.entries)) +
      summaryItem('Prize Pool', yen(ev.stats.prizePool)) +
      summaryItem('In the Money', ev.stats.itm + ' players') +
      '</div>' +
      '<div class="table-scroll"><table class="data-table results-table">' +
      '<thead><tr><th>Rank</th><th>Player</th><th>Prize</th>' + (hasBounty ? '<th>Bounty</th>' : '') + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  }

  function summaryItem(label, value) {
    return (
      '<div class="summary-item">' +
      '<span class="summary-label">' + esc(label) + '</span>' +
      '<span class="summary-value">' + value + '</span>' +
      '</div>'
    );
  }

  function livePanel(ev) {
    var lv = ev.live;
    return (
      '<div class="live-board">' +
      '  <div class="live-clock">' +
      '    <div class="live-level">LEVEL ' + lv.levelIndex + '</div>' +
      '    <div class="live-blinds">' + num(lv.sb) + ' / ' + num(lv.bb) +
      '      <span class="live-ante">ante ' + num(lv.ante) + '</span></div>' +
      '    <div class="live-timer" data-timer data-remaining="' + lv.remainingSec + '">' + fmtSec(lv.remainingSec) + '</div>' +
      '    <div class="live-next">NEXT: ' + esc(lv.nextLevel) + '<br>Next break ' + esc(lv.nextBreak) + '</div>' +
      '  </div>' +
      '  <div class="live-stats">' +
      liveStat('Entries', num(ev.stats.entries)) +
      liveStat('Remaining Players', num(ev.stats.players)) +
      liveStat('Table', num(lv.tables)) +
      liveStat('Average Chips', num(ev.stats.avgStack) + ' chips') +
      liveStat('Total Chips', num(ev.stats.totalChips)) +
      liveStat('Prize Pool', yen(ev.stats.prizePool)) +
      '  </div>' +
      '</div>' +
      '<p class="live-note"><span class="dot dot-live"></span>In production, live status is fetched from the PokerLens API at regular intervals and updates automatically.</p>'
    );
  }

  function liveStat(label, value) {
    return (
      '<div class="live-stat">' +
      '<span class="live-stat-label">' + esc(label) + '</span>' +
      '<span class="live-stat-value">' + value + '</span>' +
      '</div>'
    );
  }

  /* 賞金分配(Prize)パネル — 開催中・受付中・終了の全大会に共通で表示。
   * 本番では GET /v1/event/{id}/payouts から確定した支払い構造を取得する。 */
  function prizePanel(ev) {
    var pool = ev.stats.prizePool || ev.guarantee || 0;   // 受付中は保証賞金を基準に表示
    var poolKnown = pool > 0;

    /* 上位入賞の分配率(モック用の標準配分モデル) */
    var payouts = [
      [1, 0.240], [2, 0.150], [3, 0.105], [4, 0.078], [5, 0.060],
      [6, 0.046], [7, 0.036], [8, 0.028], [9, 0.022]
    ];
    var restPct = 0.235;   // 10 位以降の合計

    function pctLabel(v) { return (v * 100).toFixed(1).replace(/\.0$/, '') + '%'; }
    function prizeCell(v) { return poolKnown ? yen(Math.round(pool * v / 1000) * 1000) : '—'; }

    var rows = payouts.map(function (p) {
      var posCls = p[0] === 1 ? ' class="row-winner"' : '';
      var medalCls = p[0] <= 3 ? ' pos-' + p[0] : '';
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + p[0] + '</span></td>' +
        '<td>' + pctLabel(p[1]) + '</td>' +
        '<td class="col-prize">' + prizeCell(p[1]) + '</td>' +
        '</tr>'
      );
    }).join('');
    rows +=
      '<tr><td class="col-pos">10+</td>' +
      '<td>' + pctLabel(restPct) + '</td>' +
      '<td class="col-prize">' + prizeCell(restPct) + '</td></tr>';

    var poolLabel = ev.status === 'future' ? 'Guaranteed Prize Pool' : 'Prize Pool';
    var summary =
      '<div class="result-summary">' +
      summaryItem(poolLabel, poolKnown ? yen(pool) : 'TBD') +
      summaryItem('Guarantee', ev.guarantee ? yen(ev.guarantee) : 'None') +
      summaryItem('In the Money', ev.stats.itm > 0 ? ev.stats.itm + ' players' : 'TBD') +
      '</div>';

    return (
      summary +
      '<h3 class="detail-notes-title">Payout</h3>' +
      '<div class="table-scroll"><table class="data-table prize-table">' +
      '<thead><tr><th>Place</th><th>Share</th><th>Prize</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="reg-note">* This is a mock payout model. The confirmed payout structure is fetched from the PokerLens API (GET /v1/event/{id}/payouts) in production.</p>'
    );
  }

  function panelHtml(ev, key) {
    switch (key) {
      case 'info': return infoPanel(ev);
      case 'structure': return structurePanel(ev);
      case 'results': return resultsPanel(ev);
      case 'live': return livePanel(ev);
      case 'prize': return prizePanel(ev);
    }
    return '';
  }

  /* ---------- カード ----------
   * 参照デザイン: 左に状態パネル / 中央にタイトル + 日時・バイイン /
   * 下部に 3 セグメント(参加者・種別・賞金)のバー。 */

  /* 大会種別を短縮表記に(NLH 等) */
  function gameShort(ev) {
    return /no-?limit hold/i.test(ev.gameType) ? 'NLH' : (ev.tags[0] || ev.gameType);
  }

  /* dateLabel("7/20 (Mon) 15:00")を日付と開始時刻に分解 */
  function splitDateTime(label) {
    var m = /^(.*?)\s+(\d{1,2}:\d{2})\s*$/.exec(label || '');
    return m ? { date: m[1], time: m[2] } : { date: label || '', time: '' };
  }

  /* 左の状態パネル(受付中 / 進行中 / 終了) */
  function headStatus(ev) {
    if (ev.status === 'running') {
      return { cls: 's-live', kicker: 'In Progress', main: 'LIVE', sub: 'Lv.' + ev.live.levelIndex, dot: true };
    }
    if (ev.status === 'past') {
      return { cls: 's-ended', kicker: 'Result', main: 'ENDED', sub: 'Final' };
    }
    var st = ev.registration ? ev.registration.state : 'open';
    if (st === 'openSoon') return { cls: 's-soon', kicker: 'Registration', main: 'SOON', sub: 'Opens soon' };
    if (st === 'closed')   return { cls: 's-closed', kicker: 'Registration', main: 'CLOSED', sub: 'Full' };
    return { cls: 's-open', kicker: 'Registration', main: 'OPEN', sub: 'Entry now' };
  }

  /* START 行の 2 列目(状態別) */
  function headSecondStat(ev) {
    if (ev.status === 'running') return { k: 'Blinds', v: num(ev.live.sb) + '/' + num(ev.live.bb) };
    if (ev.status === 'past')    return { k: 'Levels', v: ev.levelMinutes + '-min' };
    var m = /Lv\.?\s*(\d+)/i.exec(ev.lateReg || '');
    return { k: 'Reg Close', v: m ? 'Lv.' + m[1] : ev.levelMinutes + '-min' };
  }

  /* 下部バーの 3 セグメント(参加者 / 種別 / 賞金) */
  function headSegments(ev) {
    var players;
    if (ev.status === 'running') {
      players = { k: 'Players', v: num(ev.stats.players) + ' / ' + num(ev.stats.entries) };
    } else if (ev.status === 'future' && ev.registration) {
      players = { k: 'Players', v: num(ev.registration.entries) + ' / ' + num(ev.registration.cap) };
    } else {
      players = { k: 'Entries', v: num(ev.stats.entries) };
    }
    var type = { k: 'Type', v: gameShort(ev) + ' / ' + ev.flight };
    var prize;
    if (ev.status === 'past') {
      prize = { k: 'Prize Pool', v: yen(ev.stats.prizePool), prize: true };
    } else if (ev.guarantee) {
      prize = { k: 'Prize GTD', v: yen(ev.guarantee), prize: true };
    } else {
      prize = { k: 'Prize', v: '—', prize: true };
    }
    return [players, type, prize];
  }

  function headStat(k, v) {
    return '<span class="card-stat"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></span>';
  }

  function cardHtml(ev) {
    var tabs = tabsFor(ev);
    var opened = state.openedId === ev.id;

    var tabButtons = tabs.map(function (t, i) {
      return (
        '<button class="detail-tab' + (i === 0 ? ' is-active' : '') + '" data-tab="' + t.key + '">' +
        esc(t.label) + '</button>'
      );
    }).join('');

    var tabPanels = tabs.map(function (t, i) {
      return (
        '<div class="detail-panel' + (i === 0 ? ' is-active' : '') + '" data-panel="' + t.key + '">' +
        panelHtml(ev, t.key) +
        '</div>'
      );
    }).join('');

    var fav = isFav(ev.id);
    var sp = headStatus(ev);
    var dt = splitDateTime(ev.dateLabel);
    var sec = headSecondStat(ev);
    var segHtml = headSegments(ev).map(function (s) {
      return '<div class="card-seg' + (s.prize ? ' seg-prize' : '') + '">' +
        '<span class="k">' + esc(s.k) + '</span><span class="v">' + esc(s.v) + '</span></div>';
    }).join('');

    return (
      '<article id="event-' + esc(ev.id) + '" class="event-card st-' + esc(ev.status) + ' cat-' + esc(ev.category) + (opened ? ' is-open' : '') + '" data-id="' + esc(ev.id) + '">' +
      '  <button class="card-head" type="button" aria-expanded="' + opened + '">' +
      '    <div class="card-top">' +
      '      <div class="card-status ' + sp.cls + '">' +
      '        <span class="card-status-kicker">' + esc(sp.kicker) + '</span>' +
      '        <span class="card-status-main">' + (sp.dot ? '<span class="live-flash"></span>' : '') + esc(sp.main) + '</span>' +
      '        <span class="card-status-sub">' + esc(sp.sub) + '</span>' +
      '      </div>' +
      '      <div class="card-core">' +
      '        <div class="card-title-row">' +
      '          <h2 class="card-title">' + esc(ev.name) + '</h2>' +
      '          <span class="fav-btn' + (fav ? ' is-fav' : '') + '" role="button" tabindex="0" data-fav="' + esc(ev.id) + '" ' +
      'aria-label="Favorite" aria-pressed="' + fav + '" title="Add to favorites">' + (fav ? '★' : '☆') + '</span>' +
      '          <span class="card-chevron" aria-hidden="true">▾</span>' +
      '        </div>' +
      '        <div class="card-lines">' +
      '          <div class="card-line">' + headStat('Date', dt.date) + '</div>' +
      '          <div class="card-line">' + headStat('Start', dt.time) + headStat(sec.k, sec.v) + '</div>' +
      '          <div class="card-line">' + headStat('Buy-in', yen(ev.buyin + ev.fee)) + headStat('Chips', num(ev.startingStack)) + '</div>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="card-foot">' + segHtml + '</div>' +
      '  </button>' +
      '  <div class="card-body">' +
      '    <div class="card-body-inner">' +
      '      <nav class="detail-tabs">' + tabButtons + '</nav>' +
      '      <div class="detail-panels">' + tabPanels + '</div>' +
      '    </div>' +
      '  </div>' +
      '</article>'
    );
  }

  /* ---------- 描画 ---------- */

  var STATUS_ORDER = { running: 0, future: 1, past: 2 };

  function visibleEvents() {
    return MOCK_EVENTS
      .filter(function (ev) { return ev.category === state.category; })
      .filter(function (ev) { return !state.favOnly || isFav(ev.id); })
      .filter(function (ev) { return state.status === 'all' || ev.status === state.status; })
      .filter(function (ev) {
        if (state.scope === 'month') return ev.year === state.dispYear && ev.month === state.dispMonth;
        if (state.scope === 'day') {
          return ev.year === state.dispYear && ev.month === state.dispMonth && ev.day === state.date;
        }
        return true;
      })
      .sort(function (a, b) {
        return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) ||
               ((a.year * 10000 + a.month * 100 + a.day) - (b.year * 10000 + b.month * 100 + b.day));
      });
  }

  function render() {
    clearTimers();
    var events = visibleEvents();
    listEl.innerHTML = events.map(cardHtml).join('');
    emptyEl.hidden = events.length > 0;
    bindCards();
    startTimers();
    syncOpenParam();
  }

  /* ---------- アコーディオンの URL 連携 & スクロール ----------
   * 開いているカードを ?event=<id> に反映し、開いたときは常に「固定バーの直下」へ
   * カードのヘッダーが揃う位置までスクロールする。開閉アニメーション確定後に位置を
   * 計算するため、表示中のカード数や他カードの開閉状態に挙動が左右されない。 */

  var OPEN_PARAM = 'event';

  function syncOpenParam() {
    try {
      var params = new URLSearchParams(location.search);
      if (state.openedId) params.set(OPEN_PARAM, state.openedId);
      else params.delete(OPEN_PARAM);
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) { /* file:// 等で replaceState 不可の場合は無視 */ }
  }

  function scrollToOpenCard(card) {
    var header = document.querySelector('.site-header');
    var bar = document.querySelector('.filter-bar');
    /* 固定表示される領域(ヘッダー + フィルタバー)の高さ + 余白 */
    var stuck = (header ? header.offsetHeight : 0) + (bar ? bar.offsetHeight : 0) + 12;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var run = function () {
      var y = card.getBoundingClientRect().top + window.pageYOffset - stuck;
      window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
    };
    /* レイアウト変化(他カードの折りたたみ等)が落ち着いてから位置を確定 */
    var body = card.querySelector('.card-body');
    var done = false;
    var finish = function () { if (done) return; done = true; run(); };
    if (body) body.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 380);
  }

  /* 初回表示時、?event=<id> が指定されていれば該当カードを表示できる状態にする */
  function applyOpenParam() {
    var id = new URLSearchParams(location.search).get(OPEN_PARAM);
    if (!id) return;
    var ev = findEvent(id);
    if (!ev) { syncOpenParam(); return; }   // 不正な id はパラメータを除去
    state.category = ev.category;
    state.status = 'all';
    state.scope = 'all';
    state.date = null;
    state.favOnly = false;
    state.openedId = id;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.category === ev.category);
    });
    document.querySelectorAll('.status-pill').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.status === 'all');
    });
    var favF = document.getElementById('favFilter');
    if (favF) favF.classList.remove('is-active');
  }

  /* タブの数字 = 進行中 + 開催予定の大会数(終了した大会は含めない) */
  function updateCounts() {
    ['wolf', 'utage', 'other'].forEach(function (cat) {
      var el = document.querySelector('[data-count="' + cat + '"]');
      if (el) {
        el.textContent = MOCK_EVENTS.filter(function (ev) {
          return ev.category === cat && ev.status !== 'past';
        }).length;
        el.title = 'Live & upcoming tournaments';
      }
    });
  }

  /* ---------- イベントバインド ---------- */

  function bindCards() {
    listEl.querySelectorAll('.event-card').forEach(function (card) {
      var head = card.querySelector('.card-head');
      head.addEventListener('click', function () {
        var id = card.dataset.id;
        var willOpen = state.openedId !== id;
        state.openedId = willOpen ? id : null;

        listEl.querySelectorAll('.event-card').forEach(function (c) {
          var open = c.dataset.id === state.openedId;
          c.classList.toggle('is-open', open);
          c.querySelector('.card-head').setAttribute('aria-expanded', open);
        });

        syncOpenParam();
        if (willOpen) scrollToOpenCard(card);
      });

      card.querySelectorAll('.detail-tab').forEach(function (tab) {
        tab.addEventListener('click', function (e) {
          e.stopPropagation();
          var key = tab.dataset.tab;
          card.querySelectorAll('.detail-tab').forEach(function (t) {
            t.classList.toggle('is-active', t === tab);
          });
          card.querySelectorAll('.detail-panel').forEach(function (p) {
            p.classList.toggle('is-active', p.dataset.panel === key);
          });
        });
      });

      /* お気に入り(★)トグル */
      var favBtn = card.querySelector('.fav-btn');
      if (favBtn) {
        var handleFav = function (e) {
          e.stopPropagation();
          storeToggle(FAV_KEY, favBtn.dataset.fav);
          var fav = isFav(favBtn.dataset.fav);
          favBtn.classList.toggle('is-fav', fav);
          favBtn.textContent = fav ? '★' : '☆';
          favBtn.setAttribute('aria-pressed', fav);
          if (state.favOnly && !fav) render();
        };
        favBtn.addEventListener('click', handleFav);
        favBtn.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFav(e); }
        });
      }
    });
  }

  /* ---------- 日付・月セレクター ---------- */

  var DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var dateStripEl = document.getElementById('dateStrip');
  var monthNavEl = document.getElementById('monthNav');
  var dateAllBtn = document.getElementById('dateAllBtn');

  function updateAllButton() {
    dateAllBtn.classList.toggle('is-selected', state.scope === 'all');
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function monthPickerHtml() {
    // 年タブ + 12ヶ月グリッドの2段式(年数が増えても高さが一定)
    var years = [];
    CALENDAR.months.forEach(function (m) {
      if (years.indexOf(m.year) === -1) years.push(m.year);
    });
    years.sort();

    var yearChips = years.map(function (y) {
      return (
        '<button class="mp-year-chip' + (y === state.pickerYear ? ' is-active' : '') + '" ' +
        'data-year="' + y + '">' + y + '</button>'
      );
    }).join('');

    var cells = '';
    for (var m = 1; m <= 12; m++) {
      var available = CALENDAR.months.some(function (c) {
        return c.year === state.pickerYear && c.month === m;
      });
      var count = MOCK_EVENTS.filter(function (ev) {
        return ev.category === state.category && ev.year === state.pickerYear && ev.month === m;
      }).length;
      var active = state.pickerYear === state.dispYear && m === state.dispMonth;
      cells +=
        '<button class="mp-month' + (active ? ' is-active' : '') + '" ' +
        'data-year="' + state.pickerYear + '" data-month="' + m + '"' +
        (available ? '' : ' disabled') + '>' + MONTH_NAMES[m - 1] +
        (count > 0 ? '<span class="mp-dot"></span>' : '') +
        '</button>';
    }

    return '<div class="month-picker"' + (state.pickerOpen ? '' : ' hidden') + '>' +
      '<div class="mp-title">Select Month</div>' +
      '<div class="mp-years">' + yearChips + '</div>' +
      '<div class="mp-grid">' + cells + '</div>' +
      '</div>';
  }

  function renderMonthNav() {
    /* 左右の矢印は廃止。年月ラベル(2段表示)をタップして年月ピッカーで選択する。 */
    monthNavEl.innerHTML =
      '<button class="month-label' + (state.scope === 'month' ? ' is-active' : '') +
      (state.pickerOpen ? ' is-open' : '') + '" aria-label="Select month" aria-haspopup="true" ' +
      'aria-expanded="' + state.pickerOpen + '">' +
      '<span class="month-label-text">' +
      '<span class="ml-month">' + MONTH_NAMES[state.dispMonth - 1] + '</span>' +
      '<span class="ml-year">' + state.dispYear + '</span>' +
      '</span>' +
      '<span class="month-label-caret">▾</span></button>' +
      monthPickerHtml();
  }

  function renderDateStrip() {
    var html = [];
    var isTodayMonth = state.dispYear === CALENDAR.today.year && state.dispMonth === CALENDAR.today.month;
    for (var d = 1; d <= daysInMonth(state.dispYear, state.dispMonth); d++) {
      var dow = new Date(state.dispYear, state.dispMonth - 1, d).getDay();
      var count = MOCK_EVENTS.filter(function (ev) {
        return ev.category === state.category && ev.year === state.dispYear &&
               ev.month === state.dispMonth && ev.day === d;
      }).length;
      var cls = 'date-cell';
      if (state.scope === 'day' && state.date === d) cls += ' is-selected';
      if (isTodayMonth && d === CALENDAR.today.day) cls += ' is-today';
      if (dow === 0) cls += ' is-sun';
      if (dow === 6) cls += ' is-sat';
      if (count === 0) cls += ' no-events';
      html.push(
        '<button class="' + cls + '" data-day="' + d + '" aria-label="' + MONTH_NAMES[state.dispMonth - 1] + ' ' + d + ', ' + state.dispYear + '">' +
        '<span class="date-num">' + d + '</span>' +
        '<span class="date-dow">' + DOW_NAMES[dow] + '</span>' +
        '<span class="date-dot"' + (count === 0 ? ' style="visibility:hidden"' : '') + '></span>' +
        '</button>'
      );
    }
    dateStripEl.innerHTML = html.join('');
    updateAllButton();
    scrollDateIntoView();
  }

  function scrollDateIntoView() {
    var target = dateStripEl.querySelector('.date-cell.is-selected') ||
                 dateStripEl.querySelector('.date-cell.is-today') ||
                 dateStripEl.querySelector('.date-cell:not(.no-events)');
    if (!target) { dateStripEl.scrollTo({ left: 0 }); return; }
    var left = target.offsetLeft - dateStripEl.clientWidth / 2 + target.offsetWidth / 2;
    dateStripEl.scrollTo({ left: Math.max(0, left) });
  }

  function selectMonth(year, month) {
    state.dispYear = year;
    state.dispMonth = month;
    // 年月を選んだら「その月の大会」表示に切り替え
    state.scope = 'month';
    state.date = null;
    state.pickerOpen = false;
    state.openedId = null;
    renderMonthNav();
    renderDateStrip();
    render();
  }

  monthNavEl.addEventListener('click', function (e) {
    var mp = e.target.closest('.mp-month');
    if (mp) {
      selectMonth(Number(mp.dataset.year), Number(mp.dataset.month));
      return;
    }
    var yc = e.target.closest('.mp-year-chip');
    if (yc) {
      state.pickerYear = Number(yc.dataset.year);
      renderMonthNav();
      return;
    }
    var label = e.target.closest('.month-label');
    if (label) {
      state.pickerOpen = !state.pickerOpen;
      if (state.pickerOpen) state.pickerYear = state.dispYear;
      renderMonthNav();
    }
  });

  /* ピッカーの外側をクリックしたら閉じる
     (再レンダリングで DOM から切り離された要素のクリックは無視する) */
  document.addEventListener('click', function (e) {
    if (!document.contains(e.target)) return;
    if (state.pickerOpen && !e.target.closest('.month-nav')) {
      state.pickerOpen = false;
      renderMonthNav();
    }
  });

  dateAllBtn.addEventListener('click', function () {
    state.scope = 'all';
    state.date = null;
    state.openedId = null;
    dateStripEl.querySelectorAll('.date-cell').forEach(function (c) {
      c.classList.remove('is-selected');
    });
    updateAllButton();
    renderMonthNav();
    render();
  });

  dateStripEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.date-cell');
    if (!btn) return;
    var d = Number(btn.dataset.day);
    if (state.scope === 'day' && state.date === d) {
      // 選択中の日をもう一度押すと月単位表示に戻る
      state.scope = 'month';
      state.date = null;
    } else {
      state.scope = 'day';
      state.date = d;
    }
    state.openedId = null;
    dateStripEl.querySelectorAll('.date-cell').forEach(function (c) {
      c.classList.toggle('is-selected', state.scope === 'day' && state.date === Number(c.dataset.day));
    });
    updateAllButton();
    renderMonthNav();
    render();
  });

  /* ---------- 申込モーダル(モック) ----------
   * フロー: ログイン → 内容確認 → 完了(QR コード)
   * 本番では POST /v1/security/authenticate → PUT /v1/player/ticket を呼ぶ。 */

  var overlayEl = document.getElementById('modalOverlay');
  var modalBox = document.getElementById('modalBox');
  var modal = { ev: null, step: 'login', optionIndex: 0, agreed: false };

  function openRegModal(ev) {
    if (!ev) return;
    modal.ev = ev;
    modal.optionIndex = 0;
    modal.agreed = false;
    modal.step = localStorage.getItem(LOGIN_KEY) ? 'confirm' : 'login';
    overlayEl.hidden = false;
    document.body.style.overflow = 'hidden';
    renderModal();
  }

  function closeModal() {
    overlayEl.hidden = true;
    document.body.style.overflow = '';
  }

  function modalStepsHtml() {
    var steps = [['login', 'Log In'], ['confirm', 'Confirm'], ['done', 'Done']];
    var keys = steps.map(function (s) { return s[0]; });
    var cur = keys.indexOf(modal.step);
    return '<ol class="modal-steps">' + steps.map(function (s, i) {
      var cls = i < cur ? 'is-done' : i === cur ? 'is-current' : '';
      return '<li class="' + cls + '"><span class="step-num">' + (i + 1) + '</span>' + s[1] + '</li>';
    }).join('') + '</ol>';
  }

  /* 疑似 QR コード(モック用の飾り) */
  function qrHtml(seed) {
    var cells = '';
    var n = 7;
    for (var i = 0; i < 169; i++) {
      n = (n * 31 + seed.charCodeAt(i % seed.length) + i * 13) & 0xffff;
      cells += '<i' + ((n >> 6) & 1 ? ' class="on"' : '') + '></i>';
    }
    return '<div class="qr-box"><div class="qr">' + cells + '</div></div>';
  }

  function regNumber(ev) {
    var n = 0;
    for (var i = 0; i < ev.id.length; i++) n = (n * 31 + ev.id.charCodeAt(i)) % 9000;
    return 'R' + ev.year + '-' + (1000 + n);
  }

  function modalSummaryHtml(ev) {
    return (
      '<div class="modal-event">' +
      '<span class="modal-event-name">' + esc(ev.name) + '</span>' +
      '<span class="modal-event-meta">' + esc(ev.dateLabel) + ' Start / ' + esc(ev.venue) + '</span>' +
      '</div>'
    );
  }

  function renderModal() {
    var ev = modal.ev;
    var html =
      '<div class="modal-head">' +
      '<h2 class="modal-title">Tournament Entry</h2>' +
      '<button class="modal-close" type="button" data-action="close" aria-label="Close">×</button>' +
      '</div>' + modalStepsHtml();

    if (modal.step === 'login') {
      html +=
        modalSummaryHtml(ev) +
        '<p class="modal-note">You need to log in to your account to enter.' +
        '<br><span class="modal-mock-note">* This is a mock screen. Production uses PokerLens authentication (PLAYERS+ integration).</span></p>' +
        '<label class="form-label">Email<input class="form-input" type="email" placeholder="player@example.com"></label>' +
        '<label class="form-label">Password<input class="form-input" type="password" placeholder="********"></label>' +
        '<button class="modal-primary" type="button" data-action="login">Log in and continue</button>' +
        '<p class="modal-sub">Don\'t have an account? <a href="#" data-action="login">Sign up (mock)</a></p>';
    } else if (modal.step === 'confirm') {
      var reg = ev.registration;
      var options = reg.options.map(function (o, i) {
        return (
          '<label class="radio-row">' +
          '<input type="radio" name="buyinOpt" value="' + i + '"' + (i === modal.optionIndex ? ' checked' : '') + '>' +
          '<span class="radio-label">' + esc(o.label) + '</span>' +
          '<span class="radio-chips">' + esc(o.chips) + '</span>' +
          '<span class="radio-amount">' + yen(o.amount) + '</span>' +
          '</label>'
        );
      }).join('');
      html +=
        modalSummaryHtml(ev) +
        '<h3 class="modal-section-title">Select Buy-in</h3>' +
        '<div class="radio-group">' + options + '</div>' +
        '<h3 class="modal-section-title">Payment</h3>' +
        '<p class="modal-note">Please pay at the venue reception on the day (cash / Carta Dollars).</p>' +
        '<label class="agree-row"><input type="checkbox" id="agreeChk"' + (modal.agreed ? ' checked' : '') + '>' +
        'I have read and agree to the details and notes on the Info tab.</label>' +
        '<button class="modal-primary" type="button" data-action="confirm"' + (modal.agreed ? '' : ' disabled') + '>Confirm entry</button>';
    } else {
      var opt = ev.registration.options[modal.optionIndex];
      html +=
        '<div class="done-mark">✓</div>' +
        '<h3 class="done-title">Entry complete</h3>' +
        modalSummaryHtml(ev) +
        '<div class="done-detail">' +
        '<span>' + esc(opt.label) + ' / ' + esc(opt.chips) + '</span>' +
        '<span class="done-amount">' + yen(opt.amount) + ' (pay on the day)</span>' +
        '</div>' +
        qrHtml(ev.id) +
        '<p class="done-regnum">Entry No.: <strong>' + regNumber(ev) + '</strong></p>' +
        '<p class="modal-note">Please show this QR code at reception on the day. You can review or cancel your entry from My Page (not implemented in this mock).</p>' +
        '<button class="modal-primary" type="button" data-action="close">Close</button>';
    }

    modalBox.innerHTML = html;
  }

  modalBox.addEventListener('click', function (e) {
    var actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    e.preventDefault();
    var action = actionEl.dataset.action;
    if (action === 'close') {
      closeModal();
    } else if (action === 'login') {
      localStorage.setItem(LOGIN_KEY, '1');
      modal.step = 'confirm';
      renderModal();
    } else if (action === 'confirm') {
      storeAdd(APPLIED_KEY, modal.ev.id);
      modal.step = 'done';
      renderModal();
      render();  // 一覧側の申込ボタンを「申込済み」に更新
    }
  });

  modalBox.addEventListener('change', function (e) {
    if (e.target.name === 'buyinOpt') {
      modal.optionIndex = Number(e.target.value);
    } else if (e.target.id === 'agreeChk') {
      modal.agreed = e.target.checked;
      var btn = modalBox.querySelector('[data-action="confirm"]');
      if (btn) btn.disabled = !modal.agreed;
    }
  });

  overlayEl.addEventListener('click', function (e) {
    if (e.target === overlayEl) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlayEl.hidden) closeModal();
  });

  /* ---------- ライブタイマー(演出) ---------- */

  function startTimers() {
    listEl.querySelectorAll('[data-timer]').forEach(function (el) {
      var remaining = parseInt(el.dataset.remaining, 10);
      var t = setInterval(function () {
        remaining = remaining > 0 ? remaining - 1 : 0;
        el.textContent = fmtSec(remaining);
        if (remaining === 0) clearInterval(t);
      }, 1000);
      timers.push(t);
    });
  }

  function clearTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  /* ---------- 上部タブ / フィルタ ---------- */

  document.getElementById('categoryTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.category-tab');
    if (!btn) return;
    state.category = btn.dataset.category;
    state.openedId = null;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t === btn);
    });
    applyTheme(state.category);
    state.pickerOpen = false;
    renderMonthNav();
    renderDateStrip();
    render();
  });

  document.getElementById('favFilter').addEventListener('click', function () {
    state.favOnly = !state.favOnly;
    state.openedId = null;
    document.getElementById('favFilter').classList.toggle('is-active', state.favOnly);
    render();
  });

  document.getElementById('statusFilter').addEventListener('click', function (e) {
    var btn = e.target.closest('.status-pill');
    if (!btn || btn.id === 'favFilter') return;
    state.status = btn.dataset.status;
    state.openedId = null;
    /* 状態ピル(All / Live / Upcoming / Past)だけを排他トグル。
     * お気に入り(favFilter)は data-status を持たないので対象外 → 選択が維持される。 */
    document.querySelectorAll('.status-pill[data-status]').forEach(function (t) {
      t.classList.toggle('is-active', t === btn);
    });
    render();
  });

  /* ---------- 初期化 ---------- */

  applyOpenParam();               // ?event=<id> があれば該当カードを開いた状態で表示
  applyTheme(state.category);
  updateCounts();
  renderMonthNav();
  renderDateStrip();
  render();
  if (state.openedId) {
    var initialCard = document.getElementById('event-' + state.openedId);
    if (initialCard) scrollToOpenCard(initialCard);
  }
})();
