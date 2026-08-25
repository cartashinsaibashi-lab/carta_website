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
    seatListOpen: true,                 // 着席者一覧の開閉(同じくライブ更新をまたいで保持)
    /* 写真まとめ画面(#74)。null = 大会一覧 /
     * { folderId: null } = フォルダ一覧 / { folderId: '...' } = そのフォルダの写真グリッド */
    photoView: null,
    rankingOpen: false                  // 合計ランキングのパネル(#78)を開いているか
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
     取得ラグ/キャッシュ古さを自己補正、無ければスナップショット値を使う。

     切り上げ(ceil)なのは、00:00 を「本当に終わった瞬間」だけに限るため。四捨五入だと
     終了の最大 0.5 秒前に 00:00 と表示されるが、その時点では繰り上げ判定(projectedStep)は
     まだ「終わっていない」と返すので、繰り上げが 1 秒遅れて 00:00 が見えてしまう。
     切り上げなら「表示が 0 になる」と「繰り上げできる」が同じ瞬間に揃う。 */
  function remainSec(endsAt, fallback) {
    return endsAt != null && isFinite(endsAt)
      ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      : (fallback || 0);
  }

  /* ---------- タブ定義 ---------- */

  function tabsFor(ev) {
    var tabs = [];
    if (ev.status === 'running') tabs.push({ key: 'live', label: 'Live' });
    /* 通過日(日をまたぐ大会の最終日以外)はその日の成績が確定しないので、
     * タブ名を Survivors にして「翌日に進む人の一覧」であることを示す(#54)。
     * key は 'results' のまま — 再描画をまたいで選択タブを覚える state.openedTab や
     * 既存のパネル分岐がこのキーを使っており、変えると開き直しでタブが Info に戻る。 */
    if (ev.status === 'past') {
      tabs.push({ key: 'results', label: ev.carryOver ? 'Survivors' : 'Results' });
    }
    tabs.push({ key: 'info', label: 'Info' });
    /* Prize タブは通過日にも出す。#44 で一度隠したが、あれは「通過日の Results に
     * 賞金を出さない」という話で、ペイアウト表そのものは通過日にも見たい(運営の指定)。
     * この日のレコードに紐づくペイアウトは大会全体のもので、賞金額としては正しい。 */
    tabs.push({ key: 'prize', label: 'Prize' });
    tabs.push({ key: 'structure', label: 'Structure' });
    /* 写真タブは Drive に写真があった大会にだけ出す。写真は運営が任意で上げるもので、
     * 大半の大会には無いため、常設すると「開いても空」のタブばかりになる。
     * ev.photos は /api/photos/:id を取得したあとに入る(取得前・0 枚なら出ない)。
     *
     * 並びは必ず一番右。出たり出なかったりするタブなので、途中に挟むと大会ごとに
     * Info / Prize / Structure の位置がずれて押し間違えるため(運営の指定)。
     * 遅れて出てくるタブでもあり、後ろに足すぶんには既存タブの位置が動かない。 */
    if (ev.photos && ev.photos.length) tabs.push({ key: 'photos', label: 'Photos' });
    return tabs;
  }

  /* ---------- 各パネルの HTML ---------- */

  /* Lv.1 の分数。API の levelMinutes が空でも、ストラクチャーの Lv.1 から拾う。 */
  function levelMinutesOf(ev) {
    if (ev.levelMinutes) return ev.levelMinutes;
    var first = (ev.structure || []).find(function (r) { return r.type === 'level'; });
    return first ? first.minutes : 0;
  }

  /* Info タブの Level Duration 表記。後半でレベルが短くなる大会は "25 / 20 min" と併記する。
   *
   * 実データ(全 932 大会の levels)では 79% が途中でレベル長を変える。内訳は
   * 20→15(349 件)/ 15→12(294 件)/ 25→20(53 件)などで、変わり目はおおむね Lv.8 前後。
   * そこで運営の指定(#52)どおり **Lv.1 と Lv.18 を比べる**。Lv.18 が無い(=レベル数が
   * 17 以下の短い大会)か Lv.1 と同じ長さなら Lv.1 だけを出す。
   * 全レベルを並べない理由は、"CHEETAH" ULTIMATE TURBO のように 20→18→16→…→2 と
   * 1 レベルずつ短くなる大会があり、そのまま並べると読めなくなるため。
   *
   * ストラクチャーが届くまでは「—」を出す。一覧が持つ ev.levelMinutes は API の
   * dailyDetails.levelMinutes(大会に 1 つだけの設定値)で、実データ 932 大会のうち
   * 114 件が実際のレベルと食い違う(全レベル 20 分の大会が 30、全レベル 25 分の大会が
   * 10 など)。つなぎで出すと誤った分数を見せることになるので、値が確定するまで出さない。
   * 詳細が届いた再描画で正しい表記に変わる。 */
  function levelDurationText(ev) {
    var levels = (ev.structure || []).filter(function (r) { return r.type === 'level'; });
    if (!levels.length) return '—';
    var first = levels[0].minutes;
    var lv18 = levels.find(function (r) { return r.level === 18; });
    var later = lv18 ? lv18.minutes : 0;
    if (!first) return '—';
    return (later && later !== first ? first + ' / ' + later : first) + ' min';
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

  /* Info タブの Entries 表記。
   *
   * 日をまたぐ大会は 2 日目以降を「その日の参加者 / 大会全体の参加者」で出す(#54)。
   * 実データ(#3 MAIN EVENT / 2026-05-27〜31)では Day 2 が 59 / 330、Day 3 が 9 / 330。
   * Day 1 の各フライトと単日大会は大会全体の数だけを出す(Day 1A なら自分の 66 ではなく
   * 大会全体の 330 — 運営の指定)。
   *
   * 分母は stats.entriesTotal(= totalEntriesGlobal)。Day 1 のレコードでは
   * stats.entries が自フライトの数(66)になるため、そちらは使わない。 */
  function entriesText(ev) {
    var st = ev.stats || {};
    var total = st.entriesTotal || st.entries || 0;
    if (ev.dayNo >= 2 && st.entriesDay) return num(st.entriesDay) + ' / ' + num(total);
    return num(total);
  }

  function infoPanel(ev) {
    var rows = [
      ['Date & Time', ev.dateLabel + ' Start'],
      ['Venue', ev.venue],
      /* Buy-in は subscription.buyin.fee のみを表示する(本体・合計は出さない) */
      ['Buy-in', yen(ev.fee)],
      ['Guarantee', ev.guarantee ? yen(ev.guarantee) : 'None'],
      ['Starting Chips', startingChipsText(ev)],
      ['Level Duration', levelDurationText(ev)],
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
      rows.push(['Entries', entriesText(ev)]);
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
      /* structure-scroll: 枠線を表の幅に合わせて縮めるための目印(css 側で使う)。
       * 他タブの表は全幅のままなので、共通の table-scroll には持たせない。 */
      '<div class="table-scroll structure-scroll"><table class="data-table structure-table">' +
      '<thead><tr><th>Lv</th><th>Blinds (SB/BB)</th><th>Ante</th><th>Time</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  }

  function resultsPanel(ev) {
    /* 通過日は入賞者がまだ決まっていないので In the Money を出さず、
     * 代わりに「翌日へ進む人数」を Remaining として出す(運営の指定)。
     * 人数は下の表と同じ条件(busted=false)で数えて、見出しと中身を必ず一致させる。 */
    var remaining = ev.carryOver
      ? ev.results.filter(function (r) { return !r.busted; }).length
      : 0;
    var summary =
      '<div class="result-summary">' +
      summaryItem('Total Entries', num(ev.stats.entries)) +
      summaryItem('Prize Pool', yen(ev.stats.prizePool)) +
      (ev.carryOver
        ? summaryItem('Remaining', num(remaining) + ' players')
        : summaryItem('In the Money', ev.stats.itm + ' players')) +
      '</div>';

    /* 通過日(日をまたぐ大会の最終日以外)は賞金ではなく翌日へ持ち込むチップを出す。 */
    return summary + (ev.carryOver ? carryOverTable(ev) : finalResultTable(ev));
  }

  /* 通過日の結果表(Rank / Player / Chips)。
   * その日に確定した賞金は存在しない。レコードに紐づく payout は**大会全体の最終成績**の
   * ものなので(実データで Day 1A のレコードに最終日の賞金が入っていた)、出すと順位と
   * 噛み合わずちぐはぐになる。代わりに翌日へ持ち込むスタックを出す(#44)。
   *
   * 表示するのは chips を持っている人 = 翌日へ進む人だけで、人数の上限は設けない。
   * 通過者は全員が「翌日の参加者」なので、9 位などで切ると誰が残っているのか
   * 分からなくなるため。実データでは 12 名程度。 */
  function carryOverTable(ev) {
    /* 翌日に参加する人 = まだバストしていない人。以前は chips > 0 で絞っていたが、
     * 実データ 70 レコード中 1 件(2026-04-24 #1 MAIN EVENT DAY 1B)だけ
     * busted=true なのにチップが残っている人が居て 1 名多く出ていた。
     * API の生存者定義(stats.totalPlayers)と揃うのは busted のほう(#54)。 */
    var body = ev.results.filter(function (r) { return !r.busted; }).map(function (r) {
      var posCls = r.pos === 1 ? ' class="row-winner"' : '';
      var medalCls = r.pos <= 3 ? ' pos-' + r.pos : '';
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + r.pos + '</span></td>' +
        '<td class="col-player">' + esc(r.player) + '</td>' +
        '<td class="col-chips">' + num(r.chips) + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="table-scroll"><table class="data-table results-table">' +
      '<thead><tr><th>Rank</th><th>Player</th><th>Chips</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  }

  function finalResultTable(ev) {
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
      /* 賞金圏外は「¥0」ではなく「—」。0 円という賞金が出たのではなく賞金が無いだけなので、
       * ポイントが付かない順位を「—」で示すのと表記を揃える。 */
      var prize = payoutByPos[r.pos] ? prizeLabel(payoutByPos[r.pos])
        : (r.prize ? yen(r.prize) : '—');
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

  /* ---------- レベル終了後のローカル繰り上げ ----------
   * タイマーが 00:00 になっても、サーバーが次のレベルを返すまで表示が止まって見える。
   * 実測(2026-08-17 の本番、3 秒間隔): レベル間で 9 秒 / 休憩に入るときで 22 秒。
   * 内訳は /api/events/:id の CDN キャッシュ(最大 10 秒)と PokerLens 側の反映待ちで、
   * どちらも取得側の工夫では縮められない(no-store はブラウザキャッシュしか迂回しない。
   * キャッシュ避けクエリを付けない判断は意図的 — pollLiveOnce() のコメント参照)。
   *
   * そこで手元の ev.structure(進行順のレベル・休憩と各長さ)で先に進めておき、
   * 実データが届いたら上書きする。会場が時計を手動で止めたときはその間だけ先行するが、
   * 次の取得(最長 25 秒)で戻る。 */

  /* 現在の項目が終わっているとき、structure 上で「今どこにいるはずか」を返す。
   * まだ終わっていない / 繰り上げられない(stepIndex が無い・末尾に到達・長さ不明)なら null。 */
  function projectedStep(ev) {
    var lv = ev.live;
    var steps = ev.structure || [];
    /* endsAt が無いときは繰り上げない。一時停止中(lv.paused)は adapter が endsAt を
     * 渡さないので、ここで自動的に止まる — 会場が止めている間に次のレベルへ
     * 進めてしまわないため(#55)。 */
    if (!lv || lv.endsAt == null || lv.stepIndex == null) return null;
    var now = Date.now();
    if (lv.endsAt > now) { ev._rollover = null; return null; }

    /* 繰り上げの基準。一度繰り上げたらその予定を使い回す。
     * サーバーがまだ前の項目を返している間、endsAt は取得のたびに「今」へずれていく
     * (残りが 0 のとき endsAt = status.date = 応答時刻になるため)。毎回サーバー値から
     * 計算し直すと、繰り上げ後のカウントダウンが追い取得のたびに数秒巻き戻って見える。
     * サーバーが実際に次の項目へ進めば stepIndex が変わるので、そこで基準を取り直す。 */
    var pin = ev._rollover;
    var i = pin && pin.fromStep === lv.stepIndex ? pin.index : lv.stepIndex;
    var end = pin && pin.fromStep === lv.stepIndex ? pin.endsAt : lv.endsAt;

    /* タブを長く離れていた等で複数の項目をまたいで遅れていることがあるので、
     * 現在時刻を追い越すまで進める。長さ 0 の項目は進めないので打ち切る(無限ループ防止)。 */
    while (end <= now) {
      i += 1;
      if (i >= steps.length) { ev._rollover = null; return null; }
      var mins = steps[i].minutes || 0;
      if (mins <= 0) { ev._rollover = null; return null; }
      end += mins * 60000;
    }
    ev._rollover = { fromStep: lv.stepIndex, index: i, endsAt: end };
    return { index: i, step: steps[i], endsAt: end };
  }

  /* 表示に使うライブ状態。基本はサーバーの値をそのまま返し、繰り上げが要るときだけ
   * 差し替えた複製を返す(ev.live 自体は書き換えない — 次の取得結果と比較するため)。
   * nextLevel / breakAt の作り方は adapter.mjs の buildLive() に合わせてある。 */
  function liveView(ev) {
    var p = projectedStep(ev);
    if (!p) return ev.live;

    var steps = ev.structure;
    var s = p.step;
    var isBreak = s.type === 'break';
    var k;

    var nextLevel = '';
    for (k = p.index + 1; k < steps.length; k++) {
      if (steps[k].type !== 'break') { nextLevel = 'SB ' + steps[k].sb + ' / BB ' + steps[k].bb; break; }
    }

    var breakAt = null, nextBreak = '', ms = p.endsAt;
    for (k = p.index + 1; k < steps.length; k++) {
      if (steps[k].type === 'break') { breakAt = ms; nextBreak = steps[k].minutes + ' min break'; break; }
      ms += (steps[k].minutes || 0) * 60000;
    }

    return {
      levelIndex: isBreak ? 0 : s.level,
      stepIndex: p.index,
      isBreak: isBreak,
      sb: isBreak ? 0 : s.sb,
      bb: isBreak ? 0 : s.bb,
      ante: isBreak ? 0 : s.ante,
      remainingSec: Math.max(0, Math.round((p.endsAt - Date.now()) / 1000)),
      endsAt: p.endsAt,
      nextLevel: nextLevel,
      nextBreak: nextBreak,
      breakAt: breakAt,
      tables: ev.live.tables
    };
  }

  function livePanel(ev) {
    var lv = liveView(ev);
    var seatsHtml = seatingHtml(ev);
    /* 次の休憩は「あと何分か」が知りたい情報なので、休憩の長さではなく
     * 休憩開始までのカウントダウンを出す。breakAt(絶対時刻)を持たない場合
     * (ストラクチャーに休憩が無い等)は行ごと省く。
     * 休憩中も出さない — 今まさに休憩なのに「次の休憩まで 2:10:34」と出しても
     * 読み手の役に立たず、今の休憩の残り時間(上の大きなタイマー)と紛らわしいため。 */
    var breakHtml = '';
    if (!lv.isBreak && lv.breakAt) {
      breakHtml = '<br>Next break in <span class="live-break-countdown" data-break-timer data-ends-at="' +
        lv.breakAt + '">' + esc(fmtCountdown(lv.breakAt - Date.now())) + '</span>';
    } else if (!lv.isBreak && lv.paused && lv.breakInSec != null) {
      /* 一時停止中は絶対時刻(breakAt)が無いので、止まった時点の残り秒を固定で出す。
       * レベルのタイマーと足並みを揃えるため、こちらも減らさない。 */
      breakHtml = '<br>Next break in <span class="live-break-countdown">' +
        esc(fmtCountdown(lv.breakInSec * 1000)) + '</span>';
    }

    /* 休憩中は見出しを BREAK にし、ブラインド行を出さない。
     * 休憩行の sb/bb/ante は実データでも 0 なので、そのまま出すと「0 / 0 ante 0」という
     * 意味のない表示になる(#38)。休憩明けのブラインドは NEXT 行に出るので情報は落ちない。 */
    var headline = lv.isBreak ? 'BREAK' : 'LEVEL ' + lv.levelIndex;
    var blindsHtml = lv.isBreak ? '' :
      '<div class="live-blinds">' + num(lv.sb) + ' / ' + num(lv.bb) +
      '<span class="live-ante">ante ' + num(lv.ante) + '</span></div>';

    /* 一時停止中はカウントダウンを動かさない。data-timer を付けなければ
     * startTimers() が interval を貼らないので、残り時間が固定表示になる(#55)。
     * Paused バッジはタイマーに重ねて出し、ゆっくり点滅させる(運営の指定)。 */
    var timerAttrs = lv.paused
      ? ''
      : ' data-timer data-remaining="' + lv.remainingSec + '"' + (lv.endsAt ? ' data-ends-at="' + lv.endsAt + '"' : '');
    var pausedHtml = lv.paused ? '<span class="live-paused">Paused</span>' : '';

    return (
      '<div class="live-board">' +
      '  <div class="live-clock' + (lv.paused ? ' is-paused' : '') + '">' +
      '    <div class="live-level">' + headline + '</div>' +
      '    <div class="live-timer-wrap">' +
      '      <div class="live-timer"' + timerAttrs + '>' + fmtSec(remainSec(lv.endsAt, lv.remainingSec)) + '</div>' +
      pausedHtml +
      '    </div>' +
      blindsHtml +
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

  /* 写真パネル。/api/photos/:id が返した一覧をサムネイルのグリッドで並べる。
   * 画像は Google の CDN(lh3.googleusercontent.com)からブラウザが直接読むので、
   * ここを通る通信は URL の一覧だけ。
   * img に width/height を入れているのは、読み込み前から縦横比ぶんの場所を確保して
   * 画面がガタつかないようにするため(縦横が混在するので比率は 1 枚ずつ違う)。 */
  /* サムネイル 1 枚ぶんの HTML。カードの Photos タブと写真まとめ画面(#74)で
   * 同じ見た目・同じ拡大表示を使うため、両方からここを呼ぶ。 */
  function photoThumbsHtml(photos) {
    return photos.map(function (p, i) {
      var size = p.w && p.h ? ' width="' + p.w + '" height="' + p.h + '"' : '';
      return (
        '<button class="photo-thumb" type="button" data-photo="' + i + '" aria-label="' + esc(p.name) + '">' +
        '<img src="' + esc(p.thumb) + '" srcset="' + esc(p.thumb) + ' 1x, ' + esc(p.thumb2x) + ' 2x"' +
        ' alt="' + esc(p.name) + '" loading="lazy" decoding="async"' + size + '>' +
        '</button>'
      );
    }).join('');
  }

  function photosPanel(ev) {
    var photos = ev.photos || [];
    if (!photos.length) return '<p class="reg-note">No photos for this tournament yet.</p>';
    return (
      '<div class="photo-grid" data-photo-event="' + esc(ev.id) + '">' +
      photoThumbsHtml(photos) +
      '</div>'
    );
  }

  function panelHtml(ev, key) {
    switch (key) {
      case 'info': return infoPanel(ev);
      case 'structure': return structurePanel(ev);
      case 'results': return resultsPanel(ev);
      case 'live': return livePanel(ev);
      case 'prize': return prizePanel(ev);
      case 'photos': return photosPanel(ev);
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

  /* 時刻ベースの3段階フェーズ
   *   開始前               : STARTS IN  <開始までのカウントダウン>
   *   開始〜レジクロ       : REG CLOSE IN <レジクロまでのカウントダウン>
   *   レジクロ後           : LIVE
   * API が past を返したら最優先で CLOSED。target を持つ場合はカウントダウン表示。
   *
   * 参照デザインは「開始 1 ヶ月前から」だったが、日数の条件は外した(#46)。
   * ウルフはシリーズごと 1〜2 ヶ月先にまとめて公開されるため、1 ヶ月で切ると
   * 開催予定のカードが常に OPEN のままでカウントダウンが一度も出なかった
   * (本番の開催予定 7 件がすべて 35〜40 日先で該当)。 */
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
      /* 開始前は日数にかかわらずカウントダウン。
       * 受付が閉じている大会も同じで、CLOSED ではなくカウントダウンになる。
       * 1 ヶ月以内の大会では従来からそうなっていたので、遠い大会をそれに揃えた形。
       * 受付状況は Info タブで確認できる。 */
      if (now < start) return { cls: 's-startin', main: 'STARTS IN', sub: '', dot: true, target: start };
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

    return (
      '<article id="event-' + esc(ev.id) + '" class="' + cardClasses(ev, opened) + '" data-id="' + esc(ev.id) + '">' +
      '  <button class="card-head" type="button" aria-expanded="' + opened + '">' + cardHeadInner(ev) + '</button>' +
      '  <div class="card-body">' +
      '    <div class="card-body-inner">' +
      '      <nav class="detail-tabs">' + tabButtons + '</nav>' +
      '      <div class="detail-panels">' + tabPanels + '</div>' +
      '    </div>' +
      '  </div>' +
      '</article>'
    );
  }

  /* カードの class。状態(st-*)は一覧の自動更新でも書き換わるため、
   * 組み立てを 1 か所にまとめて refreshClosedCards() と共用する(#60)。 */
  function cardClasses(ev, opened) {
    return 'event-card st-' + esc(ev.status) + ' cat-' + esc(ev.category) +
      (opened ? ' is-open' : '') + (ev.status === 'past' ? ' is-minimal' : '');
  }

  /* カード見出し(.card-head)の中身。
   * 一覧の自動更新では、閉じているカードのここだけを差し替える(#60)。
   * .card-head 要素自体は残すので、bindCards() が貼ったクリックリスナーは生きたままになる。 */
  function cardHeadInner(ev) {
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

    /* イベント No のバッジ。以前は "No.3" と出していたが、タイトル先頭の "#3" と
     * 同じ意味の情報が 2 か所に出ていたので、バッジ側に寄せて "#3" 表記にした(#58)。
     * 特殊イベントは "#SP2"、サテライトは "#S1"、フライトは "#3/A" のように出る
     * (組み立ては adapter の eventNo())。番号を持たない大会ではバッジごと出さない。 */
    var noBadge = ev.no ? '<span class="card-no">' + esc(ev.no) + '</span>' : '';
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
      '    </div>'
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
    /* 写真まとめを開いている間は大会一覧を作らない(#74)。
     * 同じ listEl を差し替えて使うので、ここで完全に分岐させる。 */
    if (state.photoView) { renderPhotoView(); return; }
    if (state.rankingOpen) { renderRankingView(); return; }
    document.body.removeAttribute('data-view');
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

  /* スクロール位置を保ったまま再描画する(#60)。
   *
   * render() は一覧を innerHTML で丸ごと作り直すため、閲覧中に呼ぶと画面が動く。
   * 高さが変わると自動で位置がずれるので、**開いているカードの画面上の位置を基準**に
   * 取り直す(開いていなければスクロール量をそのまま復元する)。
   * ユーザー操作による再描画(カテゴリ切替・カードを開く)は従来どおり render() を直接呼ぶ。 */
  function renderKeepingView() {
    var openId = state.openedId;
    var el = openId ? document.getElementById('event-' + openId) : null;
    var beforeTop = el ? el.getBoundingClientRect().top : null;
    var beforeY = window.pageYOffset;
    render();
    if (beforeTop != null) {
      var after = document.getElementById('event-' + openId);
      if (after) {
        window.scrollTo(0, window.pageYOffset + (after.getBoundingClientRect().top - beforeTop));
        return;
      }
    }
    window.scrollTo(0, beforeY);
  }

  /* ---------- 一覧の自動更新(#60)----------
   * 一覧は読み込み時の 1 回しか取得しておらず、開きっぱなしだとカードの状態が古いままだった。
   * 60 秒ごとに取り直してマージする。**再描画は極力しない** — render() を呼ぶと
   * スクロールが飛び、開いているカードの中身(座席表のスクロール位置など)も作り直されるため。
   * 並びが変わらない限り、閉じているカードの見出しだけを差し替える。 */
  var LIST_POLL_MS = 60000;
  var listPollTimer = null;

  /* 一覧の応答で上書きしてよい項目。**詳細でしか埋まらないものは触らない** —
   * 一覧は structure / results / payouts を空で返すので、素直に代入すると
   * カードを開いて読み込んだ内容が消える(_detail も 'loaded' のままなので再取得もされない)。 */
  var LIST_MERGE_FIELDS = [
    'category', 'status', 'name', 'no', 'number', 'flight', 'dayNo', 'isFlight', 'summaryId',
    'tags', 'year', 'month', 'day', 'dateLabel', 'startAt', 'regCloseAt', 'regCloseTime',
    'venue', 'buyin', 'fee', 'guarantee', 'startingStack', 'lateReg', 'reentry', 'gameType',
    'description', 'stats', 'registration', 'carryOver'
  ];

  function mergeListEvent(ev, next, isOpen) {
    LIST_MERGE_FIELDS.forEach(function (k) { if (k in next) ev[k] = next[k]; });
    /* levelMinutes は一覧だと dailyDetails 由来で実データと食い違うことがある(#52)。
     * 詳細(ストラクチャー Lv.1 由来)を取得済みなら、そちらを残す。 */
    if (next.levelMinutes && ev._detail !== 'loaded') ev.levelMinutes = next.levelMinutes;
    /* 開いているカードの live はライブポーリング(25 秒 / 停止中 10 秒)のほうが新しいので触らない。 */
    if (!isOpen && next.live) ev.live = next.live;
  }

  function applyListUpdate(list) {
    var beforeIds = visibleEvents().map(function (e) { return e.id; }).join(',');

    var byId = {};
    MOCK_EVENTS.forEach(function (e) { byId[e.id] = e; });
    var merged = list.map(function (n) {
      var cur = byId[n.id];
      if (!cur) return n;                      // 新しく増えた大会
      mergeListEvent(cur, n, cur.id === state.openedId);
      return cur;                              // 既存の参照を保つ(詳細・写真を落とさない)
    });
    // 配列そのものを差し替えず中身を入れ替える(他所が MOCK_EVENTS を掴んでいるため)
    MOCK_EVENTS.length = 0;
    Array.prototype.push.apply(MOCK_EVENTS, merged);

    updateCounts();
    /* パネル(写真まとめ #74 / ランキング #78)を開いている間は描き直さない。
     * 表示しているのは一覧ではないので、作り直すとスクロール位置が戻るだけ。
     * 一覧のデータ自体は上でマージ済み。 */
    if (state.photoView || state.rankingOpen) return;
    if (visibleEvents().map(function (e) { return e.id; }).join(',') !== beforeIds) {
      renderKeepingView();   // カードが増減した / 並びが変わった場合だけ描き直す
    } else {
      refreshClosedCards();  // 通常はこちら。開いているカードには触れない
    }
  }

  /* 閉じているカードの見出しだけを差し替える。
   * .card-head 要素自体は残すので bindCards() のクリックリスナーは生きたまま。
   * 開いているカードは対象外 — 中身を作り直すとタブ選択や座席表のスクロールが戻るため。 */
  function refreshClosedCards() {
    listEl.querySelectorAll('.event-card').forEach(function (card) {
      var id = card.dataset.id;
      if (!id || id === state.openedId) return;
      var ev = findEvent(id);
      if (!ev) return;
      var cls = cardClasses(ev, false);
      if (card.className !== cls) card.className = cls;
      var head = card.querySelector('.card-head');
      if (!head) return;
      var html = cardHeadInner(ev);
      if (head.innerHTML !== html) head.innerHTML = html;
    });
  }

  /* 一覧を取り直す。失敗・0 件のときは今の表示を保つ(空にしない)。
   * 一覧の応答は max-age=30 で、60 秒間隔だと必ず期限切れになる。素直に fetch すると
   * 古い応答を返したうえで裏の再検証がもう 1 本走るので no-store で取る(#55 と同じ理由)。 */
  function refreshList() {
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return Promise.resolve();
    return fetch('/api/events', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.events) && d.events.length) applyListUpdate(d.events);
      })
      .catch(function () {});
  }

  function startListPolling() {
    if (listPollTimer || window.__CARTA_DATA_SOURCE__ !== 'api') return;
    listPollTimer = setInterval(function () {
      if (document.hidden) return;   // タブ非表示中は取りに行かない
      refreshList();
    }, LIST_POLL_MS);
  }

  /* タブに戻ってきたときは次の間隔を待たずに追いつく(#60)。
   * 非表示の間はライブポーリングも一覧の更新も止まっているため、
   * そのままだと最大 25 秒 / 60 秒古い画面を見せることになる。 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || window.__CARTA_DATA_SOURCE__ !== 'api') return;
    refreshList();
    var id = state.openedId;
    var ev = id ? findEvent(id) : null;
    if (!ev || ev.status !== 'running') return;
    /* 予約済みのポーリングを貼り直してから即時取得する。そうしないと、非表示中に
     * 貼られたままだった次の tick が復帰直後に発火して同じ取得が 2 本続けて走る。 */
    startLivePolling(id);
    pollLiveOnce(id, { fresh: true });
  });

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
      /* 写真まとめ(#74)も同じ場所で URL に反映する。値はフォルダ ID か種別
       * (フォルダのグリッドか、その種別のフォルダ一覧か)。 */
      if (state.photoView) params.set(PHOTOS_PARAM, state.photoView.folderId || state.category);
      else params.delete(PHOTOS_PARAM);
      // ランキング(#78)は種別ごとに 1 つなので、値は種別だけでよい
      if (state.rankingOpen) params.set(RANKING_PARAM, state.category);
      else params.delete(RANKING_PARAM);
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
          /* 通過日(日をまたぐ大会の最終日以外)かどうか。これも詳細でだけ返る。
           * false も意味のある値なので、他の項目のような truthy 判定では取りこぼす。 */
          if ('carryOver' in d) ev.carryOver = d.carryOver;
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

  /* 大会写真(/api/photos/:id)を取得して ev.photos に入れる。
   * 詳細(/api/events/:id)とは別のエンドポイントなので取得も別建てにしてある。
   *
   * 一覧の先読み(prefetchVisibleDetails)には混ぜない。写真がある大会は
   * 運営が写真を上げたものだけで全体から見れば少数なので、表示中 12 件ぶんを
   * 先読みすると、ほとんどが「0 枚」という応答のための往復になってしまう。
   *
   * 大会の状態では絞らない。以前は「開催予定の大会は写真がありえない」として
   * future を問い合わせ対象から外していたが、告知画像や会場写真を先に載せたいという
   * 運用があり前提が誤りだった(#48)。実際に開催予定の大会のフォルダを作っても
   * サーバー側は match=exact で写真を返しており、出ないのはここで弾いていたため。
   * 取得はカードを開いたときだけなので、増える通信は開いた 1 件につき 1 回。 */
  function maybeLoadPhotos(id, onDone) {
    var ev = findEvent(id);
    var done = function () { if (onDone) onDone(); };
    if (window.__CARTA_DATA_SOURCE__ !== 'api' || !ev) { done(); return; }
    if (ev._photos === 'loaded') { done(); return; }
    if (ev._photos === 'loading' && ev._photosPromise) { ev._photosPromise.then(done); return; }

    ev._photos = 'loading';
    ev._photosPromise = fetch('/api/photos/' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        ev.photos = (d && !d.error && d.photos) || [];
        ev._photos = 'loaded';
      })
      /* 失敗しても写真タブが出ないだけ。_photos を戻して次に開いたとき再試行させる */
      .catch(function () { ev.photos = []; ev._photos = null; });
    ev._photosPromise.then(done);
  }

  /* カードを開く前に必要なものを揃える。詳細と写真は別エンドポイントなので並行に取る
   * (直列にすると開くまでの待ちがそのぶん延びる)。どちらが失敗しても展開はする。 */
  function loadForOpen(id, onDone) {
    var pending = 2;
    var done = function () { if (--pending === 0) onDone(); };
    maybeLoadDetail(id, done);
    maybeLoadPhotos(id, done);
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
  /* 一時停止中だけポーリングを速める(#55)。
   * 再開は「次の取得で status.code が Running に戻っていること」でしか分からないので、
   * 通常の 25 秒 + CDN キャッシュ 10 秒だと復帰まで最大 35 秒かかり、会場が再開しても
   * タイマーが止まったままに見える。停止中は取得を 10 秒間隔にし、あわせて BFF 側の
   * キャッシュも 5 秒に縮めて(event.mjs)、最大 15 秒で復帰するようにしてある。
   * 停止はカードを開いている間の一時的な状態なので、この間だけ倍の頻度でも負荷は増えない。 */
  var LIVE_POLL_PAUSED_MS = 10000;

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
    /* 通過日(日をまたぐ大会の最終日以外)かどうか。一覧には含まれず詳細でだけ返る。
     * false も意味のある値なので、他の項目のような truthy 判定では取りこぼす。 */
    if ('carryOver' in d) ev.carryOver = d.carryOver;
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
        // 終了 → 全体再描画で状態反映。カードを開いたまま見ているのでスクロールを保つ(#60)
        if (ev.status !== 'running') { stopLivePolling(); renderKeepingView(); return; }
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

    /* setInterval ではなく毎回スケジュールし直す。一時停止/再開で間隔が変わるため、
     * 次の 1 回を「今の状態」に合わせて決める必要がある。 */
    var isPaused = function () {
      var cur = findEvent(id);
      return !!(cur && cur.live && cur.live.paused);
    };
    var tick = function () {
      if (state.openedId !== id) { stopLivePolling(); return; }
      /* タブ非表示中は取得しない(復帰時に間隔ぶん待つだけで、無駄な取得を増やさない)。
       *
       * ライブのポーリングは常に fresh(= ブラウザの HTTP キャッシュを迂回)で取る。
       * 応答は stale-while-revalidate 付きで、ポーリング間隔(25 秒 / 停止中 10 秒)は
       * 必ず max-age(10 秒 / 5 秒)より長いため、素直に fetch すると毎回
       * 「古い応答をそのまま返してから裏で再検証」になっていた。実測すると
       * 1 回のポーリングでネットワークが 2 本走り、しかも画面に入るのは 1 周ぶん古い
       * データという二重の損。BFF は ETag を返さないので再検証も本文込みの 200 が丸ごと流れる。
       * no-store にすれば 1 本で最新が入る。CDN 側のキャッシュ(s-maxage)は効いたままなので
       * PokerLens への負荷は変わらない。 */
      if (!document.hidden) pollLiveOnce(id, { fresh: true });
      schedule();
    };
    var schedule = function () {
      livePollTimer = setTimeout(tick, isPaused() ? LIVE_POLL_PAUSED_MS : LIVE_POLL_MS);
    };
    schedule();
  }

  function stopLivePolling() {
    if (livePollTimer) { clearTimeout(livePollTimer); livePollTimer = null; }
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
        // 開く: API 接続時は詳細と写真の取得完了を待ってから展開する
        // (写真タブの有無はタブの並びを変えるので、取得前に開くとタブが後から増えてしまう)
        var ev = findEvent(id);
        var pending = ev && (ev._detail !== 'loaded' || ev._photos !== 'loaded');
        if (window.__CARTA_DATA_SOURCE__ === 'api' && pending) {
          card.classList.add('is-loading');
          loadForOpen(id, function () {
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

    });
  }

  /* お気に入り(★)トグル — listEl への委譲で扱う。
   *
   * 以前は bindCards() で ★ の要素そのものにリスナーを貼っていたが、一覧の自動更新(#60)で
   * 閉じているカードの見出しを innerHTML ごと差し替えるようになり、差し替えのたびに
   * リスナーが外れて押せなくなっていた(次の全体再描画まで復活しない)。座席表の卓タブと
   * 同じく listEl 側に置けば、中身が何度作り直されても効き続ける。
   *
   * **capture フェーズで拾うのが要点**。★ は .card-head ボタンの内側にあるため、
   * bubble で待つと先にカード展開のリスナーが走ってカードが開いてしまう。
   * capture なら listEl のほうが先に呼ばれるので、そこで stopPropagation して止められる。 */
  function handleFavEvent(e) {
    var btn = e.target && e.target.closest ? e.target.closest('.fav-btn') : null;
    if (!btn) return;
    if (e.type === 'keydown') {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Space でのスクロールを止める
    }
    e.stopPropagation(); // カードの開閉を巻き添えにしない
    storeToggle(FAV_KEY, btn.dataset.fav);
    var fav = isFav(btn.dataset.fav);
    btn.classList.toggle('is-fav', fav);
    btn.textContent = fav ? '★' : '☆';
    btn.setAttribute('aria-pressed', fav);
    // お気に入り絞り込み中に外したらカードが消えるため描き直す(表示位置は保つ)
    if (state.favOnly && !fav) renderKeepingView();
  }
  listEl.addEventListener('click', handleFavEvent, true);
  listEl.addEventListener('keydown', handleFavEvent, true);

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

  /* ---------- 写真の拡大表示 ----------
   * サムネイルを押したら全画面のビューアで大きい画像(full)を出す。
   * サムネイルは render() のたびに作り直されるので、個別に貼らず listEl に委譲する。 */

  var viewerEl = document.getElementById('photoViewer');
  var viewerImg = document.getElementById('photoImage');
  var viewerCap = document.getElementById('photoCaption');
  var viewer = { list: [], index: 0 };

  function showViewerPhoto() {
    var p = viewer.list[viewer.index];
    if (!p) return;
    viewerImg.src = p.full;
    viewerImg.alt = p.name;
    viewerCap.textContent = (viewer.index + 1) + ' / ' + viewer.list.length;
    /* 1 枚しかない大会では前後ボタンを出さない(押しても何も起きないボタンを見せない) */
    var multi = viewer.list.length > 1;
    viewerEl.querySelectorAll('.photo-nav').forEach(function (b) { b.hidden = !multi; });
  }

  function openViewer(photos, index) {
    if (!viewerEl || !photos || !photos.length) return;
    viewer.list = photos;
    viewer.index = index;
    viewerEl.hidden = false;
    document.body.style.overflow = 'hidden'; // 背後の一覧がスクロールしないように
    showViewerPhoto();
  }

  function closeViewer() {
    if (!viewerEl || viewerEl.hidden) return;
    viewerEl.hidden = true;
    viewerImg.removeAttribute('src'); // 閉じた時点で読み込みを止める(大きい画像なので)
    document.body.style.overflow = '';
  }

  function stepViewer(delta) {
    var n = viewer.list.length;
    if (!n) return;
    viewer.index = (viewer.index + delta + n) % n; // 端まで来たら反対側へ回る
    showViewerPhoto();
  }

  listEl.addEventListener('click', function (e) {
    var thumb = e.target.closest('.photo-thumb');
    if (!thumb) return;
    var grid = thumb.closest('.photo-grid');
    if (!grid) return;
    /* グリッドは 2 か所から作られる。カードの Photos タブは大会 ID(data-photo-event)、
     * 写真まとめ画面(#74)は Drive のフォルダ ID(data-photo-folder)を持たせてあり、
     * 写真の配列の持ち主が違う。 */
    var photos = null;
    if (grid.dataset.photoFolder) {
      photos = folderPhotos[grid.dataset.photoFolder];
    } else {
      var ev = findEvent(grid.dataset.photoEvent);
      photos = ev && ev.photos;
    }
    if (photos) openViewer(photos, Number(thumb.dataset.photo) || 0);
  });

  if (viewerEl) {
    viewerEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-photo-action]');
      var action = btn ? btn.dataset.photoAction : null;
      if (action === 'prev') stepViewer(-1);
      else if (action === 'next') stepViewer(1);
      else if (action === 'close' || e.target === viewerEl) closeViewer(); // 余白を押しても閉じる
    });

    document.addEventListener('keydown', function (e) {
      if (viewerEl.hidden) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') stepViewer(-1);
      else if (e.key === 'ArrowRight') stepViewer(1);
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
      var endsAt = el.dataset.endsAt ? parseInt(el.dataset.endsAt, 10) : null;
      var fallback = parseInt(el.dataset.remaining, 10) || 0;
      var remaining = remainSec(endsAt, fallback);
      el.textContent = fmtSec(remaining); // 初期表示も endsAt 基準に補正
      var t = setInterval(function () {
        // endsAt があれば毎秒「絶対時刻 - 現在」で再計算(ドリフト/古さを自己補正)
        remaining = endsAt != null ? remainSec(endsAt, fallback) : (remaining > 0 ? remaining - 1 : 0);
        el.textContent = fmtSec(remaining);
        if (remaining === 0) {
          /* 進行中カードを開いていないときは、従来どおりここで止める。 */
          if (!(livePollId && state.openedId === livePollId && !document.hidden)) {
            clearInterval(t);
            return;
          }

          /* レベル終了 → 通常ポーリング(25秒)を待たずに取り直して次レベルへ。
           * 同じレベルで既に追い取得中なら何もしない(下の再描画で毎秒走るのを防ぐ)。 */
          var cur = findEvent(livePollId);
          var idx = cur && cur.live ? cur.live.levelIndex : -1;
          if (levelEndPendingFor !== idx) {
            levelEndPendingFor = idx;
            refetchAfterLevelEnd(livePollId, idx, 1);
          }

          /* 実データが届くまでの間、手元のストラクチャーで次の項目へ繰り上げて描き直す。
           * これをしないと取得が返るまで 00:00 のまま止まって見える(実測 9〜22 秒)。
           *
           * **タイマーは繰り上げられたときだけ止める。** remainSec() は四捨五入なので、
           * 実際の終了より最大 0.5 秒早くここへ来ることがあり、その時点では
           * projectedStep() がまだ「終わっていない」と判断して null を返す。そこで
           * 止めてしまうと 00:00 のまま残るため、止めずに次の秒で繰り上げ直す。
           * 最終レベルに達した場合は繰り上げ先が無いので 00:00 を出し続ける(意図どおり)。 */
          if (cur && projectedStep(cur)) {
            clearInterval(t);
            updateLivePanel(livePollId);
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
      // フェーズ遷移(開始 / レジクロ到達)を反映。閲覧中に走るのでスクロールを保つ(#60)
      if (flip) renderKeepingView();
    }, 1000);
  }

  /* ---------- クイックリンク(#73) ----------
   * フィルタの下に置く、大会一覧の外への導線(Player's Guide など)。
   * リンク先は Drive に置かれた PDF 次第で変わるので、静的配信のフロントでは決められない。
   * /api/site-links から受け取り、そこに無いボタンは出さない。
   *
   * 出さない条件は 2 つある。どちらも「押しても何も起きないボタン」を見せないため:
   *   - 歌留多(other) … 運営が Player's Guide を用意しない運用なので行ごと出さない
   *   - リンクが null  … その種別のフォルダにまだ PDF が置かれていない
   *
   * ボタンが 0 個なら行ごと隠す。フィルタバーはスクロールで上に残るので、
   * 空の行を出しておくとその分だけ一覧が隠れる面積が増えてしまう。 */

  var quickLinksEl = document.getElementById('quickLinks');
  var QUICK_LINK_CATEGORIES = ['wolf', 'utage'];
  var siteLinks = null;                 // /api/site-links の結果(未取得は null)

  /* ラベルを 2 つ持たせて CSS で出し分ける。スマホ幅では短い方だけを出す
   * (行が増えるぶん一覧が隠れるので、狭い画面ではボタンの高さ・幅を詰める)。 */
  function quickLabels(label, shortLabel) {
    return (
      '<span class="ql-label">' + esc(label) + '</span>' +
      '<span class="ql-label-short">' + esc(shortLabel) + '</span>'
    );
  }

  // 外部(Drive)を別タブで開くリンク
  function quickLinkHtml(href, label, shortLabel) {
    return (
      '<a class="quick-link" href="' + esc(href) + '" target="_blank" rel="noopener">' +
      quickLabels(label, shortLabel) +
      '</a>'
    );
  }

  // サイト内の画面を切り替えるボタン(写真まとめ #74)。遷移しないので a ではなく button
  function quickButtonHtml(action, label, shortLabel, active) {
    return (
      '<button class="quick-link' + (active ? ' is-active' : '') + '" type="button"' +
      ' data-quick-action="' + esc(action) + '">' +
      quickLabels(label, shortLabel) +
      '</button>'
    );
  }

  function renderQuickLinks() {
    if (!quickLinksEl) return;
    var html = '';
    if (QUICK_LINK_CATEGORIES.indexOf(state.category) !== -1) {
      var links = siteLinks && siteLinks[state.category];
      if (links && links.guidePdf) html += quickLinkHtml(links.guidePdf, "Player's Guide", 'Guide');
      /* 合計ランキング(#78)。公開されていない種別では出さない */
      if (hasRanking(state.category)) {
        html += quickButtonHtml('ranking', 'Ranking', 'Ranking', state.rankingOpen);
      }
      // 写真まとめ(#74)
      if (hasPhotoFolders(state.category)) {
        html += quickButtonHtml('photos', 'Photos', 'Photos', !!state.photoView);
      }
    }
    quickLinksEl.innerHTML = html;
    quickLinksEl.hidden = !html;
  }

  /* リンクの取得は 1 回だけ。種別を切り替えても取り直さない
   * (3 種別ぶんまとめて返ってくるため)。 */
  function loadSiteLinks() {
    // API に繋がっていないときは取りに行かない(詳細の遅延ロードと同じ判断)
    if (window.__CARTA_DATA_SOURCE__ !== 'api') return;
    fetch('/api/site-links', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (d) {
        if (!d || d.error) return;
        siteLinks = d;
        renderQuickLinks();
      })
      .catch(function () { /* 取れなければクイックリンクが出ないだけ */ });
  }

  /* ---------- 写真まとめ画面(#74) ----------
   * クイックリンクの Photos から開く、大会一覧を差し替えるインラインパネル。
   * 別ページを作らないのは、ヘッダー・種別テーマ・フィルタバーをそのまま使い回すため。
   *
   * 2 段構成:
   *   フォルダ一覧 … 選択中の種別の大会フォルダを新しい順に。**大会名と開催日だけ**で
   *                  表紙画像は出さない(何十件も並ぶので、画像を出すと開いた瞬間に重い)
   *   写真グリッド … フォルダ 1 つぶんの写真。グリッドと拡大表示はカードの Photos タブと共用
   *
   * 一覧は /api/photos(種別付きのフォルダ索引)、写真は /api/photos/folder/:folderId から取る。
   * 大会 ID 経由にしないのは、フォルダに対応する大会が一覧に無いことがあるため。
   *
   * URL は ?photos=<フォルダID> か ?photos=<種別>。フォルダ ID から種別も引けるので、
   * 種別を別のパラメータで持たせずに直リンクが成立する。 */

  var PHOTOS_PARAM = 'photos';

  var photoFolders = null;        // /api/photos の folders(未取得は null)
  var photoFoldersState = null;   // null | 'loading' | 'loaded' | 'error'
  var photoFoldersPromise = null;
  var folderPhotos = {};          // folderId → 写真の配列
  var folderPhotosState = {};     // folderId → 'loading' | 'loaded' | 'error'

  /* 選択中の種別のフォルダを新しい順に。date は 'YYYY-MM-DD' で桁が揃っているため
   * 文字列のまま比較できる(Date に起こすとタイムゾーンで前日にずれる)。 */
  function categoryFolders(category) {
    return (photoFolders || [])
      .filter(function (f) { return f.category === category; })
      .sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  }

  /* 写真まとめを出せる種別か。**クイックリンク行を出す種別(Wolf / 宴)に限る** —
   * 歌留多の写真は各大会カードの Photos タブからのみ見せる運用(#74)。
   * フォルダが 1 つも無い種別でも出さない(押しても空の一覧しか出ないため)。 */
  function hasPhotoFolders(category) {
    return QUICK_LINK_CATEGORIES.indexOf(category) !== -1 && categoryFolders(category).length > 0;
  }

  function findPhotoFolder(id) {
    var list = photoFolders || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* フォルダ索引の取得。種別ごとに分けず 1 回で全部受け取る(数十件で軽い)。
   * クイックリンクに Photos を出すかどうかの判断にも使うので起動時に読む。 */
  function loadPhotoFolders(onDone) {
    var done = function () { if (onDone) onDone(); };
    if (photoFoldersState === 'loaded' || window.__CARTA_DATA_SOURCE__ !== 'api') { done(); return; }
    if (photoFoldersState === 'loading' && photoFoldersPromise) { photoFoldersPromise.then(done); return; }

    photoFoldersState = 'loading';
    photoFoldersPromise = fetch('/api/photos', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        photoFolders = (d && !d.error && d.folders) || [];
        photoFoldersState = 'loaded';
      })
      /* 失敗しても写真まとめが出ないだけ。状態を error にして次に開いたとき再試行させる */
      .catch(function () { photoFolders = []; photoFoldersState = 'error'; });
    photoFoldersPromise.then(done);
  }

  function loadFolderPhotos(folderId, onDone) {
    var done = function () { if (onDone) onDone(); };
    if (folderPhotosState[folderId] === 'loaded') { done(); return; }
    if (window.__CARTA_DATA_SOURCE__ !== 'api') { done(); return; }

    folderPhotosState[folderId] = 'loading';
    fetch('/api/photos/folder/' + encodeURIComponent(folderId), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        folderPhotos[folderId] = (d && !d.error && d.photos) || [];
        folderPhotosState[folderId] = 'loaded';
      })
      .catch(function () { folderPhotos[folderId] = []; folderPhotosState[folderId] = 'error'; })
      .then(done);
  }

  /* 一覧を差し替えるパネル(写真まとめ #74 / ランキング #78)共通の見出し。
   * 戻り先は「グリッド → フォルダ一覧」「フォルダ一覧 → 大会一覧」のように変わるので、
   * 戻り先とラベルを引数で受ける。 */
  function panelHeadHtml(backAction, backLabel, title, sub) {
    return (
      '<div class="panel-head">' +
      '<button class="panel-back" type="button" data-panel-back="' + esc(backAction) + '">' +
      '\u2190 ' + esc(backLabel) + '</button>' +
      '<span class="panel-title">' + esc(title) + '</span>' +
      (sub ? '<span class="panel-sub">' + esc(sub) + '</span>' : '') +
      '</div>'
    );
  }

  function panelNote(text) {
    return '<p class="reg-note panel-note">' + esc(text) + '</p>';
  }

  function photoFoldersHtml() {
    var head = panelHeadHtml('close', 'Tournaments', 'Photos', '');
    if (photoFoldersState !== 'loaded') {
      return head + panelNote(photoFoldersState === 'error'
        ? 'Photos are temporarily unavailable.' : 'Loading…');
    }

    var folders = categoryFolders(state.category);
    if (!folders.length) return head + panelNote('No photos have been published yet.');

    var items = folders.map(function (f) {
      return (
        '<button class="photo-folder" type="button" data-photo-folder-open="' + esc(f.id) + '">' +
        '<span class="pf-title">' + esc(f.title || f.name) + '</span>' +
        '<span class="pf-date">' + esc(f.date) + '</span>' +
        '</button>'
      );
    }).join('');
    return head + '<div class="photo-folders">' + items + '</div>';
  }

  function photoGridHtml(folderId) {
    var f = findPhotoFolder(folderId);
    var head = panelHeadHtml('folders', 'Photos', f ? (f.title || f.name) : 'Photos', f ? f.date : '');
    var st = folderPhotosState[folderId];
    if (st !== 'loaded') {
      return head + panelNote(st === 'error' ? 'Photos are temporarily unavailable.' : 'Loading…');
    }
    var photos = folderPhotos[folderId] || [];
    if (!photos.length) return head + panelNote('No photos in this folder yet.');
    return (
      head +
      '<div class="photo-grid" data-photo-folder="' + esc(folderId) + '">' +
      photoThumbsHtml(photos) +
      '</div>'
    );
  }

  function renderPhotoView() {
    document.body.dataset.view = 'photos';   // 日付・状況フィルタを隠す(この画面では効かないため)
    listEl.innerHTML =
      '<div class="panel-view">' +
      (state.photoView.folderId ? photoGridHtml(state.photoView.folderId) : photoFoldersHtml()) +
      '</div>';
    emptyEl.hidden = true;
    renderQuickLinks();   // Photos ボタンの選択状態を合わせる
    syncOpenParam();      // ?photos= を URL に反映(通常の render() を通らないためここで呼ぶ)
  }

  /* 写真まとめを開く。folderId を渡すとそのフォルダのグリッド、省略するとフォルダ一覧。
   * データが届く前に枠だけ先に描くのは、押した直後に何も起きないように見せないため。 */
  function openPhotoView(folderId) {
    state.photoView = { folderId: folderId || null };
    state.rankingOpen = false;  // パネルは同時に 1 つだけ
    state.openedId = null;      // 一覧のカードは閉じる(表示そのものが入れ替わるため)
    stopLivePolling();
    render();
    window.scrollTo(0, 0);
    ensurePhotoData();
  }

  /* どのパネルが開いていても閉じて大会一覧に戻す。
   * 戻るボタンは共通なので、閉じ方も 1 か所にまとめてある。 */
  function closePanel() {
    state.photoView = null;
    state.rankingOpen = false;
    render();
  }

  /* 表示に必要なデータを取りに行き、届いたら描き直す。
   * 取得を待つ間に別の画面へ移っていることがあるので、反映前に今の状態を見直す。 */
  function ensurePhotoData() {
    loadPhotoFolders(function () {
      var v = state.photoView;
      if (!v) return;
      if (!v.folderId) { render(); return; }

      var f = findPhotoFolder(v.folderId);
      /* 消されたフォルダを指す古いリンクや、写真まとめを出さない種別(歌留多)の
       * フォルダを指すリンク。UI から辿れない画面を URL だけで出さないよう一覧に戻す。 */
      if (!f || !hasPhotoFolders(f.category)) { closePanel(); return; }
      /* 直リンク(?photos=<フォルダID>)では、フォルダの種別が索引の到着で初めて分かる。
       * ヘッダーのタブとテーマをそのフォルダの種別に合わせる。 */
      if (f.category !== state.category) applyCategoryUi(f.category);
      render();
      loadFolderPhotos(v.folderId, function () {
        if (state.photoView && state.photoView.folderId === v.folderId) render();
      });
    });
  }

  /* 初回表示時、?photos=<フォルダID|種別> が指定されていれば写真まとめを開いた状態にする。
   * 種別が値のときはここで確定できるが、フォルダ ID のときは索引が届くまで分からないので
   * ensurePhotoData() 側で合わせる。 */
  function applyPhotoParam() {
    var v = new URLSearchParams(location.search).get(PHOTOS_PARAM);
    if (!v) return;
    if (QUICK_LINK_CATEGORIES.indexOf(v) !== -1) {
      state.category = v;
      state.photoView = { folderId: null };
    } else {
      state.photoView = { folderId: v };
    }
    state.openedId = null;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.category === state.category);
    });
  }

  listEl.addEventListener('click', function (e) {
    var back = e.target.closest('[data-panel-back]');
    if (back) {
      if (back.dataset.panelBack === 'close') closePanel();
      else openPhotoView(null);
      return;
    }
    var folder = e.target.closest('[data-photo-folder-open]');
    if (folder) openPhotoView(folder.dataset.photoFolderOpen);
  });

  if (quickLinksEl) {
    quickLinksEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-quick-action]');
      if (!btn) return;
      if (btn.dataset.quickAction === 'photos') openPhotoView(null);
      else if (btn.dataset.quickAction === 'ranking') openRankingView();
    });
  }

  /* ---------- 合計ランキング(#78) ----------
   * クイックリンクの Ranking から開く、大会一覧を差し替えるインラインパネル。
   * 集計は PokerLens 側にあり、こちらは並べるだけ(/api/ranking/:category)。
   *
   * 種別ごとに 1 つなので、URL は ?ranking=<種別> だけで復元できる。
   * 種別タブは残したまま切り替えられ、切り替えるとその種別のランキングに差し替わる。 */

  var RANKING_PARAM = 'ranking';

  var rankingData = {};    // category → { name, rows }
  var rankingState = {};   // category → 'loading' | 'loaded' | 'error'

  // ランキングが公開されているか。/api/site-links の ranking(名前と登録者数)で判断する
  function hasRanking(category) {
    var links = siteLinks && siteLinks[category];
    return !!(links && links.ranking);
  }

  /* 順位表の取得。種別ごとに 1 回だけ取り、結果は保持する
   * (実データで 218〜480 行あるので、種別を行き来するたびに取り直さない)。 */
  function loadRanking(category, onDone) {
    var done = function () { if (onDone) onDone(); };
    if (rankingState[category] === 'loaded') { done(); return; }
    if (window.__CARTA_DATA_SOURCE__ !== 'api') { done(); return; }

    rankingState[category] = 'loading';
    fetch('/api/ranking/' + encodeURIComponent(category), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        rankingData[category] = d && !d.error ? d : { name: null, rows: [] };
        rankingState[category] = 'loaded';
      })
      /* 失敗しても表が出ないだけ。状態を error にして次に開いたとき再試行させる */
      .catch(function () { rankingState[category] = 'error'; })
      .then(done);
  }

  function rankingViewHtml() {
    var cat = state.category;
    var d = rankingData[cat];
    // 見出しの副題はランキング名(「WOLF 2026 #02」「宴POS ver3」)。どの集計かが分かるように出す
    var head = panelHeadHtml('close', 'Tournaments', 'Ranking', (d && d.name) || '');
    var st = rankingState[cat];
    if (st !== 'loaded') {
      return head + panelNote(st === 'error' ? 'Ranking is temporarily unavailable.' : 'Loading…');
    }

    var rows = (d && d.rows) || [];
    if (!rows.length) return head + panelNote('No ranking has been published yet.');

    var body = rows.map(function (r) {
      var posCls = r.rank === 1 ? ' class="row-winner"' : '';
      var medalCls = r.rank <= 3 ? ' pos-' + r.rank : '';
      return (
        '<tr' + posCls + '>' +
        '<td class="col-pos"><span class="pos-medal' + medalCls + '">' + r.rank + '</span></td>' +
        /* ニックネーム未登録の選手は BFF が description のイニシャル表記に置き換えて返す。
         * それも空なら「—」— 本名は出さない(全員 privacyAgree: false)。 */
        '<td class="col-player">' + esc(r.name || '\u2014') + '</td>' +
        // ポイントは整数とは限らない(46.8 / 83.2)ので丸めずそのまま出す
        '<td class="col-points">' + num(r.points) + '</td>' +
        '<td class="col-events">' + num(r.events) + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      head +
      '<div class="table-scroll"><table class="data-table ranking-table">' +
      '<thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Events</th></tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>'
    );
  }

  function renderRankingView() {
    document.body.dataset.view = 'ranking';   // 日付・状況フィルタを隠す(この画面では効かない)
    listEl.innerHTML = '<div class="panel-view">' + rankingViewHtml() + '</div>';
    emptyEl.hidden = true;
    renderQuickLinks();   // Ranking ボタンの選択状態を合わせる
    syncOpenParam();      // ?ranking= を URL に反映(通常の render() を通らないためここで呼ぶ)
  }

  function openRankingView() {
    state.rankingOpen = true;
    state.photoView = null;     // パネルは同時に 1 つだけ
    state.openedId = null;
    stopLivePolling();
    render();
    window.scrollTo(0, 0);
    ensureRankingData();
  }

  /* 表示中の種別の順位表を取りに行き、届いたら描き直す。
   * 取得を待つ間に閉じたり種別を変えたりしていることがあるので、反映前に見直す。 */
  function ensureRankingData() {
    var cat = state.category;
    loadRanking(cat, function () {
      if (state.rankingOpen && state.category === cat) render();
    });
  }

  /* 初回表示時、?ranking=<種別> が指定されていればランキングを開いた状態にする。 */
  function applyRankingParam() {
    var v = new URLSearchParams(location.search).get(RANKING_PARAM);
    if (!v || QUICK_LINK_CATEGORIES.indexOf(v) === -1) return;
    state.category = v;
    state.rankingOpen = true;
    state.photoView = null;
    state.openedId = null;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.category === v);
    });
  }

  /* ---------- 上部タブ / フィルタ ---------- */

  /* 種別の見た目(タブの選択とテーマ)だけを合わせる。
   * selectCategory() と違って一覧の描き直しや写真まとめを閉じる処理はしない —
   * 直リンクで写真フォルダを開いたとき(#74)に、種別だけ後から合わせるために使う。 */
  function applyCategoryUi(category) {
    state.category = category;
    document.querySelectorAll('.category-tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.category === category);
    });
    applyTheme(category);
  }

  /* 種別の切り替え。ヘッダーのタブと、初回表示の選択画面の両方から呼ぶ。 */
  function selectCategory(category) {
    state.openedId = null;
    /* パネルを開いたまま種別を切り替えたときは、**その種別の内容に差し替える**(#78)。
     * ただし出せるものが無い種別(歌留多にはランキングも写真もある種別フォルダも無い)では
     * 閉じて一覧に戻す — 戻る導線が無いまま空のパネルが残るのを防ぐため。
     * 写真は種別をまたぐとフォルダ ID が意味を持たないので、フォルダ一覧の段まで戻す。 */
    if (state.rankingOpen && !hasRanking(category)) state.rankingOpen = false;
    if (state.photoView) {
      state.photoView = hasPhotoFolders(category) ? { folderId: null } : null;
    }
    applyCategoryUi(category);
    renderQuickLinks();            // 種別ごとにリンクが変わる(#73)
    state.pickerOpen = false;
    renderMonthNav();
    renderDateStrip();
    render();
    if (state.rankingOpen) ensureRankingData();   // 切替先の順位表を取りに行く(#78)
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
    /* 直リンク(?event= / ?photos= / ?ranking=)では見たい画面が決まっているので
     * 選択画面は出さない */
    var params = new URLSearchParams(location.search);
    if (params.get(OPEN_PARAM) || params.get(PHOTOS_PARAM) || params.get(RANKING_PARAM)) return;

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
  applyPhotoParam();              // ?photos=<フォルダID|種別> があれば写真まとめを開く(#74)
  applyRankingParam();            // ?ranking=<種別> があればランキングを開く(#78)
  applyTheme(state.category);
  // 取得失敗時は空表示 + 障害メッセージ(ダミーデータは出さない)
  if (window.__CARTA_DATA_SOURCE__ === 'error' && emptyEl) {
    emptyEl.textContent = 'Tournament data is temporarily unavailable. Please try again later.';
  }
  updateCounts();
  renderMonthNav();
  renderDateStrip();
  render();
  loadSiteLinks();                 // クイックリンク(Player's Guide)の URL を取得(#73)
  /* 写真フォルダの索引(#74)。Photos ボタンを出すかどうかの判断に要るので起動時に読む。
   * 直リンクで写真まとめを開いている場合は、続けて中身の取得まで進める。 */
  if (state.photoView) ensurePhotoData();
  else loadPhotoFolders(renderQuickLinks);
  if (state.rankingOpen) ensureRankingData();   // 直リンクで開いた順位表(#78)
  ensureCountdownTicker();         // STARTS IN / REG CLOSE IN のカウントダウン開始
  startListPolling();              // 一覧を 60 秒ごとに取り直す(#60)
  if (state.openedId) {
    // ?event=<id> で自動展開した場合も詳細(結果/ストラクチャー/ライブ)と写真を読み込み、完了後に反映
    var openId = state.openedId;
    loadForOpen(openId, function () { if (state.openedId === openId) render(); });
    startLivePolling(openId);
    var initialCard = document.getElementById('event-' + openId);
    if (initialCard) scrollToOpenCard(initialCard);
  }

  setupCategoryGate();             // 一覧が用意できてから種別の選択画面を出す

  // 初期描画が完了したのでローディングを解除して画面を表示
  document.body.classList.add('app-ready');
})();
