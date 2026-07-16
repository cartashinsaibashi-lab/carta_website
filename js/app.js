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

  function statusMeta(status) {
    return {
      running: { label: 'LIVE 進行中', cls: 'badge-running' },
      future: { label: '開催予定', cls: 'badge-future' },
      past: { label: '終了', cls: 'badge-past' }
    }[status];
  }

  function fmtSec(total) {
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- タブ定義 ---------- */

  function tabsFor(ev) {
    var tabs = [];
    if (ev.status === 'running') tabs.push({ key: 'live', label: 'ライブ状況' });
    if (ev.status === 'future') tabs.push({ key: 'reg', label: '申込状況' });
    if (ev.status === 'past') tabs.push({ key: 'results', label: '結果' });
    tabs.push({ key: 'info', label: '大会情報' });
    tabs.push({ key: 'structure', label: 'ストラクチャー' });
    return tabs;
  }

  /* ---------- 各パネルの HTML ---------- */

  function infoPanel(ev) {
    var rows = [
      ['開催日時', ev.dateLabel + ' 開始'],
      ['会場', ev.venue],
      ['バイイン', yen(ev.buyin) + ' + ' + yen(ev.fee) + '(合計 ' + yen(ev.buyin + ev.fee) + ')'],
      ['保証賞金', ev.guarantee ? yen(ev.guarantee) : 'なし'],
      ['スタートスタック', num(ev.startingStack) + ' 点'],
      ['レベル時間', ev.levelMinutes + ' 分'],
      ['レイトレジスト', ev.lateReg],
      ['リエントリー', ev.reentry],
      ['ゲーム', ev.gameType]
    ];
    var dl = rows.map(function (r) {
      return '<div class="info-row"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('');
    /* 大会詳細(本番では GET /v1/event/{id} の dailyDetails.description から取得) */
    var detailsHtml = '';
    if (ev.details && ev.details.length) {
      detailsHtml =
        '<h3 class="detail-notes-title">大会詳細</h3>' +
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
    var body = ev.structure.map(function (row) {
      if (row.type === 'break') {
        return '<tr class="row-break"><td colspan="4">— 休憩 ' + row.minutes + ' 分 —</td></tr>';
      }
      var cls = row.lateRegClose ? ' class="row-latereg"' : '';
      var note = row.lateRegClose ? ' <span class="latereg-tag">レイトレジ終了</span>' : '';
      return (
        '<tr' + cls + '>' +
        '<td>' + row.level + note + '</td>' +
        '<td>' + num(row.sb) + ' / ' + num(row.bb) + '</td>' +
        '<td>' + num(row.ante) + '</td>' +
        '<td>' + row.minutes + '分</td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="structure-meta">スタートスタック ' + num(ev.startingStack) + ' 点 / BB アンティ方式</div>' +
      '<div class="table-scroll"><table class="data-table structure-table">' +
      '<thead><tr><th>Lv</th><th>ブラインド (SB/BB)</th><th>アンティ (BB)</th><th>時間</th></tr></thead>' +
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
      summaryItem('総エントリー', num(ev.stats.entries)) +
      summaryItem('プライズプール', yen(ev.stats.prizePool)) +
      summaryItem('入賞', ev.stats.itm + ' 名') +
      '</div>' +
      '<div class="table-scroll"><table class="data-table results-table">' +
      '<thead><tr><th>順位</th><th>プレイヤー</th><th>賞金</th>' + (hasBounty ? '<th>バウンティ</th>' : '') + '</tr></thead>' +
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
      '    <div class="live-next">NEXT: ' + esc(lv.nextLevel) + '<br>次の休憩 ' + esc(lv.nextBreak) + '</div>' +
      '  </div>' +
      '  <div class="live-stats">' +
      liveStat('エントリー', num(ev.stats.entries)) +
      liveStat('残りプレイヤー', num(ev.stats.players)) +
      liveStat('稼働テーブル', num(lv.tables)) +
      liveStat('アベレージ', num(ev.stats.avgStack) + ' 点') +
      liveStat('トータルチップ', num(ev.stats.totalChips)) +
      liveStat('プライズプール', yen(ev.stats.prizePool)) +
      '  </div>' +
      '</div>' +
      '<p class="live-note"><span class="dot dot-live"></span>本番では PokerLens API から一定間隔で最新状況を取得して自動更新します。</p>'
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

  function regPanel(ev) {
    var reg = ev.registration;
    var pct = reg.cap ? Math.min(100, Math.round((reg.entries / reg.cap) * 100)) : 0;
    var stateCls = reg.state === 'open' ? 'reg-open' : reg.state === 'openSoon' ? 'reg-soon' : 'reg-closed';
    var options = reg.options.map(function (o) {
      return (
        '<div class="reg-option">' +
        '<span class="reg-option-label">' + esc(o.label) + '</span>' +
        '<span class="reg-option-chips">' + esc(o.chips) + '</span>' +
        '<span class="reg-option-amount">' + yen(o.amount) + '</span>' +
        '</div>'
      );
    }).join('');
    var applied = isApplied(ev.id);
    return (
      '<div class="reg-head">' +
      '  <span class="reg-state ' + stateCls + '">' + esc(reg.stateLabel) + '</span>' +
      '  <span class="reg-close">' + esc(reg.closesLabel) + '</span>' +
      '</div>' +
      '<div class="reg-progress">' +
      '  <div class="reg-progress-label"><span>申込 ' + num(reg.entries) + ' 名</span><span>定員 ' + num(reg.cap) + ' 名</span></div>' +
      '  <div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="reg-options">' + options + '</div>' +
      '<p class="reg-note">' + esc(reg.note) + '</p>' +
      '<button class="reg-button" type="button" data-reg="' + esc(ev.id) + '"' +
      (reg.state !== 'open' || applied ? ' disabled' : '') + '>' +
      (applied ? '✓ 申込済み' : reg.state === 'open' ? 'この大会に申し込む' : '受付開始前です') +
      '</button>' +
      (applied ? '<p class="reg-applied-note">申込内容は完了画面の QR コードまたはマイページ(モック未実装)から確認できます。</p>' : '')
    );
  }

  function panelHtml(ev, key) {
    switch (key) {
      case 'info': return infoPanel(ev);
      case 'structure': return structurePanel(ev);
      case 'results': return resultsPanel(ev);
      case 'live': return livePanel(ev);
      case 'reg': return regPanel(ev);
    }
    return '';
  }

  /* ---------- カード ---------- */

  function cardHtml(ev) {
    var meta = statusMeta(ev.status);
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

    var tagsHtml = ev.tags.map(function (t) {
      return '<span class="event-tag">' + esc(t) + '</span>';
    }).join('');

    var fav = isFav(ev.id);
    var sub = ev.status === 'running'
      ? '<span class="card-live-info"><span class="dot dot-live"></span>Lv.' + ev.live.levelIndex +
        ' — ' + num(ev.live.sb) + '/' + num(ev.live.bb) + ' — 残り ' + num(ev.stats.players) + ' 名</span>'
      : ev.status === 'future' && ev.registration
        ? '<span class="card-reg-info">申込 ' + num(ev.registration.entries) + ' / ' + num(ev.registration.cap) + ' 名</span>'
        : ev.results
          ? '<span class="card-past-info">優勝: ' + esc(ev.results[0].player) + '</span>'
          : '';

    return (
      '<article class="event-card st-' + esc(ev.status) + ' cat-' + esc(ev.category) + (opened ? ' is-open' : '') + '" data-id="' + esc(ev.id) + '">' +
      '  <button class="card-head" type="button" aria-expanded="' + opened + '">' +
      '    <div class="card-date"><span class="card-date-text">' + esc(ev.dateLabel) + '</span>' +
      '      <span class="card-flight">' + esc(ev.flight) + '</span></div>' +
      '    <div class="card-main">' +
      '      <div class="card-title-row">' +
      '        <span class="status-badge ' + meta.cls + '">' + meta.label + '</span>' +
      '        <h2 class="card-title">' + esc(ev.name) + '</h2>' +
      '      </div>' +
      '      <div class="card-sub-row">' + tagsHtml + sub + '</div>' +
      '    </div>' +
      '    <div class="card-buyin">' +
      '      <span class="card-buyin-amount">' + yen(ev.buyin + ev.fee) + '</span>' +
      '      <span class="card-buyin-note">' + yen(ev.buyin) + '+' + yen(ev.fee) + '</span>' +
      (ev.guarantee ? '<span class="card-guarantee">保証 ' + yen(ev.guarantee) + '</span>' : '') +
      '    </div>' +
      '    <span class="fav-btn' + (fav ? ' is-fav' : '') + '" role="button" tabindex="0" data-fav="' + esc(ev.id) + '" ' +
      'aria-label="お気に入り" aria-pressed="' + fav + '" title="お気に入りに登録">' + (fav ? '★' : '☆') + '</span>' +
      '    <span class="card-chevron" aria-hidden="true">▾</span>' +
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
  }

  /* タブの数字 = 進行中 + 開催予定の大会数(終了した大会は含めない) */
  function updateCounts() {
    ['wolf', 'utage', 'other'].forEach(function (cat) {
      var el = document.querySelector('[data-count="' + cat + '"]');
      if (el) {
        el.textContent = MOCK_EVENTS.filter(function (ev) {
          return ev.category === cat && ev.status !== 'past';
        }).length;
        el.title = '進行中・開催予定の大会数';
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

        if (willOpen) {
          setTimeout(function () {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 320);
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

      /* 申込ボタン → 申込モーダル */
      var regBtn = card.querySelector('.reg-button[data-reg]');
      if (regBtn && !regBtn.disabled) {
        regBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openRegModal(findEvent(regBtn.dataset.reg));
        });
      }
    });
  }

  /* ---------- 日付・月セレクター ---------- */

  var DOW_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  var dateStripEl = document.getElementById('dateStrip');
  var monthNavEl = document.getElementById('monthNav');
  var dateAllBtn = document.getElementById('dateAllBtn');

  function updateAllButton() {
    dateAllBtn.classList.toggle('is-selected', state.scope === 'all');
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function monthIndex() {
    for (var i = 0; i < CALENDAR.months.length; i++) {
      if (CALENDAR.months[i].year === state.dispYear && CALENDAR.months[i].month === state.dispMonth) return i;
    }
    return -1;
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
        'data-year="' + y + '">' + y + '年</button>'
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
        (available ? '' : ' disabled') + '>' + m + '月' +
        (count > 0 ? '<span class="mp-dot"></span>' : '') +
        '</button>';
    }

    return '<div class="month-picker"' + (state.pickerOpen ? '' : ' hidden') + '>' +
      '<div class="mp-title">開催月を選択</div>' +
      '<div class="mp-years">' + yearChips + '</div>' +
      '<div class="mp-grid">' + cells + '</div>' +
      '</div>';
  }

  function renderMonthNav() {
    var idx = monthIndex();
    monthNavEl.innerHTML =
      '<button class="month-arrow" data-nav="prev" aria-label="前の月"' +
      (idx <= 0 ? ' disabled' : '') + '>‹</button>' +
      '<button class="month-label' + (state.scope === 'month' ? ' is-active' : '') +
      (state.pickerOpen ? ' is-open' : '') + '" aria-label="年月を選択" aria-haspopup="true" ' +
      'aria-expanded="' + state.pickerOpen + '">' +
      state.dispYear + '年' + state.dispMonth + '月' +
      '<span class="month-label-caret">▾</span></button>' +
      '<button class="month-arrow" data-nav="next" aria-label="次の月"' +
      (idx >= CALENDAR.months.length - 1 ? ' disabled' : '') + '>›</button>' +
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
        '<button class="' + cls + '" data-day="' + d + '" aria-label="' + state.dispYear + '年' + state.dispMonth + '月' + d + '日">' +
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
    var arrow = e.target.closest('.month-arrow');
    if (arrow && !arrow.disabled) {
      var idx = monthIndex() + (arrow.dataset.nav === 'next' ? 1 : -1);
      idx = Math.max(0, Math.min(CALENDAR.months.length - 1, idx));
      selectMonth(CALENDAR.months[idx].year, CALENDAR.months[idx].month);
      return;
    }
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
    var steps = [['login', 'ログイン'], ['confirm', '内容確認'], ['done', '完了']];
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
      '<span class="modal-event-meta">' + esc(ev.dateLabel) + ' 開始 / ' + esc(ev.venue) + '</span>' +
      '</div>'
    );
  }

  function renderModal() {
    var ev = modal.ev;
    var html =
      '<div class="modal-head">' +
      '<h2 class="modal-title">大会申込</h2>' +
      '<button class="modal-close" type="button" data-action="close" aria-label="閉じる">×</button>' +
      '</div>' + modalStepsHtml();

    if (modal.step === 'login') {
      html +=
        modalSummaryHtml(ev) +
        '<p class="modal-note">申込にはアカウントでのログインが必要です。' +
        '<br><span class="modal-mock-note">※ モック画面です。本番では PokerLens 認証(PLAYERS+ 連携)を行います。</span></p>' +
        '<label class="form-label">メールアドレス<input class="form-input" type="email" placeholder="player@example.com"></label>' +
        '<label class="form-label">パスワード<input class="form-input" type="password" placeholder="********"></label>' +
        '<button class="modal-primary" type="button" data-action="login">ログインして申込に進む</button>' +
        '<p class="modal-sub">アカウントをお持ちでない方は <a href="#" data-action="login">新規登録(モック)</a></p>';
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
        '<h3 class="modal-section-title">バイインを選択</h3>' +
        '<div class="radio-group">' + options + '</div>' +
        '<h3 class="modal-section-title">お支払い</h3>' +
        '<p class="modal-note">当日、会場受付にてお支払いください(現金 / カルタドル)。</p>' +
        '<label class="agree-row"><input type="checkbox" id="agreeChk"' + (modal.agreed ? ' checked' : '') + '>' +
        '「大会情報」タブの大会詳細・注意事項を確認し、同意します</label>' +
        '<button class="modal-primary" type="button" data-action="confirm"' + (modal.agreed ? '' : ' disabled') + '>申込を確定する</button>';
    } else {
      var opt = ev.registration.options[modal.optionIndex];
      html +=
        '<div class="done-mark">✓</div>' +
        '<h3 class="done-title">申込が完了しました</h3>' +
        modalSummaryHtml(ev) +
        '<div class="done-detail">' +
        '<span>' + esc(opt.label) + ' / ' + esc(opt.chips) + '</span>' +
        '<span class="done-amount">' + yen(opt.amount) + '(当日払い)</span>' +
        '</div>' +
        qrHtml(ev.id) +
        '<p class="done-regnum">申込番号: <strong>' + regNumber(ev) + '</strong></p>' +
        '<p class="modal-note">当日は受付にてこの QR コードをご提示ください。申込の確認・キャンセルはマイページ(モック未実装)から行えます。</p>' +
        '<button class="modal-primary" type="button" data-action="close">閉じる</button>';
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
    document.querySelectorAll('.status-pill').forEach(function (t) {
      t.classList.toggle('is-active', t === btn);
    });
    render();
  });

  /* ---------- 初期化 ---------- */

  applyTheme(state.category);
  updateCounts();
  renderMonthNav();
  renderDateStrip();
  render();
})();
