/* =========================================================
 * CARTA POKER SERIES - モックデータ
 * 本番では PokerLens API (https://api.pokerlens.net) から取得する。
 *   一覧      : POST /v1/event/search
 *   詳細      : GET  /v1/event/{id}
 *   ストラクチャー: GET  /v1/event/{id}/structure , /levels
 *   結果      : POST /v1/event/{id}/players , GET /v1/event/{id}/payouts
 *   ライブ状況 : GET  /v1/event/{id} (status.level / stats)
 * ========================================================= */

/**
 * ブラインドストラクチャー生成ヘルパー(固定的・決定的)
 * blinds: [sb, bb, ante] の配列。breakEvery レベルごとに休憩を挟む。
 */
function makeStructure(blinds, minutes, breakEvery, breakMinutes, lateRegLevel) {
  const rows = [];
  blinds.forEach(function (b, i) {
    rows.push({
      type: 'level',
      level: i + 1,
      sb: b[0],
      bb: b[1],
      ante: b[2],
      minutes: minutes,
      lateRegClose: i + 1 === lateRegLevel
    });
    if ((i + 1) % breakEvery === 0 && i !== blinds.length - 1) {
      rows.push({ type: 'break', minutes: breakMinutes });
    }
  });
  return rows;
}

var STRUCTURE_DEEP = makeStructure(
  [
    [100, 100, 100], [100, 200, 200], [200, 300, 300], [200, 400, 400],
    [300, 500, 500], [300, 600, 600], [400, 800, 800], [500, 1000, 1000],
    [600, 1200, 1200], [1000, 1500, 1500], [1000, 2000, 2000], [1500, 2500, 2500],
    [1500, 3000, 3000], [2000, 4000, 4000], [2500, 5000, 5000], [3000, 6000, 6000],
    [4000, 8000, 8000], [5000, 10000, 10000], [6000, 12000, 12000], [10000, 15000, 15000]
  ],
  40, 4, 15, 9
);

var STRUCTURE_STANDARD = makeStructure(
  [
    [100, 200, 200], [200, 300, 300], [200, 400, 400], [300, 600, 600],
    [400, 800, 800], [500, 1000, 1000], [1000, 1500, 1500], [1000, 2000, 2000],
    [1500, 3000, 3000], [2000, 4000, 4000], [3000, 6000, 6000], [4000, 8000, 8000],
    [5000, 10000, 10000], [10000, 15000, 15000], [10000, 20000, 20000], [15000, 30000, 30000]
  ],
  20, 4, 10, 8
);

var STRUCTURE_TURBO = makeStructure(
  [
    [100, 200, 200], [200, 400, 400], [300, 600, 600], [500, 1000, 1000],
    [1000, 1500, 1500], [1000, 2000, 2000], [1500, 3000, 3000], [2000, 4000, 4000],
    [3000, 6000, 6000], [5000, 10000, 10000], [10000, 15000, 15000], [10000, 20000, 20000]
  ],
  12, 6, 10, 6
);

/**
 * カレンダー設定(日付・月・年セレクター用・モック固定)
 * months: セレクターで選択できる年月(毎月大会が開催されるため連続レンジ)
 * today:  モック上の「今日」
 */
var CALENDAR = {
  months: [
    { year: 2025, month: 9 }, { year: 2025, month: 10 }, { year: 2025, month: 11 }, { year: 2025, month: 12 },
    { year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 }, { year: 2026, month: 4 },
    { year: 2026, month: 5 }, { year: 2026, month: 6 }, { year: 2026, month: 7 }, { year: 2026, month: 8 }
  ],
  today: { year: 2026, month: 7, day: 16 }
};

/**
 * イベントデータ本体
 * category: 'wolf' | 'utage' | 'other'
 * status:   'past' | 'running' | 'future'
 * day:      開催日(7月の日付・日付フィルタ用)
 */
var MOCK_EVENTS = [

  /* ---------- ウルフ ---------- */
  {
    id: 'w-main-1a',
    category: 'wolf',
    status: 'running',
    name: 'WOLF CHAMPIONSHIP 2026 SUMMER メインイベント 〜シーズンNo.1ハンター決定戦〜',
    flight: 'Day 1A',
    tags: ['NLH', 'フリーズアウト解除', '2 Days'],
    year: 2026,
    month: 7,
    day: 16,
    dateLabel: '7/16 (木) 12:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 50000,
    fee: 5000,
    guarantee: 10000000,
    startingStack: 50000,
    levelMinutes: 40,
    lateReg: 'Lv.9 終了まで(約 6 時間)',
    reentry: '各フライト 1 回まで / 最大 3 フライト',
    gameType: 'ノーリミットホールデム',
    description:
      'CARTA POKER SERIES の頂点を決めるメインイベント。Day1 を勝ち抜いたプレイヤーが Day2 に進出し、チャンピオンの座と優勝賞金を懸けて戦います。BB アンティ採用、40 分レベルのディープストラクチャー。',
    details: [
      '各フライトの受付は開始 60 分前からメインフロア受付カウンターで行います。',
      'Day1 を複数フライト通過した場合は、最も大きいスタックで Day2 に進出します。',
      'Day2 進出者には進出賞として ¥30,000 を保証します。',
      '入賞時にはパスポート等の本人確認書類の提示が必要です。',
      '本イベントはシリーズランキングポイントの対象です。'
    ],
    structure: STRUCTURE_DEEP,
    stats: {
      entries: 312,
      players: 173,
      avgStack: 90200,
      totalChips: 15600000,
      prizePool: 15600000,
      itm: 47
    },
    live: {
      levelIndex: 8,
      sb: 500, bb: 1000, ante: 1000,
      remainingSec: 1250,
      nextLevel: '600 / 1,200 (1,200)',
      nextBreak: '15:40 (Lv.8 終了後 15 分)',
      tables: 20
    }
  },
  {
    id: 'w-highroller',
    category: 'wolf',
    status: 'future',
    name: 'WOLF ハイローラー',
    flight: 'Single Day',
    tags: ['NLH', 'ハイローラー', 'リエントリー可'],
    year: 2026,
    month: 7,
    day: 20,
    dateLabel: '7/20 (月) 15:00',
    venue: 'CARTA POKER LOUNGE 渋谷 VIP ルーム',
    buyin: 125000,
    fee: 10000,
    guarantee: 8000000,
    startingStack: 100000,
    levelMinutes: 40,
    lateReg: 'Lv.8 終了まで',
    reentry: '2 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      'ハイステークス志向のプレイヤーに向けたプレミアイベント。10 万点持ち・40 分レベルのゆったりとしたストラクチャーで、じっくりとしたディープなプレイが楽しめます。',
    details: [
      'VIP ルームでの開催のため、入室時にエントリーチケットをご提示ください。',
      'リエントリーは Lv.8 終了まで受け付けます(最大 2 回)。',
      'ファイナルテーブルでのディールは全員の同意がある場合のみ可能です。',
      '賞金は当日、現金またはカルタドルでお支払いします。'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',                 // open | openSoon | closed
      stateLabel: '受付中',
      entries: 41,
      cap: 120,
      closesLabel: '7/20 (月) 20:30(Lv.8 終了)まで',
      note: '事前申込のプレイヤーには早期登録ボーナス +5,000 点を進呈。',
      options: [
        { label: '通常バイイン', amount: 135000, chips: '100,000 点' },
        { label: '早期登録(前日まで)', amount: 135000, chips: '105,000 点' }
      ]
    }
  },
  {
    id: 'w-deepstack',
    category: 'wolf',
    status: 'future',
    name: 'WOLF ディープスタック',
    flight: 'Day 1B',
    tags: ['NLH', 'ディープ', '2 Days'],
    year: 2026,
    month: 7,
    day: 18,
    dateLabel: '7/18 (土) 12:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 20000,
    fee: 3000,
    guarantee: 3000000,
    startingStack: 60000,
    levelMinutes: 30,
    lateReg: 'Lv.10 終了まで',
    reentry: '無制限(フライトごと)',
    gameType: 'ノーリミットホールデム',
    description:
      '6 万点持ちの deep スタックイベント。週末開催でエントリーしやすく、初参加の方にもおすすめのフラッグシップサイドイベントです。',
    details: [
      'Day1A / Day1B の両方に参加できます(スタックは大きい方を持ち越し)。',
      'リエントリーはフライトごとに無制限です。',
      '各フライト上位 15% が Day2 に進出します。'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: '受付中',
      entries: 158,
      cap: 240,
      closesLabel: '7/18 (土) 17:30(Lv.10 終了)まで',
      note: 'Day1A / Day1B いずれかを勝ち抜けば Day2 へ進出できます。',
      options: [
        { label: '通常バイイン', amount: 23000, chips: '60,000 点' }
      ]
    }
  },
  {
    id: 'w-mystery',
    category: 'wolf',
    status: 'past',
    name: 'WOLF ミステリーバウンティ',
    flight: 'Single Day',
    tags: ['NLH', 'バウンティ'],
    year: 2026,
    month: 7,
    day: 12,
    dateLabel: '7/12 (日) 13:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 30000,
    fee: 4000,
    guarantee: 4000000,
    startingStack: 40000,
    levelMinutes: 25,
    lateReg: 'Lv.8 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      'バイインの半額がミステリーバウンティプールへ。プレイヤーを飛ばすたびに封筒を引き、最高 ¥1,000,000 のバウンティを狙えるエキサイティングなイベント。',
    details: [
      'バウンティは Lv.9 以降のノックアウトから発生します。',
      'ミステリーバウンティ封筒は最低 ¥10,000、最高 ¥1,000,000 です。',
      '結果は結果タブおよび公式 X アカウントで公開しています。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: {
      entries: 236,
      players: 0,
      avgStack: 0,
      totalChips: 9440000,
      prizePool: 7080000,
      itm: 31
    },
    results: [
      { pos: 1, player: 'TAKESHI "狼王" SATO', country: 'JP', prize: 1420000, bounty: 380000 },
      { pos: 2, player: 'MINJUN PARK', country: 'KR', prize: 940000, bounty: 120000 },
      { pos: 3, player: 'YUKI YAMADA', country: 'JP', prize: 662000, bounty: 260000 },
      { pos: 4, player: 'DAVID CHEN', country: 'TW', prize: 481000, bounty: 40000 },
      { pos: 5, player: 'AIRI KOBAYASHI', country: 'JP', prize: 356000, bounty: 180000 },
      { pos: 6, player: 'KENTO NAKAMURA', country: 'JP', prize: 269000, bounty: 80000 },
      { pos: 7, player: 'SOMCHAI W.', country: 'TH', prize: 207000, bounty: 0 },
      { pos: 8, player: 'RYO TANAKA', country: 'JP', prize: 163000, bounty: 40000 },
      { pos: 9, player: 'HANNAH LEE', country: 'SG', prize: 131000, bounty: 20000 }
    ]
  },
  {
    id: 'w-opening',
    category: 'wolf',
    status: 'past',
    name: 'WOLF オープニングイベント',
    flight: 'Single Day',
    tags: ['NLH', 'アキュムレーター'],
    year: 2026,
    month: 7,
    day: 10,
    dateLabel: '7/10 (金) 18:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 15000,
    fee: 2000,
    guarantee: 2000000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Lv.8 終了まで',
    reentry: '無制限',
    gameType: 'ノーリミットホールデム',
    description: 'シリーズの幕開けを飾るオープニングイベント。気軽に参加できるバイインで、シリーズ全体のウォームアップに最適。',
    details: [
      'アキュムレーター形式のため、複数エントリーのスタックは合算されます。',
      '参加賞としてシリーズオリジナルカードプロテクターを進呈しました。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: {
      entries: 189,
      players: 0,
      avgStack: 0,
      totalChips: 5670000,
      prizePool: 2835000,
      itm: 23
    },
    results: [
      { pos: 1, player: 'SHOTA "Wolf Jr." IMAI', country: 'JP', prize: 680000, bounty: 0 },
      { pos: 2, player: 'MEI WATANABE', country: 'JP', prize: 425000, bounty: 0 },
      { pos: 3, player: 'JACKY LIM', country: 'MY', prize: 297000, bounty: 0 },
      { pos: 4, player: 'HIROKI ONO', country: 'JP', prize: 213000, bounty: 0 },
      { pos: 5, player: 'NANA FUJITA', country: 'JP', prize: 156000, bounty: 0 },
      { pos: 6, player: 'BRIAN WONG', country: 'HK', prize: 116000, bounty: 0 },
      { pos: 7, player: 'KAZUKI MORI', country: 'JP', prize: 88000, bounty: 0 },
      { pos: 8, player: 'ELENA KIM', country: 'KR', prize: 68000, bounty: 0 },
      { pos: 9, player: 'TOMOYA HASHIMOTO', country: 'JP', prize: 57000, bounty: 0 }
    ]
  },

  {
    id: 'w-warmup',
    category: 'wolf',
    status: 'past',
    name: 'WOLF ウォームアップ',
    flight: 'Single Day',
    tags: ['NLH', 'ターボ', 'プレシーズン'],
    year: 2026,
    month: 6,
    day: 28,
    dateLabel: '6/28 (日) 15:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 10000,
    fee: 1500,
    guarantee: 1000000,
    startingStack: 25000,
    levelMinutes: 15,
    lateReg: 'Lv.6 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '7 月のシリーズ本番に向けたプレシーズンイベント。本戦と同構成のターボストラクチャーで腕試しができます。',
    details: [
      'プレシーズンイベントのためシリーズランキングポイントの対象外です。',
      '入賞者には 7 月本戦で使用できる ¥5,000 割引チケットを進呈しました。'
    ],
    structure: STRUCTURE_TURBO,
    stats: {
      entries: 134,
      players: 0,
      avgStack: 0,
      totalChips: 3350000,
      prizePool: 1340000,
      itm: 17
    },
    results: [
      { pos: 1, player: 'GORO "月見" TACHIBANA', country: 'JP', prize: 349000, bounty: 0 },
      { pos: 2, player: 'LISA HUANG', country: 'TW', prize: 218000, bounty: 0 },
      { pos: 3, player: 'SHUN OGAWA', country: 'JP', prize: 155000, bounty: 0 },
      { pos: 4, player: 'TARO KIKUCHI', country: 'JP', prize: 116000, bounty: 0 },
      { pos: 5, player: 'EMMA CHOI', country: 'KR', prize: 90000, bounty: 0 }
    ]
  },
  {
    id: 'w-summer-final',
    category: 'wolf',
    status: 'future',
    name: 'WOLF サマーファイナル',
    flight: 'Single Day',
    tags: ['NLH', 'シーズン最終戦'],
    year: 2026,
    month: 8,
    day: 8,
    dateLabel: '8/8 (土) 12:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 40000,
    fee: 5000,
    guarantee: 6000000,
    startingStack: 50000,
    levelMinutes: 30,
    lateReg: 'Lv.9 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      'サマーシーズンを締めくくる特別イベント。シリーズランキング上位者にはシーズンチャンピオンの称号と副賞を贈呈します。',
    details: [
      'シリーズランキング上位 8 名はバイイン免除でご招待します。',
      '詳細レギュレーションは開催 1 週間前に公開予定です。'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'openSoon',
      stateLabel: 'まもなく受付開始',
      entries: 0,
      cap: 300,
      closesLabel: '受付開始: 7/25 (土) 10:00',
      note: '受付開始までしばらくお待ちください。開始時に登録済みメールアドレスへ通知します。',
      options: [
        { label: '通常バイイン', amount: 45000, chips: '50,000 点' }
      ]
    }
  },

  {
    id: 'w-winter-main',
    category: 'wolf',
    status: 'past',
    name: 'WOLF WINTER FESTIVAL 2025 メインイベント',
    flight: 'Single Day',
    tags: ['NLH', '前回シリーズ'],
    year: 2025,
    month: 12,
    day: 20,
    dateLabel: '2025/12/20 (土) 12:00',
    venue: 'CARTA POKER LOUNGE 渋谷 メインフロア',
    buyin: 40000,
    fee: 5000,
    guarantee: 8000000,
    startingStack: 50000,
    levelMinutes: 40,
    lateReg: 'Lv.9 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '前回ウィンターシリーズのメインイベント。過去シリーズの結果はアーカイブとして閲覧できます。',
    details: [
      '2025 ウィンターシリーズのアーカイブです。',
      '結果は結果タブから閲覧できます。'
    ],
    structure: STRUCTURE_DEEP,
    stats: {
      entries: 268,
      players: 0,
      avgStack: 0,
      totalChips: 13400000,
      prizePool: 10720000,
      itm: 39
    },
    results: [
      { pos: 1, player: 'HIDEO "冬将軍" KANZAKI', country: 'JP', prize: 2410000, bounty: 0 },
      { pos: 2, player: 'ALEX WONG', country: 'HK', prize: 1500000, bounty: 0 },
      { pos: 3, player: 'MIYU TAKAHASHI', country: 'JP', prize: 1050000, bounty: 0 },
      { pos: 4, player: 'JOON-HO LEE', country: 'KR', prize: 760000, bounty: 0 },
      { pos: 5, player: 'KENJI ABE', country: 'JP', prize: 570000, bounty: 0 }
    ]
  },

  /* ---------- 宴 ---------- */
  {
    id: 'u-special',
    category: 'utage',
    status: 'running',
    name: '宴 -UTAGE- スペシャルトーナメント',
    flight: 'Single Day',
    tags: ['NLH', 'BB アンティ'],
    year: 2026,
    month: 7,
    day: 16,
    dateLabel: '7/16 (木) 14:00',
    venue: 'CARTA POKER LOUNGE 渋谷 宴フロア',
    buyin: 25000,
    fee: 3000,
    guarantee: 3000000,
    startingStack: 35000,
    levelMinutes: 25,
    lateReg: 'Lv.8 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '「宴」シリーズの看板イベント。和のおもてなしをテーマにした特別フロアで開催され、入賞者には賞金に加えて宴オリジナルトロフィーを贈呈します。',
    details: [
      '和装(浴衣・甚平)でのご来場を歓迎します。ドレスコードはスマートカジュアルです。',
      '優勝者には賞金に加えて宴オリジナルトロフィーと副賞を贈呈します。',
      '会場内でのご飲食は宴フロア専用メニューをご利用ください。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: {
      entries: 148,
      players: 62,
      avgStack: 83500,
      totalChips: 5180000,
      prizePool: 3700000,
      itm: 19
    },
    live: {
      levelIndex: 10,
      sb: 2000, bb: 4000, ante: 4000,
      remainingSec: 460,
      nextLevel: '3,000 / 6,000 (6,000)',
      nextBreak: '18:10 (Lv.12 終了後 10 分)',
      tables: 8
    }
  },
  {
    id: 'u-sunday',
    category: 'utage',
    status: 'future',
    name: '宴 サンデーメジャー',
    flight: 'Single Day',
    tags: ['NLH', 'サンデー'],
    year: 2026,
    month: 7,
    day: 19,
    dateLabel: '7/19 (日) 13:00',
    venue: 'CARTA POKER LOUNGE 渋谷 宴フロア',
    buyin: 12000,
    fee: 2000,
    guarantee: 1500000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Lv.8 終了まで',
    reentry: '2 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '毎週日曜の定番メジャーイベントのシリーズ特別版。保証賞金を通常の 3 倍に増額して開催します。',
    details: [
      '毎週日曜開催の定番イベントのシリーズ特別版です。',
      '入賞者には次回サンデーメジャーの無料エントリー券を進呈します。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: '受付中',
      entries: 97,
      cap: 160,
      closesLabel: '7/19 (日) 16:00(Lv.8 終了)まで',
      note: '当日会場受付でもエントリー可能ですが、事前申込を推奨します。',
      options: [
        { label: '通常バイイン', amount: 14000, chips: '30,000 点' }
      ]
    }
  },
  {
    id: 'u-night-turbo',
    category: 'utage',
    status: 'past',
    name: '宴 ナイトターボ',
    flight: 'Single Day',
    tags: ['NLH', 'ターボ'],
    year: 2026,
    month: 7,
    day: 11,
    dateLabel: '7/11 (土) 20:00',
    venue: 'CARTA POKER LOUNGE 渋谷 宴フロア',
    buyin: 8000,
    fee: 1500,
    guarantee: 800000,
    startingStack: 20000,
    levelMinutes: 12,
    lateReg: 'Lv.6 終了まで',
    reentry: '無制限',
    gameType: 'ノーリミットホールデム',
    description: '仕事帰りでも参加できる夜開催のターボイベント。12 分レベルのスピーディーな展開で、その日のうちに優勝者が決定します。',
    details: [
      '22 時以降のご入場は 20 歳以上の方に限ります。',
      '最終レベル終了時に決着しない場合はチップカウントで順位を決定します。'
    ],
    structure: STRUCTURE_TURBO,
    stats: {
      entries: 112,
      players: 0,
      avgStack: 0,
      totalChips: 2240000,
      prizePool: 896000,
      itm: 15
    },
    results: [
      { pos: 1, player: 'RIKU "夜叉" ENDO', country: 'JP', prize: 242000, bounty: 0 },
      { pos: 2, player: 'SAKI MATSUMOTO', country: 'JP', prize: 152000, bounty: 0 },
      { pos: 3, player: 'ANDY NGUYEN', country: 'VN', prize: 108000, bounty: 0 },
      { pos: 4, player: 'DAISUKE OKADA', country: 'JP', prize: 81000, bounty: 0 },
      { pos: 5, player: 'MIKA SUZUKI', country: 'JP', prize: 63000, bounty: 0 },
      { pos: 6, player: 'KEVIN ZHAO', country: 'CN', prize: 49000, bounty: 0 },
      { pos: 7, player: 'YUTA ISHIDA', country: 'JP', prize: 40000, bounty: 0 }
    ]
  },

  {
    id: 'u-hassaku',
    category: 'utage',
    status: 'future',
    name: '宴 八朔祭スペシャル',
    flight: 'Single Day',
    tags: ['NLH', '季節イベント'],
    year: 2026,
    month: 8,
    day: 2,
    dateLabel: '8/2 (日) 13:00',
    venue: 'CARTA POKER LOUNGE 渋谷 宴フロア',
    buyin: 15000,
    fee: 2000,
    guarantee: 2000000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Lv.8 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '八朔(旧暦八月朔日)にちなんだ季節の特別イベント。ご来場のお客様には宴オリジナルの記念品を進呈します。',
    details: [
      '浴衣でご来場の方にはボーナスチップ +3,000 点を進呈します。',
      '和菓子と抹茶のふるまいを予定しています(数量限定)。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: '受付中',
      entries: 12,
      cap: 150,
      closesLabel: '8/2 (日) 16:00(Lv.8 終了)まで',
      note: '浴衣でご来場の方にはボーナスチップ +3,000 点を進呈します。',
      options: [
        { label: '通常バイイン', amount: 17000, chips: '30,000 点' }
      ]
    }
  },

  /* ---------- その他 ---------- */
  {
    id: 'o-daily88',
    category: 'other',
    status: 'past',
    name: 'デイリーディープ #88',
    flight: 'Single Day',
    tags: ['NLH', 'デイリー'],
    year: 2026,
    month: 6,
    day: 21,
    dateLabel: '6/21 (日) 19:00',
    venue: 'CARTA POKER LOUNGE 渋谷 サイドフロア',
    buyin: 6000,
    fee: 1000,
    guarantee: 500000,
    startingStack: 20000,
    levelMinutes: 15,
    lateReg: 'Lv.6 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '毎日開催のレギュラーイベント。手頃なバイインとディープなスタックで、平日夜の定番として人気のトーナメントです。',
    details: [
      '毎日 19 時開催のレギュラーイベントです。',
      'デイリーリーダーボードのポイント対象イベントです。'
    ],
    structure: STRUCTURE_TURBO,
    stats: {
      entries: 64,
      players: 0,
      avgStack: 0,
      totalChips: 1280000,
      prizePool: 384000,
      itm: 9
    },
    results: [
      { pos: 1, player: 'KOJI "夜勤明け" HAMADA', country: 'JP', prize: 123000, bounty: 0 },
      { pos: 2, player: 'ANNA SUZUKI', country: 'JP', prize: 77000, bounty: 0 },
      { pos: 3, player: 'MARK TAN', country: 'SG', prize: 54000, bounty: 0 },
      { pos: 4, player: 'YUJI SAKAMOTO', country: 'JP', prize: 40000, bounty: 0 },
      { pos: 5, player: 'RIN KATO', country: 'JP', prize: 31000, bounty: 0 }
    ]
  },
  {
    id: 'o-satellite',
    category: 'other',
    status: 'future',
    name: 'メインイベント サテライト #4 〜勝てば¥55,000のメインイベントシート獲得!リエントリー可能スーパーターボエディション〜',
    flight: 'Single Day',
    tags: ['NLH', 'サテライト', 'ターボ'],
    year: 2026,
    month: 7,
    day: 17,
    dateLabel: '7/17 (金) 19:00',
    venue: 'CARTA POKER LOUNGE 渋谷 サイドフロア',
    buyin: 5000,
    fee: 500,
    guarantee: 0,
    startingStack: 15000,
    levelMinutes: 15,
    lateReg: 'Lv.6 終了まで',
    reentry: '2 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      'WOLF CHAMPIONSHIP メインイベント(¥55,000)のシートを懸けたサテライト。参加 10 名につき 1 シートを進呈します。',
    details: [
      '参加 10 名につき 1 シートをメインイベントシートとして進呈します。',
      'シート獲得者の残りチップは順位に関係なく無効となります。',
      'シートの譲渡・換金はできません。'
    ],
    structure: STRUCTURE_TURBO,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: '受付中',
      entries: 34,
      cap: 80,
      closesLabel: '7/17 (金) 20:45(Lv.6 終了)まで',
      note: '獲得シートは Day1B / Day1C いずれかで使用できます。',
      options: [
        { label: '通常バイイン', amount: 5500, chips: '15,000 点' }
      ]
    }
  },
  {
    id: 'o-ladies',
    category: 'other',
    status: 'future',
    name: 'レディースイベント',
    flight: 'Single Day',
    tags: ['NLH', '限定イベント'],
    year: 2026,
    month: 7,
    day: 23,
    dateLabel: '7/23 (木) 13:00',
    venue: 'CARTA POKER LOUNGE 渋谷 サイドフロア',
    buyin: 10000,
    fee: 1500,
    guarantee: 1000000,
    startingStack: 25000,
    levelMinutes: 20,
    lateReg: 'Lv.8 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '女性プレイヤー限定のスペシャルイベント。優勝者には賞金に加え、次回シリーズのメインイベントシートを贈呈します。',
    details: [
      '女性プレイヤー限定のイベントです。受付時に本人確認を行います。',
      '優勝者には次回シリーズのメインイベントシートを贈呈します。'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'openSoon',
      stateLabel: 'まもなく受付開始',
      entries: 0,
      cap: 100,
      closesLabel: '受付開始: 7/18 (土) 10:00',
      note: '受付開始までしばらくお待ちください。開始時に登録済みメールアドレスへ通知します。',
      options: [
        { label: '通常バイイン', amount: 11500, chips: '25,000 点' }
      ]
    }
  },
  {
    id: 'o-charity',
    category: 'other',
    status: 'past',
    name: 'チャリティーバウンティ',
    flight: 'Single Day',
    tags: ['NLH', 'バウンティ', 'チャリティー'],
    year: 2026,
    month: 7,
    day: 13,
    dateLabel: '7/13 (月) 18:30',
    venue: 'CARTA POKER LOUNGE 渋谷 サイドフロア',
    buyin: 10000,
    fee: 2000,
    guarantee: 0,
    startingStack: 25000,
    levelMinutes: 15,
    lateReg: 'Lv.6 終了まで',
    reentry: '1 回まで',
    gameType: 'ノーリミットホールデム',
    description:
      '参加費の一部を子ども支援団体へ寄付するチャリティーイベント。1 ノックアウトごとに ¥2,000 のバウンティを獲得できます。',
    details: [
      '参加費のうち ¥1,000 を子ども支援団体へ寄付しました。',
      '寄付金の報告は公式サイトで公開しています。'
    ],
    structure: STRUCTURE_TURBO,
    stats: {
      entries: 86,
      players: 0,
      avgStack: 0,
      totalChips: 2150000,
      prizePool: 602000,
      itm: 11
    },
    results: [
      { pos: 1, player: 'MASARU "鉄人" IGARASHI', country: 'JP', prize: 181000, bounty: 22000 },
      { pos: 2, player: 'CHLOE TAN', country: 'SG', prize: 113000, bounty: 8000 },
      { pos: 3, player: 'REN HAYASHI', country: 'JP', prize: 78000, bounty: 14000 },
      { pos: 4, player: 'KOTA MAEDA', country: 'JP', prize: 57000, bounty: 4000 },
      { pos: 5, player: 'JESSICA LIU', country: 'TW', prize: 45000, bounty: 6000 }
    ]
  }
];
