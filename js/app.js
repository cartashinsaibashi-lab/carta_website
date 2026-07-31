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

  /* カウントダウン表示。1日以上は "3d 04:00:00"、1時間以上は "9:46:01"、
     それ未満は "56:01"(参照デザイン準拠) */
  function fmtCountdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    if (d > 0) return d + 'd ' + p2(h) + ':' + p2(m) + ':' + p2(s);
    if (h > 0) return h + ':' + p2(m) + ':' + p2(s);
    return p2(m) + ':' + p2(s);
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
    /* カード下部から移動した情報(参加者 / 賞金 / フライト) */
    if (ev.flight) rows.push(['Flight', ev.flight]);
    if (ev.status === 'running') {
      rows.push(['Players (remaining / entries)', num(ev.stats.players) + ' / ' + num(ev.stats.entries)]);
    } else if (ev.status === 'future' && ev.registration) {
      rows.push(['Entries', num(ev.registration.entries) + (ev.registration.cap ? ' / ' + num(ev.registration.cap) : '')]);
    } else {
      rows.push(['Entries', num(ev.stats.entries)]);
    }
    if (ev.status === 'past') rows.push(['Prize Pool', yen(ev.stats.prizePool)]);
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
        '<td class="col-player">' + esc(r.player) + '</td>' +
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
    var seatsHtml = '';
    if (ev.seats && ev.seats.length) {
      seatsHtml =
        '<div class="live-seats">' +
        '<h4 class="live-seats-title">Seating (' + ev.seats.length + ')</h4>' +
        '<div class="seat-grid">' +
        ev.seats.map(function (s) {
          return '<div class="seat-item">' +
            '<span class="seat-no">T' + num(s.table) + ' · #' + num(s.seat) + '</span>' +
            '<span class="seat-name">' + esc(s.player) + '</span></div>';
        }).join('') +
        '</div></div>';
    }
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
      seatsHtml +
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

  var MONTH_MS = 30 * 24 * 3600 * 1000; // 「1ヶ月前」を30日で近似

  /* 時刻ベースの3段階フェーズ(参照デザイン準拠)
   *   開始1ヶ月前〜開始   : STARTS IN  <開始までのカウントダウン>
   *   開始〜レジクロ       : REG CLOSE IN <レジクロまでのカウントダウン>
   *   レジクロ後           : LIVE
   * API が past を返したら最優先で CLOSED。target を持つ場合はカウントダウン表示。 */
  function liveLvSub(ev) { return ev.live ? 'Lv.' + ev.live.levelIndex : 'In progress'; }

  function futureOpenPhase(ev) {
    var st = ev.registration ? ev.registration.state : 'open';
    if (st === 'openSoon') return { cls: 's-soon', main: 'SOON', sub: 'Opens soon', dot: false, target: null };
    if (st === 'closed')   return { cls: 's-closed', main: 'CLOSED', sub: 'Full', dot: false, target: null };
    return { cls: 's-open', main: 'OPEN', sub: 'Entry now', dot: false, target: null };
  }

  function headStatus(ev, now) {
    now = now || Date.now();
    if (ev.status === 'past') return { cls: 's-ended', main: 'CLOSED', sub: 'Final', dot: false, target: null };

    var start = ev.startAt ? Date.parse(ev.startAt) : NaN;
    var regClose = ev.regCloseAt ? Date.parse(ev.regCloseAt) : NaN;

    if (isFinite(start)) {
      if (now < start) {
        // 開始前: 1ヶ月以内ならカウントダウン、それより先は通常の OPEN 表示
        if (now >= start - MONTH_MS) return { cls: 's-startin', main: 'STARTS IN', sub: '', dot: true, target: start };
        return futureOpenPhase(ev);
      }
      // 開始済み: レジクロ前ならカウントダウン、後(または不明)なら LIVE
      if (isFinite(regClose) && now < regClose) return { cls: 's-regclose', main: 'REG CLOSE IN', sub: '', dot: true, target: regClose };
      return { cls: 's-live', main: 'LIVE', sub: liveLvSub(ev), dot: true, target: null };
    }

    // 開始時刻不明: 従来どおり API ステータスで判定
    if (ev.status === 'running') return { cls: 's-live', main: 'LIVE', sub: liveLvSub(ev), dot: true, target: null };
    return futureOpenPhase(ev);
  }

  /* START 行の 2 列目。参照デザイン: "Reg Close 17:00 (Lv.8)"(時刻 + レジクロレベル) */
  function headSecondStat(ev) {
    if (ev.status === 'past') return { k: 'Levels', v: ev.levelMinutes + '-min' };
    var m = /Lv\.?\s*(\d+)/i.exec(ev.lateReg || '');
    var lv = m ? 'Lv.' + m[1] : '';
    var t = ev.regCloseTime || '';
    var v = t ? (t + (lv ? ' (' + lv + ')' : '')) : (lv || (ev.levelMinutes + '-min'));
    return { k: 'Reg Close', v: v };
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
    var isPast = ev.status === 'past';

    // カウントダウン(STARTS IN / REG CLOSE IN)は data-target を持つ span にして
    // グローバルの ticker が毎秒更新・フェーズ遷移時に再描画する。
    var cdHtml = sp.target
      ? '<span class="card-countdown" data-target="' + sp.target + '">' + esc(fmtCountdown(sp.target - Date.now())) + '</span>'
      : '';
    // 下部バーに入れる状態表示: ドット + ラベル(LIVE / STARTS IN 等)+ カウントダウン
    var statusHtml =
      '<span class="card-status ' + sp.cls + '">' +
      (sp.dot ? '<span class="live-flash"></span>' : '') +
      '<span class="card-status-label">' + esc(sp.main) + '</span>' +
      cdHtml +
      '</span>';

    var noBadge = ev.number ? '<span class="card-no">No.' + esc(String(ev.number)) + '</span>' : '';
    var favBtn =
      '<span class="fav-btn' + (fav ? ' is-fav' : '') + '" role="button" tabindex="0" data-fav="' + esc(ev.id) + '" ' +
      'aria-label="Favorite" aria-pressed="' + fav + '" title="Add to favorites">' + (fav ? '★' : '☆') + '</span>';
    /* 終了大会は情報行を省いて最小表示(細バー + No + 大会名のみ) */
    var linesHtml = isPast ? '' : (
      '    <div class="card-lines">' +
      '      <div class="card-line">' + headStat('Date', dt.date) + headStat('Start', dt.time) + headStat(sec.k, sec.v) + '</div>' +
      '      <div class="card-line">' + headStat('Buy-in', yen(ev.buyin + ev.fee)) + headStat('Chips', num(ev.startingStack)) + '</div>' +
      '    </div>'
    );

    return (
      '<article id="event-' + esc(ev.id) + '" class="event-card st-' + esc(ev.status) + ' cat-' + esc(ev.category) + (opened ? ' is-open' : '') + (isPast ? ' is-minimal' : '') + '" data-id="' + esc(ev.id) + '">' +
      '  <button class="card-head" type="button" aria-expanded="' + opened + '">' +
      '    <div class="card-headline">' +
      noBadge +
      '      <h2 class="card-title">' + esc(ev.name) + '</h2>' +
      favBtn +
      '    </div>' +
      linesHtml +
      '    <div class="card-expand">' +
      statusHtml +
      '      <span class="card-expand-toggle">' +
      '        <span class="card-expand-label"></span>' +
      '        <span class="card-chevron" aria-hidden="true">▾</span>' +
      '      </span>' +
      '    </div>' +
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

  /* 並び替え用の日時キー(年月日 + 開始時刻)。dateLabel 末尾の H:MM も反映。 */
  function dateKey(ev) {
    var hh = 0, mm = 0;
    var m = /^(\d{1,2}):(\d{2})$/.exec(splitDateTime(ev.dateLabel).time);
    if (m) { hh = +m[1]; mm = +m[2]; }
    return ev.year * 100000000 + ev.month * 1000000 + ev.day * 10000 + hh * 100 + mm;
  }

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
        // 日付優先の schedule 形式: 未来/ライブ(過去以外)を先、過去を末尾へ
        var ap = a.status === 'past', bp = b.status === 'past';
        if (ap !== bp) return ap ? 1 : -1;
        // 未来/ライブ = 開催が近い順(昇順・今日→未来)、過去 = 最近閉じた順(降順)
        var ka = dateKey(a), kb = dateKey(b);
        return ap ? (kb - ka) : (ka - kb);
      });
  }

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* 日付見出しラベル "07.31 Fri."(参照デザイン準拠) */
  function dateHeaderLabel(ev) {
    var wd = WEEKDAYS[new Date(Date.UTC(ev.year, ev.month - 1, ev.day)).getUTCDay()];
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return p2(ev.month) + '.' + p2(ev.day) + ' ' + wd + '.';
  }

  /* カード列を日付ごとに区切って HTML 化。日付が変わる位置に見出しを、
     過去の先頭に Past 区切りを挿入する。見出しは .event-card ではないため
     既存のカード走査(bindCards / タイマー / 先読み)には影響しない。 */
  function listHtml(events) {
    var out = '';
    var curKey = null;
    var pastStarted = false;
    events.forEach(function (ev) {
      if (ev.status === 'past' && !pastStarted) {
        pastStarted = true;
        curKey = null; // 過去の最初の日付でも見出しを出す
        out += '<div class="past-divider"><span>Past</span></div>';
      }
      var k = ev.year + '-' + ev.month + '-' + ev.day;
      if (k !== curKey) {
        curKey = k;
        out += '<div class="date-divider"><span class="date-divider-label">' +
          esc(dateHeaderLabel(ev)) + '</span></div>';
      }
      out += cardHtml(ev);
    });
    return out;
  }

  function render() {
    clearTimers();
    var events = visibleEvents();
    listEl.innerHTML = listHtml(events);
    emptyEl.hidden = events.length > 0;
    bindCards();
    startTimers();
    syncOpenParam();
    prefetchVisibleDetails(); // 表示中カードの詳細をバックグラウンド先読み
  }

  // 詳細の先読みは負荷抑制のため先頭 N 件に限定(全件は先読みしない)
  var PREFETCH_LIMIT = 12;

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

  /* ---------- 詳細の遅延ロード(API接続時のみ) ---------- */
  /* 一覧はカード表示に必要な範囲だけ取得している。カードを開いたときに
   * /api/events/:id からストラクチャー/結果/ライブ状況を取得してマージする。
   * モック(data.js フォールバック)時は詳細が既にインラインなので何もしない。 */

  /* 詳細を取得して ev にマージする。完了時(成功/失敗とも)に onDone を呼ぶ。
   * モック時や取得済みのときは即座に onDone(取得しない)。 */
  function maybeLoadDetail(id, onDone) {
    var ev = findEvent(id);
    var done = function () { if (onDone) onDone(); };
    if (window.__CARTA_DATA_SOURCE__ !== 'api' || !ev || ev._detail === 'loaded') { done(); return; }
    // 先読み中なら同じ取得の完了を待つ(押下時に空表示にならないように)
    if (ev._detail === 'loading' && ev._detailPromise) { ev._detailPromise.then(done); return; }
    ev._detail = 'loading';
    ev._detailPromise = fetch('/api/events/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && !d.error) {
          if (d.structure) ev.structure = d.structure;
          if (d.results) ev.results = d.results;
          if (d.live) ev.live = d.live;
          if (d.seats) ev.seats = d.seats;
          if (d.registration) ev.registration = d.registration;
          if (d.stats) ev.stats = d.stats;
          if (d.details) ev.details = d.details;
          ev._detail = 'loaded';
        } else {
          ev._detail = null;
        }
      })
      .catch(function () { ev._detail = null; });
    ev._detailPromise.then(done);
  }

  /* 画面表示後、表示中カードの詳細をバックグラウンドで順番に先読みする。
   * 押下時に取得済みなら即時展開できる。フィルタ変更で自動的にやり直す(古い先読みは中断)。 */
  var prefetchRun = 0;
  function prefetchVisibleDetails() {
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return;
    var myRun = ++prefetchRun;
    var list = visibleEvents().slice(0, PREFETCH_LIMIT);
    var i = 0;
    (function next() {
      if (myRun !== prefetchRun) return;             // フィルタ変更等で中断
      if (i >= list.length) return;
      var ev = list[i++];
      if (!ev || ev._detail === 'loaded') { next(); return; } // 取得済みはスキップ
      maybeLoadDetail(ev.id, function () { setTimeout(next, 150); }); // API に優しい間隔で次へ
    })();
  }

  /* ---------- ライブ状況のポーリング(進行中カードを開いている間だけ) ----------
   * PokerLens にプッシュ配信は無いため、開いている進行中カードだけを一定間隔で
   * 再取得して Live パネルを更新する。カードを閉じる/他へ移る/ページ非表示で停止。
   * 全体 render() だと Live タブ選択が戻るので、Live パネルだけ差し替える。 */

  var livePollTimer = null;
  var livePollId = null;
  var LIVE_POLL_MS = 25000;

  function applyDetail(ev, d) {
    if (!d || d.error) return false;
    if (d.status && d.status !== ev.status) ev.status = d.status;
    if (d.live) ev.live = d.live;
    if (d.seats) ev.seats = d.seats;
    if (d.stats) ev.stats = d.stats;
    if (d.structure) ev.structure = d.structure;
    if (d.results) ev.results = d.results;
    if (d.registration) ev.registration = d.registration;
    ev._detail = 'loaded';
    return true;
  }

  function updateLivePanel(id) {
    var ev = findEvent(id);
    var cardEl = document.getElementById('event-' + id);
    var panel = cardEl && cardEl.querySelector('.detail-panel[data-panel="live"]');
    if (!ev || !ev.live || !panel) return;
    panel.innerHTML = livePanel(ev);
    clearTimers();
    startTimers(); // 差し替えた data-timer にカウントダウンを付け直す
  }

  function pollLiveOnce(id) {
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return;
    fetch('/api/events/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var ev = findEvent(id);
        if (!ev || !applyDetail(ev, d)) return;
        if (state.openedId !== id) { stopLivePolling(); return; }
        if (ev.status !== 'running') { stopLivePolling(); render(); return; } // 終了→全体再描画で状態反映
        updateLivePanel(id);
      })
      .catch(function () {});
  }

  function startLivePolling(id) {
    stopLivePolling();
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return;
    var ev = findEvent(id);
    if (!ev || ev.status !== 'running') return; // 進行中のみ
    livePollId = id;
    livePollTimer = setInterval(function () {
      if (document.hidden) return;                       // タブ非表示中はスキップ
      if (state.openedId !== id) { stopLivePolling(); return; }
      pollLiveOnce(id);
    }, LIVE_POLL_MS);
  }

  function stopLivePolling() {
    if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null; }
    livePollId = null;
  }

  /* カードの開閉状態を DOM に反映(再描画なし・閉じる用) */
  function applyOpenState() {
    listEl.querySelectorAll('.event-card').forEach(function (c) {
      var open = c.dataset.id === state.openedId;
      c.classList.toggle('is-open', open);
      c.querySelector('.card-head').setAttribute('aria-expanded', open);
    });
  }

  /* 詳細ロード完了後にカードを開く(全体再描画で詳細を反映してから展開) */
  function openCard(id) {
    state.openedId = id;
    render();
    startLivePolling(id);
    var el = document.getElementById('event-' + id);
    if (el) scrollToOpenCard(el);
  }

  /* ---------- イベントバインド ---------- */

  function bindCards() {
    listEl.querySelectorAll('.event-card').forEach(function (card) {
      var head = card.querySelector('.card-head');
      head.addEventListener('click', function () {
        var id = card.dataset.id;
        if (state.openedId === id) {
          // 閉じる(即時)
          state.openedId = null;
          applyOpenState();
          syncOpenParam();
          stopLivePolling();
          return;
        }
        // 開く: API 接続時は詳細取得の完了を待ってから展開する
        var ev = findEvent(id);
        if (window.__CARTA_DATA_SOURCE__ === 'api' && ev && ev._detail !== 'loaded') {
          card.classList.add('is-loading');
          maybeLoadDetail(id, function () {
            card.classList.remove('is-loading');
            openCard(id);
          });
        } else {
          openCard(id);
        }
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
        if (remaining === 0) {
          clearInterval(t);
          // レベル終了 → 開いている進行中カードなら即時再取得して次レベルへ
          if (livePollId && state.openedId === livePollId && !document.hidden) pollLiveOnce(livePollId);
        }
      }, 1000);
      timers.push(t);
    });
  }

  function clearTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  /* ---------- カウントダウン ticker(STARTS IN / REG CLOSE IN) ----------
   * カード上部ステータスバーの .card-countdown を毎秒更新する。render() をまたいでも
   * 生き続ける単一タイマーで、毎tick DOM を走査するため新カードにも自動追従する。
   * カウントダウンが 0 を跨いだら render() でフェーズ(→ REG CLOSE IN → LIVE)を反映。 */
  var countdownTimer = null;
  function ensureCountdownTicker() {
    if (countdownTimer) return;
    countdownTimer = setInterval(function () {
      var els = listEl.querySelectorAll('.card-countdown[data-target]');
      if (!els.length) return;
      var now = Date.now();
      var flip = false;
      els.forEach(function (el) {
        var ms = (+el.getAttribute('data-target')) - now;
        if (ms <= 0) flip = true;
        el.textContent = fmtCountdown(ms);
      });
      if (flip) render(); // フェーズ遷移(開始 / レジクロ到達)を反映
    }, 1000);
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
  // 取得失敗時は空表示 + 障害メッセージ(ダミーデータは出さない)
  if (window.__CARTA_DATA_SOURCE__ === 'error' && emptyEl) {
    emptyEl.textContent = 'Tournament data is temporarily unavailable. Please try again later.';
  }
  updateCounts();
  renderMonthNav();
  renderDateStrip();
  render();
  ensureCountdownTicker();         // STARTS IN / REG CLOSE IN のカウントダウン開始
  if (state.openedId) {
    // ?event=<id> で自動展開した場合も詳細(結果/ストラクチャー/ライブ)を読み込み、完了後に反映
    var openId = state.openedId;
    maybeLoadDetail(openId, function () { if (state.openedId === openId) render(); });
    startLivePolling(openId);
    var initialCard = document.getElementById('event-' + openId);
    if (initialCard) scrollToOpenCard(initialCard);
  }

  // 初期描画が完了したのでローディングを解除して画面を表示
  document.body.classList.add('app-ready');
})();
