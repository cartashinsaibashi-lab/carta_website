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
    openedId: null,
    openedTab: null,                    // 開いているカードで選択中のタブ(再描画をまたいで保持)
    seatTable: null,                    // 座席表で選択中のテーブル番号(ライブ更新をまたいで保持)
    /* 着席者一覧の並び順。人を探す用途なので既定は名前の昇順。
     * ライブ更新のたびに一覧を作り直すため、選んだ並び順はここに持って引き継ぐ。 */
    seatSort: { key: 'player', dir: 1 },
    seatListOpen: true                  // 着席者一覧の開閉(同じくライブ更新をまたいで保持)
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

  /* ライブのレベル残り秒。endsAt(絶対時刻)があれば現在時刻から算出して
     取得ラグ/キャッシュ古さを自己補正、無ければスナップショット値を使う。 */
  function remainSec(endsAt, fallback) {
    return endsAt != null && isFinite(endsAt)
      ? Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      : (fallback || 0);
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

  /* Level Length。API の levelMinutes が空でも、ストラクチャーの Lv.1 から拾う。 */
  function levelMinutesOf(ev) {
    if (ev.levelMinutes) return ev.levelMinutes;
    var first = (ev.structure || []).find(function (r) { return r.type === 'level'; });
    return first ? first.minutes : 0;
  }

  /* ストラクチャー Lv.1 の BB。開始スタックが何 BB 分かの計算に使う。
   * 一覧の時点ではストラクチャーが空なので 0 を返し、その場合は BB 表記を出さない。 */
  function firstLevelBB(ev) {
    var first = (ev.structure || []).find(function (r) { return r.type === 'level'; });
    return first ? first.bb : 0;
  }

  /* "10,000 (100BB)"。BB 数はストラクチャー Lv.1 の BB で割った値。
   * 見出しが "Starting Chips" なので単位の "chips" は重ねない。
   * 一覧の時点ではストラクチャーが未取得で BB が分からないため、その場合は枚数だけ出す。 */
  function startingChipsText(ev) {
    var bb = firstLevelBB(ev);
    var chips = num(ev.startingStack);
    return bb > 0 ? chips + ' (' + num(Math.round(ev.startingStack / bb)) + 'BB)' : chips;
  }

  function infoPanel(ev) {
    var mins = levelMinutesOf(ev);
    var rows = [
      ['Date & Time', ev.dateLabel + ' Start'],
      ['Venue', ev.venue],
      /* Buy-in は subscription.buyin.fee のみを表示する(本体・合計は出さない) */
      ['Buy-in', yen(ev.fee)],
      ['Guarantee', ev.guarantee ? yen(ev.guarantee) : 'None'],
      ['Starting Chips', startingChipsText(ev)],
      ['Level Length', mins ? mins + ' min' : '—'],
      /* カードの Reg Close と同じ内容を出す(片方だけ表記が違うと混乱するため) */
      ['Late Reg', regCloseText(ev) || ev.lateReg || '—'],
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
    /* 大会詳細(本番では GET /v1/event/{id} の dailyDetails.levelDescription から取得) */
    var detailsHtml = '';
    if (ev.details && ev.details.length) {
      detailsHtml =
        '<h3 class="detail-notes-title">Details</h3>' +
        '<ul class="detail-notes">' +
        ev.details.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
        '</ul>';
    }
    /* 説明文はティッカー(横に流れる 1 行)で出す。長い説明でもカードの高さを取らない。
     * 文は 1 つだけで、右端から入って左端へ抜けきるまでを 1 周とする。
     * 短くて収まる説明は流さない(判定と速度は syncTickers が行う)。
     * 説明文が未入力の大会(2 割ほどある)では要素ごと出さない。 */
    var descHtml = ev.description
      ? '<div class="event-ticker">' +
        '<div class="event-ticker-track">' +
        '<span class="event-ticker-item">' + esc(ev.description) + '</span>' +
        '</div></div>'
      : '';
    return (
      descHtml +
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
    /* Prize は Prize タブ(GET /v1/event/{id}/payouts)の値に合わせる。
     * 結果一覧(POST /v1/event/{id}/players)が持つ payoutAmount とペイアウト表の
     * 金額が食い違うことがあり、正しいのはペイアウト表のほうなので、順位で引き当てて
     * Prize タブと同じ表記(prizeLabel)を使う。
     * ペイアウト表に無い順位(賞金圏外など)は結果一覧側の値にフォールバックする。 */
    var payoutByPos = {};
    (ev.payouts || []).forEach(function (p) { payoutByPos[p.pos] = p; });

    /* 表示する順位の範囲。参加者全員(数百人になることもある)を出すと縦に長すぎるため、
     * 上位 9 位までを基本にする。ただし賞金が 9 位より下まで出る大会では入賞者が
     * 切れてしまうので、ペイアウト表の最下位まで広げる。
     * 例) ペイアウトが 6 位まで → 9 位まで表示 / 24 位まで → 24 位まで表示 */
    var RESULTS_MIN_PLACES = 9;
    var payoutLast = (ev.payouts || []).reduce(function (m, p) { return Math.max(m, p.pos); }, 0);
    var lastPlace = Math.max(RESULTS_MIN_PLACES, payoutLast);
    var shown = ev.results.filter(function (r) { return r.pos <= lastPlace; });

    /* Points 列はシリーズランキング対象の大会だけ出す(対象外なら全行空欄の列になるため)。
     * ポイントは Prize タブと同じ「順位 → ポイント」から引くので、両タブで値が揃う。 */
    var showPts = hasPoints(ev);

    var body = shown.map(function (r) {
      var posCls = r.pos === 1 ? ' class="row-winner"' : '';
      var medalCls = r.pos <= 3 ? ' pos-' + r.pos : '';
      var prize = payoutByPos[r.pos] ? prizeLabel(payoutByPos[r.pos]) : yen(r.prize);
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + r.pos + '</span></td>' +
        '<td class="col-player">' + esc(r.player) + '</td>' +
        '<td class="col-prize">' + prize + '</td>' +
        (showPts ? '<td class="col-points">' + ptsLabel(ev.points, r.pos) + '</td>' : '') +
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
      '<thead><tr><th>Rank</th><th>Player</th><th>Prize</th>' +
      (showPts ? '<th>Points</th>' : '') + '</tr></thead>' +
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
    var seatsHtml = seatingHtml(ev);
    /* 次の休憩は「あと何分か」が知りたい情報なので、休憩の長さではなく
     * 休憩開始までのカウントダウンを出す。breakAt(絶対時刻)を持たない場合
     * (ストラクチャーに休憩が無い等)は行ごと省く。 */
    var breakHtml = lv.breakAt
      ? '<br>Next break in <span class="live-break-countdown" data-break-timer data-ends-at="' +
        lv.breakAt + '">' + esc(fmtCountdown(lv.breakAt - Date.now())) + '</span>'
      : '';
    return (
      '<div class="live-board">' +
      '  <div class="live-clock">' +
      '    <div class="live-level">LEVEL ' + lv.levelIndex + '</div>' +
      '    <div class="live-timer" data-timer data-remaining="' + lv.remainingSec + '"' +
      (lv.endsAt ? ' data-ends-at="' + lv.endsAt + '"' : '') + '>' + fmtSec(remainSec(lv.endsAt, lv.remainingSec)) + '</div>' +
      '    <div class="live-blinds">' + num(lv.sb) + ' / ' + num(lv.bb) +
      '      <span class="live-ante">ante ' + num(lv.ante) + '</span></div>' +
      '    <div class="live-next">NEXT: ' + esc(lv.nextLevel) + breakHtml + '</div>' +
      '  </div>' +
      '  <div class="live-stats">' +
      liveStat('Entries', num(ev.stats.entries)) +
      liveStat('Remaining Players', num(ev.stats.players)) +
      liveStat('Table', num(lv.tables)) +
      liveStat('Average Stack', num(ev.stats.avgStack) + ' chips') +
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

  /* ---------- 座席表(Seating) ----------
   * 卓を真上から見たイメージで、楕円のテーブルの周りに席を並べる。
   * ディーラー(下辺中央)の位置を空け、そこから時計回りに 1 番席から配置する。
   * 複数卓のときはタブで 1 卓ずつ切り替える(選択はライブ更新をまたいで保持)。 */

  /* 卓に必ず並べる席数。実際の卓は 9 max 運用なので、バストで人数が減っても
   * 9 席分の枠を出したままにする(空いている席は "Empty" 表記)。
   * これより席番号が大きい卓(10 max 等)は maxSeat 側が優先される。 */
  var SEAT_RING_MIN = 9;

  function seatingHtml(ev) {
    if (!ev.seats || !ev.seats.length) return '';
    var tables = groupSeatsByTable(ev.seats);
    var active = activeSeatTable(tables);

    var title = 'Seating (' + num(ev.seats.length) + ' seated' +
      (tables.length > 1 ? ' · ' + tables.length + ' tables' : '') + ')';

    var tabs = tables.length > 1
      ? '<div class="seat-tabs" role="tablist" aria-label="Table">' +
        tables.map(function (t) {
          var on = t.no === active;
          return (
            '<button type="button" class="seat-tab' + (on ? ' is-active' : '') + '"' +
            ' data-table="' + t.no + '" role="tab" aria-selected="' + on + '">' +
            'Table ' + num(t.no) +
            '<span class="seat-tab-count">' + t.seats.length + '</span>' +
            '</button>'
          );
        }).join('') +
        '</div>'
      : '';

    return (
      '<div class="live-seats">' +
      '<h4 class="live-seats-title">' + esc(title) + '</h4>' +
      seatListHtml(ev.seats) +
      tabs +
      tables.map(function (t) { return seatTableHtml(t, t.no === active); }).join('') +
      '</div>'
    );
  }

  /* ---------- 着席者一覧 ----------
   * 卓が多いとタブを 1 つずつ開いて人を探すことになるため、卓タブの上に
   * 全員の一覧を出す。見出しを押すと並び替え、行を押すとその人の卓に切り替わる。 */

  var SEAT_SORT_LABELS = [
    { key: 'player', label: 'Player' },
    { key: 'chips', label: 'Chips' },
    { key: 'seat', label: 'Seat' }
  ];

  /* state.seatSort に従って並べ替える。同値のときは卓→席で固定し、
   * ライブ更新のたびに同点の人の順序が入れ替わらないようにする。 */
  function sortedSeats(seats) {
    var key = state.seatSort.key;
    var dir = state.seatSort.dir;
    return seats.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'player') d = String(a.player).localeCompare(String(b.player), 'ja');
      else if (key === 'chips') d = a.chips - b.chips;
      /* Seat は "卓-席" で表示しているので、並びも卓 → 席の順にする。
       * 席番号だけで並べると 1-9, 2-9, 3-9 … と各卓の同じ席が混ざって読みにくい。 */
      else d = (a.table - b.table) || (a.seat - b.seat);
      if (d !== 0) return d * dir;
      return (a.table - b.table) || (a.seat - b.seat);
    });
  }

  function seatListHtml(seats) {
    var head = SEAT_SORT_LABELS.map(function (c) {
      var on = state.seatSort.key === c.key;
      var arrow = on ? (state.seatSort.dir > 0 ? ' ▲' : ' ▼') : '';
      return (
        '<th class="seat-list-th' + (on ? ' is-sorted' : '') + '" data-sort="' + c.key + '"' +
        ' role="button" tabindex="0" aria-sort="' +
        (on ? (state.seatSort.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
        esc(c.label) + arrow + '</th>'
      );
    }).join('');

    var rows = sortedSeats(seats).map(function (s) {
      return (
        '<tr class="seat-list-row" data-table="' + s.table + '" data-seat="' + s.seat + '"' +
        ' role="button" tabindex="0" title="Table ' + num(s.table) + ' へ移動">' +
        '<td class="seat-list-player">' + esc(s.player) + '</td>' +
        '<td class="seat-list-chips">' + (s.chips > 0 ? num(s.chips) : '—') + '</td>' +
        /* 卓番号 - 席番号("4-9" = テーブル 4 の 9 番席)。
         * 席番号だけでは複数卓のときにどの卓の人か分からないため卓番号も出す。 */
        '<td class="seat-list-seat">' + s.table + '-' + s.seat + '</td>' +
        '</tr>'
      );
    }).join('');

    /* 見出しを押すと一覧ごと開閉できる(座席図だけ見たいときに畳める)。
     * 開閉状態は state に持たせ、ライブ更新で作り直されても保たれるようにする。 */
    var open = state.seatListOpen;
    return (
      '<div class="seat-list-block' + (open ? '' : ' is-collapsed') + '">' +
      '<button type="button" class="seat-list-toggle" aria-expanded="' + open + '">' +
      '<span class="seat-list-caption">Players (' + num(seats.length) + ')</span>' +
      '<span class="seat-list-chevron" aria-hidden="true">▾</span>' +
      '</button>' +
      '<div class="seat-list-wrap">' +
      '<table class="data-table seat-list">' +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '</div>'
    );
  }

  /* 一覧の高さを「見出し + SEAT_LIST_ROWS 人分」に合わせる。
   * 高さを px で決め打ちすると、画面幅で文字サイズが変わったときに
   * 見える人数がずれるため、実際の行の高さを測って決める。 */
  var SEAT_LIST_ROWS = 9;

  function syncSeatList() {
    listEl.querySelectorAll('.seat-list-wrap').forEach(function (wrap) {
      var head = wrap.querySelector('thead');
      var rows = wrap.querySelectorAll('tbody tr');
      if (!head || !rows.length || !wrap.clientWidth) return;
      if (rows.length <= SEAT_LIST_ROWS) { wrap.style.maxHeight = ''; return; }
      var h = head.getBoundingClientRect().height;
      for (var i = 0; i < SEAT_LIST_ROWS; i++) h += rows[i].getBoundingClientRect().height;
      wrap.style.maxHeight = Math.ceil(h) + 'px';
    });
  }

  /* seats[] をテーブル番号ごとにまとめる(卓番号の昇順) */
  function groupSeatsByTable(seats) {
    var byNo = {};
    var tables = [];
    seats.forEach(function (s) {
      var no = Number(s.table) || 0;
      if (!byNo[no]) { byNo[no] = { no: no, seats: [] }; tables.push(byNo[no]); }
      byNo[no].seats.push(s);
    });
    tables.sort(function (a, b) { return a.no - b.no; });
    return tables;
  }

  /* 選択中の卓。保持していた卓が今の座席表に無ければ先頭の卓に戻す
   * (卓の統合やブレイクで消えることがあるため) */
  function activeSeatTable(tables) {
    var want = Number(state.seatTable);
    var kept = tables.some(function (t) { return t.no === want; });
    return kept ? want : tables[0].no;
  }

  function seatTableHtml(t, isActive) {
    /* 席数は「その卓で確認できる最大の席番号」を上限とみなす。
     * 空いている番号はバスト等による空席として席だけ描く。 */
    var maxSeat = t.seats.reduce(function (m, s) { return Math.max(m, Number(s.seat) || 0); }, 0);
    var ring = Math.max(maxSeat, t.seats.length, SEAT_RING_MIN);
    var taken = {};
    t.seats.forEach(function (s) { taken[Number(s.seat)] = s; });

    var nodes = '';
    for (var no = 1; no <= ring; no++) nodes += seatNodeHtml(taken[no], no, ring);

    return (
      '<div class="seat-table' + (isActive ? ' is-active' : '') + '" data-table-view="' + t.no + '">' +
      '<div class="seat-ring">' +
      '<div class="seat-felt">' +
      '<span class="seat-felt-label">TABLE</span>' +
      '<span class="seat-felt-no">' + num(t.no) + '</span>' +
      '<span class="seat-felt-sub">' + t.seats.length + ' players</span>' +
      '</div>' +
      '<div class="seat-dealer" ' + seatPos(0, ring) + '>DEALER</div>' +
      nodes +
      '</div></div>'
    );
  }

  function seatNodeHtml(s, no, ring) {
    if (!s) {
      return (
        '<div class="seat-node is-empty" ' + seatPos(no, ring) + '>' +
        '<span class="seat-dot">' + no + '</span>' +
        '<span class="seat-player">Empty</span>' +
        '</div>'
      );
    }
    return (
      '<div class="seat-node" ' + seatPos(no, ring) + '>' +
      '<span class="seat-dot">' + no + '</span>' +
      '<span class="seat-player" title="' + esc(s.player) + '">' + esc(s.player) + '</span>' +
      '<span class="seat-chips">' + (s.chips > 0 ? num(s.chips) : '') + '</span>' +
      '</div>'
    );
  }

  /* 説明文ティッカーの「流す/流さない」と速度を決める。
   * 文がコンテナに収まるなら流さない(短い説明が意味もなく動くのを避ける)。
   * 流す場合は文の長さに比例した時間を与え、どの大会でもだいたい同じ速さ
   * (約 60px/秒 = 日本語で 1 秒に 4 文字強)で読めるようにする。
   * 非表示のタブは幅が 0 で測れないため触らない(タブを開いたときに再度呼ばれる)。 */
  var TICKER_PX_PER_SEC = 60;

  function syncTickers() {
    listEl.querySelectorAll('.event-ticker').forEach(function (el) {
      var track = el.querySelector('.event-ticker-track');
      var item = track && track.firstElementChild;
      if (!item || !el.clientWidth) return;
      var boxPx = el.clientWidth;
      var textPx = item.getBoundingClientRect().width;
      var scrolling = textPx > boxPx;
      el.classList.toggle('is-scrolling', scrolling);
      if (!scrolling) {
        track.style.animationDuration = '';
        return;
      }
      /* コンテナの右端の外(+boxPx)から、左端の外(-textPx)まで動かす。
       * 1 周で動く距離はその合計で、一定の速さで割って所要時間を出す。
       * こうすると説明の長短にかかわらず読む速さが変わらない。 */
      el.style.setProperty('--ticker-from', boxPx + 'px');
      el.style.setProperty('--ticker-to', -textPx + 'px');
      track.style.animationDuration =
        Math.max(8, Math.round((boxPx + textPx) / TICKER_PX_PER_SEC)) + 's';
    });
  }

  /* 卓タブの横スクロール位置を選択中の卓に合わせる。
   * ライブ更新でタブ列ごと作り直されるため、描画のたびに呼んで表示位置を復元する。 */
  function syncSeatTabScroll() {
    document.querySelectorAll('.seat-tabs').forEach(function (strip) {
      var on = strip.querySelector('.seat-tab.is-active');
      if (!on) return;
      strip.scrollLeft = Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2);
    });
  }

  /* 楕円上の位置。slot 0 = ディーラー(下辺中央)、1..ring = 席番号。
   * 実際の座り方に合わせて、ディーラーの左隣(左下)を 1 番席として時計回りに進む。
   * sin/cos だけを渡し、席カードの大きさ分を差し引く計算は CSS 側で行う。 */
  function seatPos(slot, ring) {
    var th = 2 * Math.PI * slot / (ring + 1);
    return 'style="--sx:' + (-Math.sin(th)).toFixed(4) + ';--cy:' + Math.cos(th).toFixed(4) + '"';
  }

  /* 賞金分配(Prize)パネル — 開催中・受付中・終了の全大会に共通で表示。
   * GET /v1/event/{id}/payouts の確定ペイアウトを優先し、未設定の大会だけ
   * 標準配分モデルにフォールバックする。 */
  function prizePanel(ev) {
    var pool = ev.stats.prizePool || ev.guarantee || 0;   // 受付中は保証賞金を基準に表示
    var poolKnown = pool > 0;
    var poolLabel = ev.status === 'future' ? 'Guaranteed Prize Pool' : 'Prize Pool';
    var summary =
      '<div class="result-summary">' +
      summaryItem(poolLabel, poolKnown ? yen(pool) : 'TBD') +
      summaryItem('Guarantee', ev.guarantee ? yen(ev.guarantee) : 'None') +
      summaryItem('In the Money', ev.stats.itm > 0 ? ev.stats.itm + ' players' : 'TBD') +
      '</div>';

    /* ポイントは確定ペイアウトがある大会にだけ添える。標準配分モデル(payouts 未設定)は
     * 賞金そのものが見込み値なので、実際に付いたポイントを並べると意味が食い違う。 */
    var table = (ev.payouts && ev.payouts.length)
      ? payoutTable(ev.payouts, hasPoints(ev) ? ev.points : null)
      : modelPayoutTable(pool, poolKnown);

    return summary + '<h3 class="detail-notes-title">Payout</h3>' + table;
  }

  /* 順位セル。上位 3 位はメダル表示 */
  function placeCell(row) {
    if (row.pos <= 3) {
      return '<td class="col-pos"><span class="pos-medal pos-' + row.pos + '">' + row.pos + '</span></td>';
    }
    return '<td class="col-pos">' + row.pos + '</td>';
  }

  /* ペイアウト 1 行分の Prize 表記。現物賞品(description: "4 Tickets" 等)があれば
   * それを、無ければ金額を出す。Prize タブと Results タブで同じ表記にするため、
   * 両方からこの関数を呼ぶ。 */
  function prizeLabel(p) {
    return p.description ? esc(p.description) : (p.amount ? yen(p.amount) : '—');
  }

  /* シリーズランキングのポイント表記。ポイントは整数とは限らないので(実データに
   * 46.8 / 83.2 / 330.6 がある)、桁区切りだけ付けて小数はそのまま出す。
   * ランキング対象の大会でも、入賞圏外の順位にはポイントが付かないので空欄になる。 */
  function ptsLabel(points, pos) {
    var v = points && points[pos];
    return v == null ? '—' : num(v) + ' pt';
  }

  /* 大会にランキングポイントが付いているか。付いていない大会(シリーズ対象外)では
   * Points 列そのものを出さない — 全行が空欄の列を作らないため。 */
  function hasPoints(ev) {
    return !!(ev.points && Object.keys(ev.points).length);
  }

  /* 確定ペイアウト表(Place / Prize [/ Points])。
   * Prize 列は description(現物賞品: "4 Tickets" / "1E × 2,000P")を優先し、
   * 無い大会(現金のみ)は金額を出す — prizeLabel() 参照。
   *
   * 配分率(Share)列は出さない。「Prize タブに % を出さない」という運営の指示による
   * (PR #35 のレビュー指摘)。もともと percentage を持つ大会だけ出す作りだったが、
   * 実データでは percentage が常に 0 で(サンプル 20 大会すべて 0)、live では
   * 一度も表示されない列だった。 */
  function payoutTable(payouts, points) {
    var showPts = !!points;

    var rows = payouts.map(function (p) {
      var posCls = p.pos === 1 ? ' class="row-winner"' : '';
      var prize = prizeLabel(p);
      return (
        '<tr' + posCls + '>' +
        placeCell(p) +
        '<td class="col-prize">' + prize + '</td>' +
        (showPts ? '<td class="col-points">' + ptsLabel(points, p.pos) + '</td>' : '') +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="table-scroll prize-scroll"><table class="data-table prize-table">' +
      '<thead><tr><th>Place</th><th>Prize</th>' +
      (showPts ? '<th>Points</th>' : '') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>'
    );
  }

  /* ペイアウト未設定(payouts が空)の大会向けの標準配分モデル。
   * 賞金総額に配分率を掛けた「目安の金額」だけを出し、配分率そのものは出さない
   * (Prize タブに % を出さないという運営の指示。PR #35 のレビュー指摘)。
   *
   * 賞金総額が分からない大会では表ごと出さない。従来は全行の金額が「—」のまま
   * 配分率だけが並び、開催予定の全大会(実データで 28 件すべて prizePool も
   * guarantee も 0)が「架空の % が並ぶだけの表」になっていた。 */
  function modelPayoutTable(pool, poolKnown) {
    if (!poolKnown) {
      return '<p class="reg-note prize-note">* Payouts appear here once they are confirmed for this event.</p>';
    }

    var model = [
      [1, 0.240], [2, 0.150], [3, 0.105], [4, 0.078], [5, 0.060],
      [6, 0.046], [7, 0.036], [8, 0.028], [9, 0.022]
    ];
    var restPct = 0.235;   // 10 位以降の合計
    function prizeCell(v) { return yen(Math.round(pool * v / 1000) * 1000); }

    var rows = model.map(function (p) {
      var posCls = p[0] === 1 ? ' class="row-winner"' : '';
      var medalCls = p[0] <= 3 ? ' pos-' + p[0] : '';
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + p[0] + '</span></td>' +
        '<td class="col-prize">' + prizeCell(p[1]) + '</td>' +
        '</tr>'
      );
    }).join('');
    rows +=
      '<tr><td class="col-pos">10+</td>' +
      '<td class="col-prize">' + prizeCell(restPct) + '</td></tr>';

    return (
      '<div class="table-scroll prize-scroll"><table class="data-table prize-table">' +
      '<thead><tr><th>Place</th><th>Prize</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p class="reg-note prize-note">* Estimated payout model. The confirmed structure appears here once payouts are set for this event.</p>'
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

  /* レジストレーション締切の表記 "17:00 (Lv.8)"(締切時刻 + レイトレジ終了レベル)。
   * カードの Reg Close 列と Info タブの Late Reg 行で同じ内容を出すため共通化している。
   * 時刻もレベルも分からない大会では空文字。 */
  function regCloseText(ev) {
    var m = /Lv\.?\s*(\d+)/i.exec(ev.lateReg || '');
    var lv = m ? 'Lv.' + m[1] : '';
    var t = ev.regCloseTime || '';
    return t ? (t + (lv ? ' (' + lv + ')' : '')) : lv;
  }

  /* START 行の 2 列目。参照デザイン: "Reg Close 17:00 (Lv.8)"(時刻 + レジクロレベル) */
  function headSecondStat(ev) {
    var mins = levelMinutesOf(ev);
    var minsLabel = mins ? mins + '-min' : '—';
    if (ev.status === 'past') return { k: 'Levels', v: minsLabel };
    return { k: 'Reg Close', v: regCloseText(ev) || minsLabel };
  }

  /* カード用 Players 表示("現在 / 総数")。
     running = 残りプレイヤー / 総エントリー、future = 登録 / 定員。
     総数が不明(0)のときは 1 数値のみ表示。 */
  function playersStat(ev) {
    var cur, max;
    if (ev.status === 'running') {
      cur = num(ev.stats.players); max = num(ev.stats.entries);
    } else if (ev.registration) {
      cur = num(ev.registration.entries); max = num(ev.registration.cap);
    } else {
      cur = num(ev.stats.entries); max = 0;
    }
    // 定員が 1 以下(未設定/無制限)のときは総数を出さず現在数のみ
    return { k: 'Players', v: max > 1 ? (cur + ' / ' + max) : String(cur) };
  }

  function headStat(k, v) {
    return '<span class="card-stat"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></span>';
  }

  function cardHtml(ev) {
    var tabs = tabsFor(ev);
    var opened = state.openedId === ev.id;

    /* 選択中のタブ。詳細ロード後の再描画でも選択が Info に戻らないよう state から復元する
     * (?event= の直リンクでは、開いた直後にタブを押しても押し直しにならないようにする)。
     * 対象カード以外・タブが存在しない場合は先頭タブ。 */
    var activeKey = tabs[0] && tabs[0].key;
    if (opened && state.openedTab) {
      var found = tabs.some(function (t) { return t.key === state.openedTab; });
      if (found) activeKey = state.openedTab;
    }

    var tabButtons = tabs.map(function (t) {
      return (
        '<button class="detail-tab' + (t.key === activeKey ? ' is-active' : '') + '" data-tab="' + t.key + '">' +
        esc(t.label) + '</button>'
      );
    }).join('');

    var tabPanels = tabs.map(function (t) {
      return (
        '<div class="detail-panel' + (t.key === activeKey ? ' is-active' : '') + '" data-panel="' + t.key + '">' +
        panelHtml(ev, t.key) +
        '</div>'
      );
    }).join('');

    var fav = isFav(ev.id);
    var sp = headStatus(ev);
    var dt = splitDateTime(ev.dateLabel);
    var sec = headSecondStat(ev);
    var pl = playersStat(ev);
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
      /* Buy-in は Info タブと揃えて fee のみを表示する */
      '      <div class="card-line">' + headStat('Buy-in', yen(ev.fee)) + headStat('Chips', num(ev.startingStack)) + headStat(pl.k, pl.v) + '</div>' +
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
    syncSeatTabScroll();
    syncSeatList();
    syncTickers();
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
          if (d.payouts) ev.payouts = d.payouts;
          // ランキングポイント(順位 → ポイント)。一覧には含まれず詳細でだけ返る
          if (d.points) ev.points = d.points;
          // 一覧では levels を取らないため levelMinutes が 0 のことがある。
          // 詳細(= ストラクチャー Lv.1 由来)の値で上書きする。
          if (d.levelMinutes) ev.levelMinutes = d.levelMinutes;
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
   * 25 秒ごとに全体 render() を走らせるのは重いので、Live パネルだけ差し替える。 */

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
    if (d.payouts) ev.payouts = d.payouts;
    if (d.levelMinutes) ev.levelMinutes = d.levelMinutes;
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
    syncSeatTabScroll();
    syncSeatList();
  }

  /* fresh: true でブラウザの HTTP キャッシュを迂回する。
   * /api/events/:id は進行中でも max-age=10, stale-while-revalidate=100 を返すため、
   * 素直に fetch するとレベル終了直後の再取得が「まだ前のレベル」の応答をキャッシュから
   * 返してしまい、何度取り直してもタイマーが 00:00 のまま動かない。
   * URL にキャッシュ避けのクエリは付けない。全員のレベルがほぼ同時に終わる性質上、
   * 一意な URL にすると CDN が効かず関数へのアクセスが集中するため。
   * CDN 側は最大 10 秒古い可能性があるので、呼び出し側で数秒おきに数回試す。 */
  function pollLiveOnce(id, opts) {
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return Promise.resolve();
    var fresh = opts && opts.fresh;
    return fetch('/api/events/' + encodeURIComponent(id), {
      headers: { Accept: 'application/json' },
      cache: fresh ? 'no-store' : 'default'
    })
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

  /* ---------- レベル終了時の追い取得 ----------
   * ブラインドタイマーが 00:00 になっても、次の通常ポーリング(25秒間隔)まで待つと
   * その間ずっと 00:00 が表示されたままになる。終了を検知したらすぐ取り直し、
   * 次のレベルが見えるまで短い間隔で数回だけ追いかける。
   *
   * 1 レベルにつき 1 回だけ起動する(levelEndPendingFor)。取得後は Live パネルを
   * 描き直すため、そこで作られる新しいタイマーも即座に 00:00 を検知してしまい、
   * 抑止しないと毎秒取得し続けることになる。 */

  var LIVE_END_RETRY_MS = 5000;   // CDN のキャッシュ(最大10秒)が切れる頃に再度試す
  var LIVE_END_RETRY_MAX = 6;     // 30 秒あきらめずに追う。以降は通常ポーリングに任せる
  var levelEndRetryTimer = null;
  var levelEndPendingFor = null;  // 追い取得中のレベル番号(多重起動の抑止)

  function stopLevelEndRetry() {
    if (levelEndRetryTimer) { clearTimeout(levelEndRetryTimer); levelEndRetryTimer = null; }
    levelEndPendingFor = null;
  }

  /* レベル終了を検知したときに呼ぶ。prevIndex は終了したレベルの番号。 */
  function refetchAfterLevelEnd(id, prevIndex, attempt) {
    if (levelEndRetryTimer) { clearTimeout(levelEndRetryTimer); levelEndRetryTimer = null; }
    if (state.openedId !== id || document.hidden) { levelEndPendingFor = null; return; }

    pollLiveOnce(id, { fresh: true }).then(function () {
      var ev = findEvent(id);
      if (!ev || state.openedId !== id || ev.status !== 'running') { levelEndPendingFor = null; return; }
      // レベルが進んだ(番号が変わった / 残り時間が戻った)なら追いかけ終了
      var live = ev.live || {};
      var advanced = live.levelIndex !== prevIndex ||
        (live.endsAt != null && live.endsAt - Date.now() > 1000);
      if (advanced || attempt >= LIVE_END_RETRY_MAX) { levelEndPendingFor = null; return; }
      levelEndRetryTimer = setTimeout(function () {
        refetchAfterLevelEnd(id, prevIndex, attempt + 1);
      }, LIVE_END_RETRY_MS);
    });
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
    stopLevelEndRetry();
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
    if (state.openedId !== id) {
      state.openedTab = null;  // 別カードを開いたらタブ選択はリセット
      state.seatTable = null;  // 座席表の卓選択も引き継がない
    }
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
          state.openedTab = null;
          state.seatTable = null;
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
          if (card.dataset.id === state.openedId) state.openedTab = key; // 再描画をまたいで保持
          card.querySelectorAll('.detail-tab').forEach(function (t) {
            t.classList.toggle('is-active', t === tab);
          });
          card.querySelectorAll('.detail-panel').forEach(function (p) {
            p.classList.toggle('is-active', p.dataset.panel === key);
          });
          syncTickers(); // 非表示のうちは幅が測れないので、表示された時点で測り直す
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

  /* 卓の表示を切り替える(タブ本体と座席図の両方)。卓タブと着席者一覧の行の
   * どちらからも呼ばれる。再描画は伴わないので、開いているカードの状態は保たれる。 */
  function activateSeatTable(wrap, tableNo) {
    state.seatTable = Number(tableNo);
    var key = String(tableNo);
    wrap.querySelectorAll('.seat-tab').forEach(function (t) {
      var on = t.dataset.table === key;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });
    wrap.querySelectorAll('.seat-table').forEach(function (v) {
      v.classList.toggle('is-active', v.dataset.tableView === key);
    });
    syncSeatTabScroll();
  }

  /* 座席図が見える位置まで画面をスクロールする。
   * 着席者一覧から人を選んだときは、座席図が一覧の下にあって画面外なことが多く、
   * 卓を切り替えても何も起きていないように見えるため。
   * 卓タブがあればそこを頭に合わせる(どの卓を見ているかが分かるように)。
   * 固定表示されるヘッダーとフィルタバーの下に来るよう、その高さ分を差し引く。 */
  function scrollSeatViewIntoView(wrap) {
    var target = wrap.querySelector('.seat-tabs') ||
      wrap.querySelector('.seat-table.is-active');
    if (!target) return;
    var header = document.querySelector('.site-header');
    var bar = document.querySelector('.filter-bar');
    var stuck = (header ? header.offsetHeight : 0) + (bar ? bar.offsetHeight : 0) + 12;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var y = target.getBoundingClientRect().top + window.pageYOffset - stuck;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  }

  /* 座席表まわりの操作。ライブ更新でパネルごと差し替わるため、カードではなく
   * 一覧に 1 つだけ委譲リスナーを置いてバインドが外れないようにする。 */
  listEl.addEventListener('click', function (e) {
    var wrap = e.target.closest('.live-seats');
    if (!wrap) return;

    // 着席者一覧の開閉。再描画せずクラスの付け外しだけで済ませる
    var toggle = e.target.closest('.seat-list-toggle');
    if (toggle) {
      state.seatListOpen = !state.seatListOpen;
      var block = toggle.closest('.seat-list-block');
      block.classList.toggle('is-collapsed', !state.seatListOpen);
      toggle.setAttribute('aria-expanded', state.seatListOpen);
      if (state.seatListOpen) syncSeatList(); // 畳んでいる間は測れないので開いた時点で測る
      return;
    }

    // 卓タブ
    var tab = e.target.closest('.seat-tab');
    if (tab) { activateSeatTable(wrap, tab.dataset.table); return; }

    // 着席者一覧の見出し: 同じ列を押したら昇順⇔降順、別の列なら昇順から
    var th = e.target.closest('.seat-list-th');
    if (th) {
      var key = th.dataset.sort;
      state.seatSort = state.seatSort.key === key
        ? { key: key, dir: -state.seatSort.dir }
        : { key: key, dir: 1 };
      var card = wrap.closest('.event-card');
      if (card) updateLivePanel(card.dataset.id); // 並べ替えた一覧で描き直す
      return;
    }

    // 着席者一覧の行: その人が座っている卓に切り替えて、座席図まで移動する
    var row = e.target.closest('.seat-list-row');
    if (row) {
      activateSeatTable(wrap, row.dataset.table);
      scrollSeatViewIntoView(wrap);
    }
  });

  /* 一覧の見出し・行はキーボードでも操作できるようにする(role="button" 相当) */
  listEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var hit = e.target.closest('.seat-list-th, .seat-list-row');
    if (!hit) return;
    e.preventDefault();
    hit.click();
  });

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
      var endsAt = el.dataset.endsAt ? parseInt(el.dataset.endsAt, 10) : null;
      var fallback = parseInt(el.dataset.remaining, 10) || 0;
      var remaining = remainSec(endsAt, fallback);
      el.textContent = fmtSec(remaining); // 初期表示も endsAt 基準に補正
      var t = setInterval(function () {
        // endsAt があれば毎秒「絶対時刻 - 現在」で再計算(ドリフト/古さを自己補正)
        remaining = endsAt != null ? remainSec(endsAt, fallback) : (remaining > 0 ? remaining - 1 : 0);
        el.textContent = fmtSec(remaining);
        if (remaining === 0) {
          clearInterval(t);
          /* レベル終了 → 通常ポーリング(25秒)を待たずに取り直して次レベルへ。
           * 同じレベルで既に追い取得中なら何もしない(下の再描画で毎秒走るのを防ぐ)。 */
          if (livePollId && state.openedId === livePollId && !document.hidden) {
            var cur = findEvent(livePollId);
            var idx = cur && cur.live ? cur.live.levelIndex : -1;
            if (levelEndPendingFor !== idx) {
              levelEndPendingFor = idx;
              refetchAfterLevelEnd(livePollId, idx, 1);
            }
          }
        }
      }, 1000);
      timers.push(t);
    });

    /* 次の休憩までのカウントダウン。レベルの残り時間と違って 1 時間を超えることが
     * あるため、fmtSec(MM:SS)ではなく fmtCountdown(h:mm:ss)で表示する。
     * 0 まで来たらそのまま止める。次のライブポーリングで新しい breakAt に差し替わる。 */
    listEl.querySelectorAll('[data-break-timer]').forEach(function (el) {
      var endsAt = parseInt(el.dataset.endsAt, 10);
      if (!isFinite(endsAt)) return;
      var tick = function () { el.textContent = fmtCountdown(endsAt - Date.now()); };
      tick();
      timers.push(setInterval(tick, 1000));
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

  /* 種別の切り替え。ヘッダーのタブと、初回表示の選択画面の両方から呼ぶ。 */
  function selectCategory(category) {
    state.category = category;
    state.openedId = null;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.category === category);
    });
    applyTheme(category);
    state.pickerOpen = false;
    renderMonthNav();
    renderDateStrip();
    render();
  }

  document.getElementById('categoryTabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.category-tab');
    if (!btn) return;
    selectCategory(btn.dataset.category);
  });

  /* ---------- 初回表示の種別選択 ----------
   * どのシリーズを見るかを最初に選んでもらう。選ぶとその種別の一覧に切り替わる。
   * ?event=<id> で特定の大会を開く場合は種別が決まっているので出さない。 */
  function setupCategoryGate() {
    var gate = document.getElementById('categoryGate');
    if (!gate) return;
    if (new URLSearchParams(location.search).get(OPEN_PARAM)) return;

    gate.hidden = false;
    document.body.classList.add('gate-open'); // 背後をスクロールさせない

    var picking = false; // 連打で演出が二重に走らないようにする
    gate.addEventListener('click', function (e) {
      var btn = e.target.closest('.gate-item');
      if (!btn || picking) return;
      picking = true;
      /* 先に種別を切り替える。テーマ(配色)もここで変わるので、
       * 選択後の演出は選んだシリーズの色で見える。 */
      selectCategory(btn.dataset.category);
      playGateExit(gate, btn);
    });
  }

  /* 選択後の演出。
   *   1) 選択肢と見出しを消し、選んだシリーズのロゴだけを中央に大きく出す
   *   2) 少し見せてから、全体をうっすら消して一覧を表に出す
   * 配色は selectCategory() で既に切り替わっているため、演出も選んだ色になる。
   * 動きを減らす設定では演出せずに閉じる。 */
  /* 中央に出すロゴを、ヘッダーのタブとは別の画像にしたい種別。
   * 宴は地色が和紙色(明るい)なので、白抜きではなく墨色のロゴを使う。 */
  var SPLASH_LOGO = { utage: 'assets/logo-utage.png' };

  var GATE_HOLD_MS = 800;   // ロゴを中央で見せている時間
  var GATE_FLY_MS = 850;    // 右上へ飛んで消えるまで(CSS の transition と揃える)

  function playGateExit(gate, picked) {
    var splash = gate.querySelector('.gate-splash-icon');
    var close = function () {
      gate.hidden = true;
      gate.classList.remove('is-picking', 'is-leaving');
      document.body.classList.remove('gate-open');
      if (splash) { splash.classList.remove('is-flying'); splash.style.transform = ''; }
    };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { close(); return; }

    /* 中央に出すロゴは下地を敷かず、シリーズの地色の上に直接置く。
     * ウルフ(藍紫)とその他(バーガンディ)は地が濃いので白抜きロゴがそのまま映える。
     * 宴だけは地が和紙色(明るい)で白抜きだと見えないため、濃色版に差し替える。 */
    var category = picked.dataset.category;
    var src = SPLASH_LOGO[category];
    if (!src) {
      var icon = document.querySelector(
        '.category-tab[data-category="' + category + '"] .category-tab-icon') ||
        picked.querySelector('.gate-icon');
      src = icon && icon.src;
    }
    if (splash && src) splash.src = src;

    gate.classList.add('is-picking');
    setTimeout(function () {
      flyLogoToHeaderTab(gate, splash, picked.dataset.category, close);
    }, GATE_HOLD_MS);
  }

  /* 中央のロゴを、ヘッダー右上にある同じシリーズのタブまで飛ばしながら消す。
   * 「右上を押せば切り替えられる」と気づいてもらうための目線誘導。
   * 背景だけ先に透明にして一覧を見せ、ロゴは飛び切ってから消える。 */
  function flyLogoToHeaderTab(gate, splash, category, done) {
    gate.classList.add('is-leaving');
    var target = document.querySelector(
      '.category-tab[data-category="' + category + '"] .category-tab-icon');
    if (!splash || !target) { setTimeout(done, GATE_FLY_MS); return; }

    var from = splash.getBoundingClientRect();
    var to = target.getBoundingClientRect();
    /* 拡大(scale)は中心を動かさないので、いまの中心とタブの中心の差がそのまま移動量になる。
     * 縮小率はレイアウト上の大きさ(offsetWidth)に対して求める。 */
    var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    var scale = to.width / (splash.offsetWidth || to.width);

    splash.classList.add('is-flying');
    // 直前の拡大が確定してから飛ばす(同じフレームで書き換えると transition が起きない)
    requestAnimationFrame(function () {
      splash.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
    });

    // 着地するタブを軽く光らせて、押せる場所だと分かるようにする
    var tab = target.closest('.category-tab');
    if (tab) {
      tab.classList.add('is-hinted');
      setTimeout(function () { tab.classList.remove('is-hinted'); }, 1800);
    }
    setTimeout(done, GATE_FLY_MS);
  }

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

  setupCategoryGate();             // 一覧が用意できてから種別の選択画面を出す

  // 初期描画が完了したのでローディングを解除して画面を表示
  document.body.classList.add('app-ready');
})();
