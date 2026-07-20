/* =========================================================
 * CARTA POKER SERIES - モックデータ
 * 本番では PokerLens API (https://api.pokerlens.net) から取得する。
 *   一覧      : POST /v1/event/search
 *   詳細      : GET  /v1/event/{id}
 *   ストラクチャー: GET  /v1/event/{id}/structure , /levels
 *   結果      : POST /v1/event/{id}/players , GET /v1/event/{id}/payouts
 *   ライブ状況 : GET  /v1/event/{id} (status.level / stats)
 *
 * 表示文言はすべて英語表記(UI・コンテンツとも)。
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

  /* ---------- WOLF ---------- */
  {
    id: 'w-main-1a',
    category: 'wolf',
    status: 'running',
    name: 'WOLF CHAMPIONSHIP 2026 SUMMER Main Event — Battle for the No.1 Hunter',
    flight: 'Day 1A',
    tags: ['NLH', 'Re-entry', '2 Days'],
    year: 2026,
    month: 7,
    day: 16,
    dateLabel: '7/16 (Thu) 12:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 50000,
    fee: 5000,
    guarantee: 10000000,
    startingStack: 50000,
    levelMinutes: 40,
    lateReg: 'Until end of Lv.9 (approx. 6 hrs)',
    reentry: '1 per flight / up to 3 flights',
    gameType: "No-Limit Hold'em",
    description:
      'The flagship Main Event that crowns the champion of the CARTA POKER SERIES. Players who survive Day 1 advance to Day 2 to battle for the title and the top prize. BB ante, 40-minute levels, deep structure.',
    details: [
      'Registration for each flight opens 60 minutes before start at the Main Floor reception counter.',
      'If you clear multiple Day 1 flights, you advance to Day 2 with your largest stack.',
      'Day 2 qualifiers are guaranteed a ¥30,000 advancement prize.',
      'Photo ID (e.g. passport) is required to collect any prize.',
      'This event awards Series ranking points.'
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
      nextBreak: '15:40 (15 min after Lv.8)',
      tables: 20
    }
  },
  {
    id: 'w-highroller',
    category: 'wolf',
    status: 'future',
    name: 'WOLF High Roller',
    flight: 'Single Day',
    tags: ['NLH', 'High Roller', 'Re-entry'],
    year: 2026,
    month: 7,
    day: 20,
    dateLabel: '7/20 (Mon) 15:00',
    venue: 'CARTA POKER LOUNGE Shibuya — VIP Room',
    buyin: 125000,
    fee: 10000,
    guarantee: 8000000,
    startingStack: 100000,
    levelMinutes: 40,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 2 times',
    gameType: "No-Limit Hold'em",
    description:
      'A premier event for high-stakes players. With a 100,000 starting stack and relaxed 40-minute levels, enjoy deep, patient play.',
    details: [
      'Held in the VIP Room — please present your entry ticket on arrival.',
      'Re-entry is available until the end of Lv.8 (up to 2 times).',
      'Final-table deals are allowed only with the agreement of all remaining players.',
      'Prizes are paid on the day in cash or Carta Dollars.'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',                 // open | openSoon | closed
      stateLabel: 'Open',
      entries: 41,
      cap: 120,
      closesLabel: 'Until 7/20 (Mon) 20:30 (end of Lv.8)',
      note: 'Pre-registered players receive an early-registration bonus of +5,000 chips.',
      options: [
        { label: 'Standard Buy-in', amount: 135000, chips: '100,000 chips' },
        { label: 'Early Reg (until day before)', amount: 135000, chips: '105,000 chips' }
      ]
    }
  },
  {
    id: 'w-deepstack',
    category: 'wolf',
    status: 'future',
    name: 'WOLF Deep Stack',
    flight: 'Day 1B',
    tags: ['NLH', 'Deep Stack', '2 Days'],
    year: 2026,
    month: 7,
    day: 18,
    dateLabel: '7/18 (Sat) 12:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 20000,
    fee: 3000,
    guarantee: 3000000,
    startingStack: 60000,
    levelMinutes: 30,
    lateReg: 'Until end of Lv.10',
    reentry: 'Unlimited (per flight)',
    gameType: "No-Limit Hold'em",
    description:
      'A deep-stack event with a 60,000 starting stack. Held on the weekend and easy to enter — a flagship side event we recommend even for first-timers.',
    details: [
      'You may play both Day 1A and Day 1B (carry forward your larger stack).',
      'Re-entry is unlimited per flight.',
      'The top 15% of each flight advance to Day 2.'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'closed',
      stateLabel: 'Closed',
      entries: 240,
      cap: 240,
      closesLabel: 'Advance registration closed (capacity reached)',
      note: 'Online pre-registration has closed as capacity was reached. Please ask the venue about same-day registration availability.',
      options: [
        { label: 'Standard Buy-in', amount: 23000, chips: '60,000 chips' }
      ]
    }
  },
  {
    id: 'w-mystery',
    category: 'wolf',
    status: 'past',
    name: 'WOLF Mystery Bounty',
    flight: 'Single Day',
    tags: ['NLH', 'Bounty'],
    year: 2026,
    month: 7,
    day: 12,
    dateLabel: '7/12 (Sun) 13:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 30000,
    fee: 4000,
    guarantee: 4000000,
    startingStack: 40000,
    levelMinutes: 25,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'Half of each buy-in goes into the mystery bounty pool. Draw an envelope for every player you knock out and chase bounties of up to ¥1,000,000 in this exciting event.',
    details: [
      'Bounties are active on knockouts from Lv.9 onward.',
      'Mystery bounty envelopes range from ¥10,000 to ¥1,000,000.',
      'Results are posted on the Results tab and our official X account.'
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
      { pos: 1, player: 'TAKESHI "Wolf King" SATO', country: 'JP', prize: 1420000, bounty: 380000 },
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
    name: 'WOLF Opening Event',
    flight: 'Single Day',
    tags: ['NLH', 'Accumulator'],
    year: 2026,
    month: 7,
    day: 10,
    dateLabel: '7/10 (Fri) 18:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 15000,
    fee: 2000,
    guarantee: 2000000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Until end of Lv.8',
    reentry: 'Unlimited',
    gameType: "No-Limit Hold'em",
    description: 'The opening event that kicks off the series. An easy-entry buy-in makes it the perfect warm-up for the whole series.',
    details: [
      'Accumulator format — stacks from multiple entries are combined.',
      'A series original card protector was given to every entrant.'
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
    name: 'WOLF Warm-Up',
    flight: 'Single Day',
    tags: ['NLH', 'Turbo', 'Preseason'],
    year: 2026,
    month: 6,
    day: 28,
    dateLabel: '6/28 (Sun) 15:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 10000,
    fee: 1500,
    guarantee: 1000000,
    startingStack: 25000,
    levelMinutes: 15,
    lateReg: 'Until end of Lv.6',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'A preseason event ahead of the main July series. Test your skills on the same turbo structure used in the main events.',
    details: [
      'As a preseason event, it does not award Series ranking points.',
      'Cashers received a ¥5,000 discount ticket valid for the July main series.'
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
      { pos: 1, player: 'GORO "Moonlight" TACHIBANA', country: 'JP', prize: 349000, bounty: 0 },
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
    name: 'WOLF Summer Final',
    flight: 'Single Day',
    tags: ['NLH', 'Season Finale'],
    year: 2026,
    month: 8,
    day: 8,
    dateLabel: '8/8 (Sat) 12:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 40000,
    fee: 5000,
    guarantee: 6000000,
    startingStack: 50000,
    levelMinutes: 30,
    lateReg: 'Until end of Lv.9',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'A special event closing out the summer season. Top finishers in the Series ranking receive the Season Champion title and additional prizes.',
    details: [
      'The top 8 in the Series ranking are invited with a buy-in exemption.',
      'Full regulations will be published one week before the event.'
    ],
    structure: STRUCTURE_DEEP,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'openSoon',
      stateLabel: 'Opening Soon',
      entries: 0,
      cap: 300,
      closesLabel: 'Registration opens: 7/25 (Sat) 10:00',
      note: 'Please wait for registration to open. We will notify your registered email when it does.',
      options: [
        { label: 'Standard Buy-in', amount: 45000, chips: '50,000 chips' }
      ]
    }
  },

  {
    id: 'w-winter-main',
    category: 'wolf',
    status: 'past',
    name: 'WOLF WINTER FESTIVAL 2025 Main Event',
    flight: 'Single Day',
    tags: ['NLH', 'Past Series'],
    year: 2025,
    month: 12,
    day: 20,
    dateLabel: '2025/12/20 (Sat) 12:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Main Floor',
    buyin: 40000,
    fee: 5000,
    guarantee: 8000000,
    startingStack: 50000,
    levelMinutes: 40,
    lateReg: 'Until end of Lv.9',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'The Main Event of the previous Winter Series. Past series results are available in the archive.',
    details: [
      'Archive of the 2025 Winter Series.',
      'Results can be viewed on the Results tab.'
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
      { pos: 1, player: 'HIDEO "Winter General" KANZAKI', country: 'JP', prize: 2410000, bounty: 0 },
      { pos: 2, player: 'ALEX WONG', country: 'HK', prize: 1500000, bounty: 0 },
      { pos: 3, player: 'MIYU TAKAHASHI', country: 'JP', prize: 1050000, bounty: 0 },
      { pos: 4, player: 'JOON-HO LEE', country: 'KR', prize: 760000, bounty: 0 },
      { pos: 5, player: 'KENJI ABE', country: 'JP', prize: 570000, bounty: 0 }
    ]
  },

  /* ---------- UTAGE ---------- */
  {
    id: 'u-special',
    category: 'utage',
    status: 'running',
    name: 'UTAGE Special Tournament',
    flight: 'Single Day',
    tags: ['NLH', 'BB Ante'],
    year: 2026,
    month: 7,
    day: 16,
    dateLabel: '7/16 (Thu) 14:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Utage Floor',
    buyin: 25000,
    fee: 3000,
    guarantee: 3000000,
    startingStack: 35000,
    levelMinutes: 25,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'The flagship event of the UTAGE series. Held on a special floor themed around Japanese hospitality; cashers receive a UTAGE original trophy in addition to prize money.',
    details: [
      'Guests in traditional wear (yukata / jinbei) are welcome. Dress code is smart casual.',
      'The winner receives a UTAGE original trophy and additional prizes on top of the prize money.',
      'Food and drink in the venue are served from the dedicated Utage Floor menu.'
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
      nextBreak: '18:10 (10 min after Lv.12)',
      tables: 8
    }
  },
  {
    id: 'u-sunday',
    category: 'utage',
    status: 'future',
    name: 'UTAGE Sunday Major',
    flight: 'Single Day',
    tags: ['NLH', 'Sunday'],
    year: 2026,
    month: 7,
    day: 19,
    dateLabel: '7/19 (Sun) 13:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Utage Floor',
    buyin: 12000,
    fee: 2000,
    guarantee: 1500000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 2 times',
    gameType: "No-Limit Hold'em",
    description:
      'A special series edition of the regular Sunday major. The guarantee is tripled from the usual for this event.',
    details: [
      'A special series edition of the regular weekly Sunday event.',
      'Cashers receive a free entry ticket to the next Sunday Major.'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: 'Open',
      entries: 97,
      cap: 160,
      closesLabel: 'Until 7/19 (Sun) 16:00 (end of Lv.8)',
      note: 'Same-day registration at the venue is available, but advance registration is recommended.',
      options: [
        { label: 'Standard Buy-in', amount: 14000, chips: '30,000 chips' }
      ]
    }
  },
  {
    id: 'u-night-turbo',
    category: 'utage',
    status: 'past',
    name: 'UTAGE Night Turbo',
    flight: 'Single Day',
    tags: ['NLH', 'Turbo'],
    year: 2026,
    month: 7,
    day: 11,
    dateLabel: '7/11 (Sat) 20:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Utage Floor',
    buyin: 8000,
    fee: 1500,
    guarantee: 800000,
    startingStack: 20000,
    levelMinutes: 12,
    lateReg: 'Until end of Lv.6',
    reentry: 'Unlimited',
    gameType: "No-Limit Hold'em",
    description: 'An evening turbo event you can join on the way home from work. Fast 12-minute levels crown a winner the same night.',
    details: [
      'Entry after 22:00 is limited to guests aged 20 and over.',
      'If not decided by the end of the final level, placings are determined by chip count.'
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
      { pos: 1, player: 'RIKU "Night Demon" ENDO', country: 'JP', prize: 242000, bounty: 0 },
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
    name: 'UTAGE Hassaku Festival Special',
    flight: 'Single Day',
    tags: ['NLH', 'Seasonal'],
    year: 2026,
    month: 8,
    day: 2,
    dateLabel: '8/2 (Sun) 13:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Utage Floor',
    buyin: 15000,
    fee: 2000,
    guarantee: 2000000,
    startingStack: 30000,
    levelMinutes: 20,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'A seasonal special inspired by Hassaku (the first day of the eighth lunar month). All guests receive a UTAGE original keepsake.',
    details: [
      'Guests arriving in yukata receive +3,000 bonus chips.',
      'Complimentary wagashi and matcha will be served (while supplies last).'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: 'Open',
      entries: 12,
      cap: 150,
      closesLabel: 'Until 8/2 (Sun) 16:00 (end of Lv.8)',
      note: 'Guests arriving in yukata receive +3,000 bonus chips.',
      options: [
        { label: 'Standard Buy-in', amount: 17000, chips: '30,000 chips' }
      ]
    }
  },

  /* ---------- OTHER ---------- */
  {
    id: 'o-daily88',
    category: 'other',
    status: 'past',
    name: 'Daily Deep #88',
    flight: 'Single Day',
    tags: ['NLH', 'Daily'],
    year: 2026,
    month: 6,
    day: 21,
    dateLabel: '6/21 (Sun) 19:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Side Floor',
    buyin: 6000,
    fee: 1000,
    guarantee: 500000,
    startingStack: 20000,
    levelMinutes: 15,
    lateReg: 'Until end of Lv.6',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'A daily regular event. With an affordable buy-in and a deep stack, it is a popular weeknight staple.',
    details: [
      'A regular event held daily at 19:00.',
      'Awards points toward the Daily Leaderboard.'
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
      { pos: 1, player: 'KOJI "Night-Shift" HAMADA', country: 'JP', prize: 123000, bounty: 0 },
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
    name: 'Main Event Satellite #4 — Win a ¥55,000 Main Event Seat! Re-entry Super Turbo Edition',
    flight: 'Single Day',
    tags: ['NLH', 'Satellite', 'Turbo'],
    year: 2026,
    month: 7,
    day: 17,
    dateLabel: '7/17 (Fri) 19:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Side Floor',
    buyin: 5000,
    fee: 500,
    guarantee: 0,
    startingStack: 15000,
    levelMinutes: 15,
    lateReg: 'Until end of Lv.6',
    reentry: 'Up to 2 times',
    gameType: "No-Limit Hold'em",
    description:
      'A satellite for a seat in the WOLF CHAMPIONSHIP Main Event (¥55,000). One seat is awarded per 10 entrants.',
    details: [
      'One Main Event seat is awarded per 10 entrants.',
      'Once you win a seat, your remaining chips are void regardless of placing.',
      'Seats cannot be transferred or exchanged for cash.'
    ],
    structure: STRUCTURE_TURBO,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'open',
      stateLabel: 'Open',
      entries: 34,
      cap: 80,
      closesLabel: 'Until 7/17 (Fri) 20:45 (end of Lv.6)',
      note: 'A won seat can be used in either Day 1B or Day 1C.',
      options: [
        { label: 'Standard Buy-in', amount: 5500, chips: '15,000 chips' }
      ]
    }
  },
  {
    id: 'o-ladies',
    category: 'other',
    status: 'future',
    name: 'Ladies Event',
    flight: 'Single Day',
    tags: ['NLH', 'Ladies Only'],
    year: 2026,
    month: 7,
    day: 23,
    dateLabel: '7/23 (Thu) 13:00',
    venue: 'CARTA POKER LOUNGE Shibuya — Side Floor',
    buyin: 10000,
    fee: 1500,
    guarantee: 1000000,
    startingStack: 25000,
    levelMinutes: 20,
    lateReg: 'Until end of Lv.8',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      'A special event for women players only. The winner receives a Main Event seat for the next series in addition to prize money.',
    details: [
      'A women-only event. ID is checked at registration.',
      'The winner receives a Main Event seat for the next series.'
    ],
    structure: STRUCTURE_STANDARD,
    stats: { entries: 0, players: 0, avgStack: 0, totalChips: 0, prizePool: 0, itm: 0 },
    registration: {
      state: 'openSoon',
      stateLabel: 'Opening Soon',
      entries: 0,
      cap: 100,
      closesLabel: 'Registration opens: 7/18 (Sat) 10:00',
      note: 'Please wait for registration to open. We will notify your registered email when it does.',
      options: [
        { label: 'Standard Buy-in', amount: 11500, chips: '25,000 chips' }
      ]
    }
  },
  {
    id: 'o-charity',
    category: 'other',
    status: 'past',
    name: 'Charity Bounty',
    flight: 'Single Day',
    tags: ['NLH', 'Bounty', 'Charity'],
    year: 2026,
    month: 7,
    day: 13,
    dateLabel: '7/13 (Mon) 18:30',
    venue: 'CARTA POKER LOUNGE Shibuya — Side Floor',
    buyin: 10000,
    fee: 2000,
    guarantee: 0,
    startingStack: 25000,
    levelMinutes: 15,
    lateReg: 'Until end of Lv.6',
    reentry: 'Up to 1 time',
    gameType: "No-Limit Hold'em",
    description:
      "A charity event donating part of the entry fee to a children's support charity. Earn a ¥2,000 bounty for each knockout.",
    details: [
      "¥1,000 of each entry fee was donated to a children's support charity.",
      'A report on the donations is published on our official site.'
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
      { pos: 1, player: 'MASARU "Iron Man" IGARASHI', country: 'JP', prize: 181000, bounty: 22000 },
      { pos: 2, player: 'CHLOE TAN', country: 'SG', prize: 113000, bounty: 8000 },
      { pos: 3, player: 'REN HAYASHI', country: 'JP', prize: 78000, bounty: 14000 },
      { pos: 4, player: 'KOTA MAEDA', country: 'JP', prize: 57000, bounty: 4000 },
      { pos: 5, player: 'JESSICA LIU', country: 'TW', prize: 45000, bounty: 6000 }
    ]
  }
];
