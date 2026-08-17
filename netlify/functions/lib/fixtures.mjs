// mock モード用のサンプルデータ。
// 実 API の VenueEvent / EventLevel / EventPlayer スキーマ(standard swagger)に沿わせているので、
// これを通して adapter を検証すれば live 切替時の変換ロジックがそのまま使える。

// ---- デモ用の日付アンカー ----------------------------------------------
// 開催日を固定日で持つと、時間の経過とともにデモの表示が壊れる。
// app.js の headStatus() は「開始時刻を過ぎ、レジクロも過ぎている」大会を LIVE と
// 判定するため、固定日が過去になると開催予定の大会まで LIVE バッジになり、
// 未来の大会が消えて STARTS IN / REG CLOSE IN のカウントダウンも出なくなる。
// そのため日付は mockRequest の呼び出しごとに「今」を基準に組み立てる。

const JST_OFFSET_MS = 9 * 3600e3;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ms(絶対時刻)を JST の壁時計として "YYYY-MM-DDTHH:MM:SS" にする。
// dailyDetails.startDate / subscriptionClose は実 API もオフセット無しの
// 会場ローカル時刻(= JST)で返すので、同じ形に揃える。
// +9h ずらしてから UTC 系のゲッタで読むことで、サーバーの TZ 設定に依存させない。
function jstWallClock(ms) {
  const d = new Date(ms + JST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

// status.date 用。実 API はオフセット付き("2026-08-07T13:03:23.723+02:00")で返し、
// adapter は Date.parse でそのまま絶対時刻として扱うため、こちらも明示する。
function jstInstant(ms) {
  return jstWallClock(ms) + '+09:00';
}

// JST の「今日」から dayOffset 日ずらした日の hour:minute(壁時計 ISO)。
function jstDayAt(now, dayOffset, hour, minute) {
  const d = new Date(now + JST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return jstWallClock(d.getTime() - JST_OFFSET_MS);
}

// 直近に過ぎた「hour:00(JST)」の絶対時刻。今日の分がまだ来ていなければ前日を返す。
// 進行中の大会の開始時刻に使う。
//
// ここを「now の 3 時間前」のように now からの相対で決めてはいけない。
// 経過時間が常に一定になり、app.js が 25 秒ごとにポーリングするたびに
// レベルタイマーが同じ残り時間へ巻き戻ってしまう。
// now と無関係な固定の時刻を基準にすることで、時間が進むほど経過時間が増え、
// タイマーが実時間どおりに減っていく。
function lastOccurrenceAt(now, hour) {
  const d = new Date(now + JST_OFFSET_MS);
  d.setUTCHours(hour, 0, 0, 0);
  const ms = d.getTime() - JST_OFFSET_MS;
  return ms > now ? ms - 86400e3 : ms;
}

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

/* EventLevel[] を生成する。**実データの形に厳密に合わせてある**。
 * ここを崩すと mock で通っても live で壊れる。実際、以前は休憩行にも通し番号の index を
 * 振っていたため、「休憩行の index は 0」という実データの癖を mock で再現できず、
 * 休憩中に表示が全部ずれるバグ(#38)を取り逃がしていた。
 *
 * 実データの形(2026-08-17 に live の進行中大会で確認):
 *   id    … 休憩も含めた全行の通し番号(1 始まり)。**行を一意に指せる唯一のキー**
 *   index … レベル行だけの通し番号(1 始まり)。**休憩行は 0** で返る
 *   type  … 1=レベル / 2=休憩(文字列ではなく数値)
 *   先頭に「受付前の休憩」が入る(buildStructure が表示から落とす)
 */
function makeLevels(blinds, minutes, breakEvery, breakMinutes) {
  const rows = [];
  let id = 0;
  let levelIndex = 0;
  const push = (row) => rows.push(Object.assign({ id: (id += 1) }, row));
  const breakRow = (m) => ({ index: 0, type: 2, smallBlind: 0, bigBlind: 0, ante: 0, minutes: m });

  push(breakRow(30)); // 受付前の休憩。実データには必ず入っている
  blinds.forEach((b, i) => {
    levelIndex += 1;
    push({ index: levelIndex, type: 1, smallBlind: b[0], bigBlind: b[1], ante: b[2], minutes });
    if ((i + 1) % breakEvery === 0 && i !== blinds.length - 1) push(breakRow(breakMinutes));
  });
  return rows;
}

/* ---------- 繰り上げ動作を目で見るための mock 専用の大会 ----------
 * レベルが終わってからサーバーが追いつくまでの「遅れ」を再現する。実データでは
 * レベル間で 9 秒 / 休憩に入るときで 22 秒(2026-08-17 の本番で実測)。その間クライアントは
 * 手元のストラクチャーで繰り上げて表示する(app.js の projectedStep())。
 * 実際の 15〜40 分レベルを待たずに確認できるよう、**15 秒**ごとに項目が切り替わり、
 * 切り替わってから **10 秒**は前の項目を残り 0 秒で返し続ける大会を用意した。
 *
 * minutes が 0.25(= 15 秒)なのでストラクチャータブには 0.25 min と出るが、
 * mock 専用の確認用データなので割り切っている。 */
const DEMO_STEP_SEC = 15;   // 1 項目の長さ
const DEMO_LAG_SEC = 10;    // 0 になってからサーバーが次を返すまでの遅れ

const DEMO_LEVELS = (function () {
  const rows = [];
  let id = 0;
  let levelIndex = 0;
  const mins = DEMO_STEP_SEC / 60;
  const push = (r) => rows.push(Object.assign({ id: (id += 1) }, r));
  const breakRow = () => ({ index: 0, type: 2, smallBlind: 0, bigBlind: 0, ante: 0, minutes: mins });

  push(breakRow()); // 受付前の休憩(実データに合わせる。buildStructure が落とす)
  /* レベルを 16 個並べて 4 つごとに休憩を挟む(= 19 項目 / 一巡 約 4 分 45 秒)。
   * 一巡して Lv.1 に戻る瞬間だけは、繰り上げ先が無くなるので 00:00 が数秒残る
   * (最終レベルに達したときの正規のフォールバック)。ここを踏みにくくするために
   * 一巡を長めに取ってある。 */
  const blinds = [
    [100, 200, 200], [200, 400, 400], [300, 600, 600], [500, 1000, 1000],
    [800, 1600, 1600], [1000, 2000, 2000], [1500, 3000, 3000], [2000, 4000, 4000],
    [3000, 6000, 6000], [4000, 8000, 8000], [5000, 10000, 10000], [8000, 16000, 16000],
    [10000, 20000, 20000], [15000, 30000, 30000], [20000, 40000, 40000], [30000, 60000, 60000],
  ];
  blinds.forEach((b, i) => {
    levelIndex += 1;
    push({ index: levelIndex, type: 1, smallBlind: b[0], bigBlind: b[1], ante: b[2], minutes: mins });
    if ((i + 1) % 4 === 0 && i !== blinds.length - 1) push(breakRow());
  });
  return rows;
})();

/* 「今どの項目にいるべきか」を時刻から決める。切り替わってから DEMO_LAG_SEC 秒のあいだは
 * **前の項目を残り 0 秒で返す** — ここがクライアントの繰り上げが働く区間。
 * 一巡したら Lv.1 に戻るので、何度でも観察できる。 */
function demoStatus(now) {
  const cyc = DEMO_LEVELS.slice(1); // 受付前の休憩を除いた進行順
  const period = cyc.length * DEMO_STEP_SEC;
  const t = Math.floor(now / 1000) % period;
  let i = Math.floor(t / DEMO_STEP_SEC);
  let elapsed = t % DEMO_STEP_SEC;
  if (elapsed < DEMO_LAG_SEC) {
    i = (i - 1 + cyc.length) % cyc.length;
    elapsed = DEMO_STEP_SEC; // 残り 0 秒のまま据え置く
  }
  return { levelId: cyc[i].id, levelIndex: cyc[i].index, elapsedSeconds: elapsed };
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
      /* level.id は levels[] の行 id。休憩中は levelIndex も level.index も 0 になるため、
       * 現在位置を一意に指せるのは id だけ(adapter の buildLive() が id で引く)。 */
      level: {
        id: over.levelId || 0,
        index: over.levelIndex || 0,
        elapsedSeconds: over.elapsedSeconds || 0,
      },
      levelMinutes: over.levelMinutes || 30,
      // status.date は「この status を取得した時刻」のスナップショット。
      // adapter の buildLive() が endsAt(= date + レベル残り時間)の基準にするので、
      // 進行中の大会では statusDate に「今」を渡してレベルタイマーを動かす。
      // 指定が無ければ従来どおり開始時刻を入れる(開始前/終了後は使われない)。
      date: over.statusDate || over.startDate,
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
// now(絶対時刻 ms)を基準に、進行中 1 / 開催予定 2 / 終了 1 を組み立てる。
// カードの状態表示(LIVE / STARTS IN / CLOSED)が一通り出るようにしてある。
function buildEvents(now) {
  // 進行中の大会は「直近の 11:00 開始」に固定する。開始時刻を絶対時刻で持つことで
  // 経過時間が実時間とともに増え、レベルタイマーが正しく減っていく。
  // 経過がレベル長を超えたら次のレベルに進んだものとして先頭から数え直す。
  const LIVE_LEVEL_MINUTES = 40;
  const liveStart = lastOccurrenceAt(now, 11);
  const liveElapsed = Math.floor((now - liveStart) / 1000) % (LIVE_LEVEL_MINUTES * 60);
  const demo = demoStatus(now); // 繰り上げ確認用(15 秒ごとに切り替わり、10 秒遅れて追いつく)

  return [
  venueEvent({
    id: 'evt-wolf-main',
    name: 'Wolf Main Event — Day 1A',
    league: LEAGUE_WOLF,
    statusCode: 'running',
    // 本日 11:00 開始の進行中の大会。
    // status.date は「この状態を取得した時刻」なので今を渡し、経過時間は開始からの
    // 実経過にする。adapter が endsAt = status.date + (レベル長 - 経過) を計算するため、
    // ポーリングのたびに同じ絶対時刻が返り、タイマーが巻き戻らずに減っていく。
    startDate: jstWallClock(liveStart),
    statusDate: jstInstant(now),
    flight: 'Day 1A',
    levelMinutes: LIVE_LEVEL_MINUTES,
    levelIndex: 8,
    // levels[] の行 id。Lv.8 は先頭の受付前休憩と Lv.4 のあとの休憩を挟んで 10 行目
    levelId: 10,
    elapsedSeconds: liveElapsed,
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
  /* 繰り上げ確認用(mock 専用)。15 秒ごとに項目が切り替わり、切り替わってから 10 秒は
   * サーバーが前の項目を返し続ける。その 10 秒のあいだ、タイマーが 00:00 で止まらずに
   * 次のレベル / 休憩へ繰り上がることを目で確認できる。詳細は demoStatus() のコメント。 */
  venueEvent({
    id: 'evt-demo-rollover',
    name: 'Rollover Demo (mock only)',
    league: LEAGUE_OTHER,
    statusCode: 'running',
    startDate: jstWallClock(liveStart),
    statusDate: jstInstant(now),
    levelMinutes: DEMO_STEP_SEC / 60,
    levelIndex: demo.levelIndex,
    levelId: demo.levelId,
    elapsedSeconds: demo.elapsedSeconds,
    lateRegLevel: 4,
    guarantee: 0,
    description: '繰り上げ動作の確認用。15 秒ごとにレベルが切り替わります。',
    buyin: buyin(5000, 500, 20000, 'Demo'),
    stats: {
      totalEntries: 24, totalPlayers: 12, averageChipsCount: 40000,
      totalChipsCount: 480000, totalPayoutAmount: 0, totalPayouts: 3, totalTables: 2,
    },
  }),
  /* 休憩中の大会。実データでは休憩に入ると status.levelIndex も status.level.index も 0 に
   * なり、現在位置を指せるのは status.level.id だけになる(#38)。この状態を mock でも
   * 再現しておかないと、休憩中の表示崩れをローカルで検知できない。
   * levelId 11 は LEVELS_STANDARD の Lv.8 と Lv.9 の間の休憩(15 分)。 */
  venueEvent({
    id: 'evt-utage-break',
    name: 'Utage Night Series — Day 1',
    league: LEAGUE_UTAGE,
    statusCode: 'running',
    startDate: jstWallClock(liveStart),
    statusDate: jstInstant(now),
    levelMinutes: 15,
    levelIndex: 0,
    levelId: 11,
    elapsedSeconds: 240, // 15 分休憩の 4 分経過 → 残り 11 分
    lateRegLevel: 9,
    guarantee: 3000000,
    description: '休憩明けは Lv.9 から再開します。',
    buyin: buyin(20000, 2000, 30000, 'Standard'),
    stats: {
      totalEntries: 96, totalPlayers: 41, averageChipsCount: 70000,
      totalChipsCount: 2870000, totalPayoutAmount: 3000000, totalPayouts: 12,
      totalTables: 5, guaranteedAmount: 3000000,
    },
  }),
  venueEvent({
    id: 'evt-utage-deep',
    name: 'Utage Deepstack',
    league: LEAGUE_UTAGE,
    statusCode: 'opened',
    // 翌日開催。STARTS IN のカウントダウンが出る(1 ヶ月以内のため)
    startDate: jstDayAt(now, 1, 18, 0),
    levelMinutes: 30,
    lateRegLevel: 10,
    guarantee: 3000000,
    cap: 300,
    subscriptionClose: jstDayAt(now, 1, 19, 30),
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
    // 3 日後開催。日付見出しが複数日にまたがる状態を再現する
    startDate: jstDayAt(now, 3, 19, 0),
    levelMinutes: 20,
    lateRegLevel: 6,
    guarantee: 0,
    cap: 120,
    subscriptionClose: jstDayAt(now, 3, 20, 0),
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
    // 4 日前に終了。Past 区切りと結果タブの表示に使う
    startDate: jstDayAt(now, -4, 13, 0),
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
  /* 開始まで 1 ヶ月以上ある大会。以前は 30 日より先だとカウントダウンを出さず OPEN 表示に
   * なっていた(#46)。ウルフはシリーズごと 1〜2 ヶ月先に公開されるため常にこの状態で、
   * カウントダウンが一度も出ていなかった。閾値を外した今も出ることを確認できるように残す。 */
  venueEvent({
    id: 'evt-wolf-series',
    name: 'Wolf Series Opener',
    league: LEAGUE_WOLF,
    statusCode: 'opened',
    startDate: jstDayAt(now, 45, 13, 0),
    levelMinutes: 40,
    lateRegLevel: 8,
    guarantee: 5000000,
    cap: 200,
    subscriptionClose: jstDayAt(now, 45, 16, 40),
    description: 'シリーズ開幕戦。',
    buyin: buyin(8000, 1000, 30000, 'Standard'),
    stats: { totalReservations: 12, guaranteedAmount: 5000000 },
  }),
  ];
}

const LEVELS_BY_ID = {
  'evt-wolf-main': makeLevels(
    [
      [100, 100, 100], [100, 200, 200], [200, 300, 300], [200, 400, 400],
      [300, 500, 500], [300, 600, 600], [400, 800, 800], [500, 1000, 1000],
      [600, 1200, 1200], [1000, 1500, 1500], [1000, 2000, 2000], [1500, 2500, 2500],
    ],
    40, 4, 15
  ),
  'evt-demo-rollover': DEMO_LEVELS,
  'evt-utage-break': LEVELS_STANDARD,
  'evt-utage-deep': LEVELS_STANDARD,
  'evt-wolf-sat': LEVELS_TURBO,
  'evt-weekly-bounty': LEVELS_TURBO,
};

const PLAYERS_BY_ID = {
  'evt-weekly-bounty': makePlayers(10),
  'evt-wolf-main': makeSeatedPlayers(138, 9),   // 進行中: 9 max × 16 卓ぶんの着席者
  'evt-utage-break': makeSeatedPlayers(41, 9),  // 休憩中: 5 卓ぶんの着席者
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

// ---- シリーズランキングのポイント ----------------------------------------
// 実 API と同じ形で返す。特に「reference.id は VenueEvent の id ではない」という
// 実 API の癖(逆引きできないので event-by-reference で変換するしかない)を
// mock でも再現しておく。ここを素直に大会 ID にしてしまうと、lib/ranking.mjs の
// 変換経路がローカルで一度も通らず、live に切り替えた瞬間に壊れる。
const RANKING_ID = 'rk-wolf-2026-02';
// ポイントを付ける大会は終了済みの 1 件だけ。他の大会では Prize / Results に
// ポイント列が出ないこと(= ご要望の「取得できたときのみ表示」)を確認できる。
const POINTS_EVENT_ID = 'evt-weekly-bounty';
const POINTS_REF_ID = 'mockref-8b21';

// 順位 → ポイント。実データに合わせて小数を混ぜてある(46.8 / 83.2 など)。
const MOCK_POINTS = [
  [1, 260], [2, 182], [3, 130], [4, 104], [5, 83.2],
  [6, 67.6], [7, 57.2], [8, 46.8], [9, 39],
];

function rankingPoints() {
  return MOCK_POINTS.map(([position, points]) => ({
    date: '2026-05-28T13:00:00',
    player: null, // includePlayerInfo=false のときの実 API の形に合わせる
    points,
    league: { id: LEAGUE_WOLF.id, name: 'WOLF SERIES of POKER 2026 #02' },
    inTheMoney: true,
    finalTable: position <= 9,
    totalPayoutAmount: 0,
    position,
    entries: 82,
    reference: { id: POINTS_REF_ID, description: 'Sunday Bounty', type: 'event' },
  }));
}

// mock ルータ: 実 API と同じ path で呼ばれる想定。
// イベントは呼び出しのたびに「今」を基準に組み立て直す。モジュールスコープに持つと
// warm な関数インスタンスが再利用される間ずっと同じ日付が返り、
// 時間の経過で進行中の大会のレベルタイマーが 00:00 のまま止まってしまうため。
export function mockRequest(method, path, body) {
  const events = buildEvents(Date.now());
  const findEvent = (id) => events.find((e) => e.id === id) || null;

  // POST /v1/event/search
  if (method === 'POST' && path === '/v1/event/search') {
    let results = events.slice();
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

  // --- ランキング ---
  if (method === 'POST' && path === '/v1/ranking/search') {
    return {
      pageNumber: 1, pageSize: 1, totalNumberOfRecords: 1, totalNumberOfPages: 1,
      results: [{
        id: RANKING_ID,
        name: 'WOLF 2026 #02',
        code: null,
        behaviour: { startDate: '2026-05-27T00:00:00', endDate: '2026-06-01T00:00:00', eventCount: 0, sex: 'none' },
        stats: { totalEvents: 1, totalPlayers: MOCK_POINTS.length },
        venue: { id: VENUE.id, name: VENUE.name },
        periods: [],
        rewards: [],
      }],
    };
  }
  if (method === 'POST' && path === `/v1/ranking/${RANKING_ID}/points`) {
    const rows = rankingPoints();
    // referenceId での絞り込み。対象外の大会を指定すると 0 件になる挙動も再現する
    const wanted = body && body.referenceId;
    const list = wanted ? rows.filter((r) => r.reference.id === wanted) : rows;
    return {
      pageNumber: 1, pageSize: list.length, totalNumberOfRecords: list.length,
      totalNumberOfPages: 1, results: list,
    };
  }
  if (method === 'GET' && path === `/v1/ranking/${RANKING_ID}/event-by-reference/${POINTS_REF_ID}`) {
    return { id: POINTS_EVENT_ID };
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

// ---- 大会写真(Google Drive)の mock ------------------------------------
// drive.mjs の listFolders / listImages が live で受け取るのと同じ形
// (files.list の files[])を返す。これを通せば、フォルダ名の正規化・照合ロジックは
// 実 API に繋いだときもそのまま動く。
//
// 写真があるのは「終了した大会」と「進行中の大会」だけにしてある。
// 開催予定の大会には当然まだ写真が無く、写真タブが出ないことの確認になる。

// mock フォルダ名は、わざと大会名と字形を変えてある。
// 実運用では Drive のフォルダ名と PokerLens の大会名で記号やスペースが揃わないことが
// 分かっているので(チルダ 3 種・スペースの有無)、正規化を通さないと一致しない状態を
// ローカルでも再現しておく。ここが一致しなくなったら normalizeTitle の退行を疑う。
//   'Wolf Main Event — Day 1A' → em dash を半角ハイフンに
//   'Sunday Bounty'            → 半角スペースを全角スペースに
function mockFolderLabel(name) {
  return name.replace(/—/g, '-').replace(/ /g, '　');
}

/* 親フォルダ直下のフォルダ一覧。
 * **開催予定の大会にもフォルダを作る**。告知画像を先に載せる運用があるため、
 * フロントは状態で絞らず写真を取りに行くようになった(#48)。以前は
 * `status.code !== 'opened'` で除外していて、開催予定の経路をローカルで確認できなかった。
 * ただし evt-wolf-sat だけは意図的にフォルダを作らない —「写真 0 枚 → Photos タブが
 * 出ない」ケースの確認用に 1 件残しておく必要があるため。 */
export function mockDriveFolders() {
  const folders = buildEvents(Date.now())
    .filter((e) => e.id !== 'evt-wolf-sat')
    .map((e) => ({
      id: 'mockfolder-' + e.id,
      name: `${e.dailyDetails.startDate.slice(0, 10)} ${mockFolderLabel(e.name)}`,
      mimeType: 'application/vnd.google-apps.folder',
    }));
  // 命名規約(先頭に YYYY-MM-DD)を満たさないフォルダ。
  // photos.mjs が警告ログを出す経路をローカルでも通せるように 1 つ混ぜてある。
  folders.push({
    id: 'mockfolder-noname',
    name: '写真バックアップ',
    mimeType: 'application/vnd.google-apps.folder',
  });
  return folders;
}

// 1 フォルダぶんの画像。枚数はフォルダ ID から決めて、大会ごとに違う枚数にする
// (グリッドの折り返しと、1 枚しかない場合の見え方を両方確認できるように)。
export function mockDriveImages(folderId) {
  const n = (hashCode(folderId) % 9) + 4;
  return Array.from({ length: n }, (_, i) => {
    // 3 枚に 1 枚は縦写真。グリッドが縦横混在で崩れないことを確認するため
    const portrait = i % 3 === 2;
    return {
      id: `${folderId}-img-${i + 1}`,
      name: `AS_${String(i + 1).padStart(3, '0')}.jpg`,
      mimeType: 'image/jpeg',
      imageMediaMetadata: {
        width: portrait ? 1365 : 2048,
        height: portrait ? 2048 : 1365,
        // EXIF そのままの形式("YYYY:MM:DD HH:MM:SS")
        time: `2026:05:27 1${String(i % 10)}:00:00`,
      },
    };
  });
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

// mock 用のプレースホルダ画像(data URI の SVG)。
// mock のファイル ID は実在しないので lh3.googleusercontent.com からは読めない。
// 外部に取りに行かない自己完結の画像にして、ネットワーク無しでも写真タブの
// レイアウト・拡大表示が確認できるようにする。
export function mockPhotoSrc(file, width) {
  const ratio = file.h && file.w ? file.h / file.w : 2 / 3;
  const height = Math.round(width * ratio);
  const hue = hashCode(file.id) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue},38%,26%)"/>` +
    `<text x="50%" y="50%" fill="hsl(${hue},45%,78%)" font-family="sans-serif" ` +
    `font-size="${Math.round(width / 10)}" text-anchor="middle" dominant-baseline="middle">` +
    `${file.name}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// テスト/デバッグ用。EVENTS は日付が「今」基準なので、参照時点で組み立てる。
export const _fixtures = { buildEvents, LEVELS_BY_ID, PLAYERS_BY_ID, PAYOUTS_BY_ID };
