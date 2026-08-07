// mock モード用のサンプルデータ。
// 実 API の VenueEvent / EventLevel / EventPlayer スキーマ(standard swagger)に沿わせているので、
// これを通して adapter を検証すれば live 切替時の変換ロジックがそのまま使える。

const LEAGUE_WOLF = { id: '11111111-1111-1111-1111-111111111111', name: 'Wolf' };
const LEAGUE_UTAGE = { id: '22222222-2222-2222-2222-222222222222', name: 'Utage 宴' };
const LEAGUE_OTHER = { id: '33333333-3333-3333-3333-333333333333', name: 'Weekly' };

const VENUE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'CARTA Roppongi',
  location: { text: 'Tokyo', city: 'Tokyo', timeZone: 'Asia/Tokyo' },
  logoUrl: '',
  bannerUrl: '',
};

const NLH = { id: 'gt-nlh', name: "No Limit Hold'em", limit: 'none', category: 'texasHoldem' };

// EventLevel[] を生成(index, sb/bb/ante, minutes)
function makeLevels(blinds, minutes, breakEvery, breakMinutes) {
  const rows = [];
  let idx = 0;
  blinds.forEach((b, i) => {
    rows.push({
      id: idx,
      index: idx,
      type: 'level',
      smallBlind: b[0],
      bigBlind: b[1],
      ante: b[2],
      minutes,
    });
    idx += 1;
    if ((i + 1) % breakEvery === 0 && i !== blinds.length - 1) {
      rows.push({ id: idx, index: idx, type: 'break', minutes: breakMinutes });
      idx += 1;
    }
  });
  return rows;
}

const BLINDS_STANDARD = [
  [100, 200, 200], [200, 300, 300], [200, 400, 400], [300, 600, 600],
  [400, 800, 800], [500, 1000, 1000], [1000, 1500, 1500], [1000, 2000, 2000],
  [1500, 3000, 3000], [2000, 4000, 4000], [3000, 6000, 6000], [4000, 8000, 8000],
  [5000, 10000, 10000], [10000, 15000, 15000],
];

const LEVELS_STANDARD = makeLevels(BLINDS_STANDARD, 30, 4, 15);
// 20分レベルの大会用(サテライト / ウィークリー)。イベント側の levelMinutes と揃える
const LEVELS_TURBO = makeLevels(BLINDS_STANDARD, 20, 4, 10);

// 一つの buyin バリアント
function buyin(amount, fee, chips, description) {
  return {
    id: 'buyin-' + amount,
    buyin: amount,
    fee,
    amount: amount + fee,
    chips,
    currencySymbol: '¥',
    description: description || 'Entry',
    default: true,
  };
}

const NAMES = [
  ['Kenji', 'Tanaka', 'JP'], ['Yuki', 'Sato', 'JP'], ['Marco', 'Rossi', 'IT'],
  ['Anna', 'Nguyen', 'VN'], ['Liam', "O'Brien", 'IE'], ['Sofia', 'Garcia', 'ES'],
  ['Haruto', 'Suzuki', 'JP'], ['Chen', 'Wei', 'CN'], ['Emma', 'Johnson', 'US'],
  ['Noah', 'Kim', 'KR'],
];

function makePlayer(i) {
  const [firstname, lastname, code] = NAMES[i % NAMES.length];
  return {
    id: 'pl-' + i,
    firstname,
    lastname,
    nickname: firstname,
    preferredName: `${firstname} ${lastname[0]}.`,
    countryName: code,
    countryUrl: `https://api.pokerlens.net/v1/country/${code}/flag`,
  };
}

// EventPlayer[](結果タブ用)
function makePlayers(n) {
  const prizes = [1200000, 780000, 520000, 360000, 260000, 190000, 140000, 110000, 90000, 75000];
  return Array.from({ length: n }, (_, i) => ({
    position: i + 1,
    busted: true,
    player: makePlayer(i),
    payout: {
      payoutAmount: prizes[i] || 60000,
      bountyAmount: i < 3 ? 50000 : 0,
    },
  }));
}

// 進行中の大会の着席者(Live タブの座席表用)。
// 実データと同じく tableIndex / seatIndex / chipsCount を持ち、busted は false。
// 一部の席は飛ばして、バストで抜けた空席がある状態を再現する。
function makeSeatedPlayers(count, seatsPerTable) {
  const out = [];
  let table = 1;
  let seat = 1;
  let guard = 0;
  while (out.length < count && guard++ < count * 3) {
    const vacant = (table * 7 + seat * 3) % 11 === 0; // 決め打ちの空席パターン
    if (!vacant) {
      const i = out.length;
      out.push({
        busted: false,
        tableIndex: table,
        seatIndex: seat,
        chipsCount: (((i * 37) % 90) + 8) * 5000,
        player: makePlayer(i),
      });
    }
    seat += 1;
    if (seat > seatsPerTable) { seat = 1; table += 1; }
  }
  return out;
}

// GET /v1/event/{id}/payouts のレスポンス([{ position, percentage, amount, description, ... }])。
// description は現物賞品の表記("4 Tickets" 等)で、現金のみの大会では空文字。
function makePayouts(rows) {
  return rows.map(([position, percentage, amount, description]) => ({
    position,
    percentage,
    amount,
    payoutAmount: amount,
    payoutDeal: null,
    bountyAmount: null,
    ticketAmount: null,
    ticketCount: null,
    description: description || '',
    winner: null,
  }));
}

// VenueEvent 本体
function venueEvent(over) {
  return {
    id: over.id,
    name: over.name,
    dailyDetails: {
      name: over.name,
      startDate: over.startDate, // ローカル wall-clock 想定の ISO(例 2026-07-30T12:00:00)
      day: over.day || 1,
      flight: over.flight || '',
      levelMinutes: over.levelMinutes || 30,
      playerAllowed: over.cap || 0,
      subscriptionAllowed: over.subscriptionAllowed !== false,
      subscriptionClose: over.subscriptionClose || null,
      // levelDescription = 管理画面の Description(Info タブに出す説明文)
      levelDescription: over.description || '',
      // description = 管理画面の Announcement(運用メモ。表示には使わない)
      description: over.announcement || '',
      logoUrl: '',
    },
    behaviour: {
      code: over.behaviourCode || 'freezeout',
      tags: over.tags || '',
      gameType: NLH,
      league: over.league,
      days: over.days || 1,
      multiDay: !!over.multiDay,
    },
    stats: Object.assign(
      {
        totalEntries: 0, totalPlayers: 0, averageChipsCount: 0, totalChipsCount: 0,
        totalPayoutAmount: 0, totalPayouts: 0, totalReservations: 0, totalTables: 0,
        guaranteedAmount: over.guarantee || 0,
      },
      over.stats || {}
    ),
    status: {
      code: over.statusCode, // 'opened' | 'running' | 'closed'
      levelIndex: over.levelIndex || 0,
      level: { index: over.levelIndex || 0, elapsedSeconds: over.elapsedSeconds || 0 },
      levelMinutes: over.levelMinutes || 30,
      date: over.startDate,
    },
    subscription: {
      buyin: over.buyin,
      buyins: over.buyins || [over.buyin],
      guaranteedAmount: over.guarantee || 0,
      lateRegistrationLevel: over.lateRegLevel || 8,
      allowRebuy: !!over.allowRebuy,
      rebuyAllowed: over.allowRebuy ? 2 : 0,
      currencySymbol: '¥',
    },
    description: {
      chips: over.buyin ? `${over.buyin.chips.toLocaleString('en-US')} chips` : '',
      multipleEntries: over.allowRebuy ? 'Re-entry (max 2)' : 'Freezeout',
      guaranteed: over.guarantee ? `¥${over.guarantee.toLocaleString('en-US')} GTD` : '',
    },
    venue: VENUE,
    lastUpdated: '2026-07-29T00:00:00',
  };
}

// ---- 実際のイベント群 ----
const EVENTS = [
  venueEvent({
    id: 'evt-wolf-main',
    name: 'Wolf Main Event — Day 1A',
    league: LEAGUE_WOLF,
    statusCode: 'running',
    startDate: '2026-07-29T12:00:00',
    flight: 'Day 1A',
    levelMinutes: 40,
    levelIndex: 8,
    elapsedSeconds: 600,
    lateRegLevel: 9,
    guarantee: 10000000,
    // 実データに合わせて Description(表示) と Announcement(運用メモ) を別々に持たせる
    description: '11名が Day 2 に進出します。',
    announcement: 'Unlimited',
    buyin: buyin(30000, 3000, 30000, 'Standard'),
    allowRebuy: false,
    stats: {
      totalEntries: 212, totalPlayers: 138, averageChipsCount: 46080,
      totalChipsCount: 6360000, totalPayoutAmount: 6360000, totalPayouts: 27,
      totalTables: 18, guaranteedAmount: 10000000,
    },
  }),
  venueEvent({
    id: 'evt-utage-deep',
    name: 'Utage Deepstack',
    league: LEAGUE_UTAGE,
    statusCode: 'opened',
    startDate: '2026-07-31T18:00:00',
    levelMinutes: 30,
    lateRegLevel: 10,
    guarantee: 3000000,
    cap: 300,
    subscriptionClose: '2026-07-31T19:30:00',
    buyin: buyin(15000, 2000, 40000, 'Deepstack'),
    buyins: [buyin(15000, 2000, 40000, 'Deepstack'), buyin(25000, 3000, 70000, 'High Roller add')],
    allowRebuy: true,
    stats: { totalReservations: 84, guaranteedAmount: 3000000 },
  }),
  venueEvent({
    id: 'evt-wolf-sat',
    name: 'Wolf Satellite',
    league: LEAGUE_WOLF,
    statusCode: 'opened',
    startDate: '2026-08-01T19:00:00',
    levelMinutes: 20,
    lateRegLevel: 6,
    guarantee: 0,
    cap: 120,
    subscriptionClose: '2026-08-01T20:00:00',
    description: '5エントリー毎に1名様がマルチ・チケットを獲得することができます。',
    announcement: '5E毎にマルチチケット',
    buyin: buyin(5000, 500, 15000, 'Satellite'),
    stats: { totalReservations: 41 },
  }),
  venueEvent({
    id: 'evt-weekly-bounty',
    name: 'Sunday Bounty',
    league: LEAGUE_OTHER,
    statusCode: 'closed',
    startDate: '2026-07-26T13:00:00',
    levelMinutes: 20,
    lateRegLevel: 8,
    guarantee: 1500000,
    buyin: buyin(10000, 1000, 20000, 'Bounty'),
    allowRebuy: true,
    stats: {
      totalEntries: 156, averageChipsCount: 0, totalChipsCount: 3120000,
      totalPayoutAmount: 2400000, totalPayouts: 24, totalTables: 0,
    },
  }),
];

const LEVELS_BY_ID = {
  'evt-wolf-main': makeLevels(
    [
      [100, 100, 100], [100, 200, 200], [200, 300, 300], [200, 400, 400],
      [300, 500, 500], [300, 600, 600], [400, 800, 800], [500, 1000, 1000],
      [600, 1200, 1200], [1000, 1500, 1500], [1000, 2000, 2000], [1500, 2500, 2500],
    ],
    40, 4, 15
  ),
  'evt-utage-deep': LEVELS_STANDARD,
  'evt-wolf-sat': LEVELS_TURBO,
  'evt-weekly-bounty': LEVELS_TURBO,
};

const PLAYERS_BY_ID = {
  'evt-weekly-bounty': makePlayers(10),
  'evt-wolf-main': makeSeatedPlayers(138, 9),   // 進行中: 9 max × 16 卓ぶんの着席者
};

const PAYOUTS_BY_ID = {
  // 通常の賞金大会(percentage あり / description なし)
  'evt-wolf-main': makePayouts([
    [1, 24, 1526400], [2, 15, 954000], [3, 10.5, 667800], [4, 7.8, 496080],
    [5, 6, 381600], [6, 4.6, 292560], [7, 3.6, 228960], [8, 2.8, 178080],
    [9, 2.2, 139920],
  ]),
  // サテライト(percentage 0 / description にチケット枚数)
  'evt-wolf-sat': makePayouts([
    [1, 0, 40000, '4 Tickets'], [2, 0, 40000, '4 Tickets'],
    [3, 0, 30000, '3 Tickets'], [4, 0, 30000, '3 Tickets'],
    [5, 0, 20000, '2 Tickets'], [6, 0, 20000, '2 Tickets'],
  ]),
  'evt-weekly-bounty': makePayouts([
    [1, 38.7, 928800], [2, 25.8, 619200], [3, 16.1, 386400],
    [4, 11.3, 271200], [5, 8.1, 194400],
  ]),
  // 未設定の大会(payouts が空 = まだ組んでいない)は evt-utage-deep で再現
};

function findEvent(id) {
  return EVENTS.find((e) => e.id === id) || null;
}

// mock ルータ: 実 API と同じ path で呼ばれる想定
export function mockRequest(method, path, body) {
  // POST /v1/event/search
  if (method === 'POST' && path === '/v1/event/search') {
    let results = EVENTS.slice();
    const opt = body || {};
    if (opt.status) {
      // 検索の status enum(scheduled|running|results|closed)→ VenueEvent.status.code へ寄せる
      const map = { scheduled: 'opened', running: 'running', results: 'closed', closed: 'closed' };
      const want = map[opt.status] || opt.status;
      results = results.filter((e) => e.status.code === want);
    }
    if (opt.leagueId) {
      results = results.filter((e) => e.behaviour.league && e.behaviour.league.id === opt.leagueId);
    }
    return {
      pageNumber: 0,
      pageSize: results.length,
      totalNumberOfRecords: results.length,
      totalNumberOfPages: 1,
      results,
    };
  }

  const m = path.match(/^\/v1\/event\/([^/]+)(?:\/([^/]+))?$/);
  if (m) {
    const id = m[1];
    const part = m[2];
    const ev = findEvent(id);
    if (!ev) return null;
    if (!part) return ev; // GET /v1/event/{id}
    if (part === 'levels') return LEVELS_BY_ID[id] || [];
    if (part === 'players') return PLAYERS_BY_ID[id] || [];
    if (part === 'structure') return LEVELS_BY_ID[id] || [];
    if (part === 'payouts') return PAYOUTS_BY_ID[id] || [];
  }

  // 未対応 path はエラーにせず空で返す(開発中の握りつぶし)
  return null;
}

export const _fixtures = { EVENTS, LEVELS_BY_ID, PLAYERS_BY_ID, PAYOUTS_BY_ID };
