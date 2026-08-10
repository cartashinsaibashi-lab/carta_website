// 変換層: PokerLens の VenueEvent(standard swagger)を
// フロント app.js が期待するデータ契約に変換する。
//
// app.js が読むイベント形状(要点):
//   { id, category:'wolf'|'utage'|'other', status:'running'|'future'|'past',
//     name, flight, tags[], year, month, day, dateLabel, venue,
//     buyin, fee, guarantee, startingStack, levelMinutes, lateReg, reentry,
//     gameType, description, details[]?,
//     structure[], stats{}, live{}?(running), registration{}?(future), results[]?(past) }
//
// 金額・チップは「生の数値」を渡す(整形はビュー側の yen()/num() が行う)。

import { config } from './config.mjs';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- 小さなヘルパ ---------------------------------------------------------

// ISO 文字列(ローカル wall-clock 想定)から y/m/d/h/min を取り出す。
// タイムゾーン変換は行わない(会場ローカル時刻をそのまま表示するため)。
function parseParts(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] != null ? Number(m[4]) : 0,
    minute: m[5] != null ? Number(m[5]) : 0,
  };
}

function weekday(y, mo, d) {
  // UTC で曜日算出(TZ 影響を受けない)
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

// 会場ローカル(JST)の wall-clock ISO を「絶対時刻」文字列に変換する。
// フロントのカウントダウン(STARTS IN / REG CLOSE IN)が視聴者の TZ に依存せず
// 常に JST 基準で計算できるよう +09:00 を付与する。既にオフセット/Z があればそのまま。
function jstInstant(iso) {
  if (!iso) return '';
  const s = String(iso);
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + '+09:00';
}

// "HH:MM"(24時間・JST wall-clock)
function timeLabel(parts) {
  return parts ? `${parts.hour}:${String(parts.minute).padStart(2, '0')}` : '';
}

// "7/29 (Wed) 12:00" 形式。app.js の splitDateTime 正規表現が末尾 H:MM を要求する。
function dateLabel(parts) {
  if (!parts) return '';
  const hhmm = `${parts.hour}:${String(parts.minute).padStart(2, '0')}`;
  return `${parts.month}/${parts.day} (${weekday(parts.year, parts.month, parts.day)}) ${hhmm}`;
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// league 名から wolf/utage/other を判定(部分一致・大文字小文字無視)
function categoryOf(ev) {
  const name = ((ev.behaviour && ev.behaviour.league && ev.behaviour.league.name) || '').toLowerCase();
  const hit = (list) => list.some((k) => name.includes(k.toLowerCase()));
  if (hit(config.categoryWolf)) return 'wolf';
  if (hit(config.categoryUtage)) return 'utage';
  return 'other';
}

// status.code(Opened|Running|Closed。大文字小文字はAPIで揺れる)→ running|future|past
function statusOf(ev) {
  const code = String((ev.status && ev.status.code) || '').toLowerCase();
  if (code === 'running') return 'running';
  if (code === 'closed') return 'past';
  return 'future'; // opened / scheduled など
}

function tagsOf(ev) {
  const raw = ev.behaviour && ev.behaviour.tags;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function reentryText(ev) {
  const d = ev.description && ev.description.multipleEntries;
  if (d) return d;
  const code = ev.behaviour && ev.behaviour.code;
  return code === 'freezeout' ? 'Freezeout' : 'Re-entry allowed';
}

// --- サブ構造 -------------------------------------------------------------

// EventLevel[] → app.js structure[]
// 実データ: type は数値(1=レベル, 2=休憩)。配列の並び順が進行順。
// 休憩は index=0/blinds0 で、レベルの合間に挟まる。先頭(受付前)の休憩は表示しない。
export function buildStructure(levels, lateRegLevel) {
  if (!Array.isArray(levels)) return [];
  const isBreak = (lv) => lv.type === 'break' || lv.type === 2 || lv.type === '2';
  const out = [];
  let seenLevel = false;
  for (const lv of levels) {
    if (isBreak(lv)) {
      if (!seenLevel) continue; // 先頭の休憩(受付/開始前)はスキップ
      out.push({ type: 'break', minutes: num(lv.minutes) });
    } else {
      seenLevel = true;
      out.push({
        type: 'level',
        level: num(lv.index),
        sb: num(lv.smallBlind),
        bb: num(lv.bigBlind),
        ante: num(lv.ante),
        minutes: num(lv.minutes),
        lateRegClose: lateRegLevel != null && num(lv.index) === num(lateRegLevel),
      });
    }
  }
  return out;
}

// levels[] の最初のレベル(type=1)の minutes。dailyDetails.levelMinutes は
// 実データで欠けることがあるため、ストラクチャーの Lv.1 を第一候補にする。
function firstLevelMinutes(levels) {
  if (!Array.isArray(levels)) return 0;
  const isBreak = (l) => l.type === 'break' || l.type === 2 || l.type === '2';
  const first = levels.find((l) => !isBreak(l));
  return first ? num(first.minutes) : 0;
}

function buildStats(ev) {
  const s = ev.stats || {};
  return {
    entries: num(s.totalEntries),
    players: num(s.totalPlayers),
    avgStack: num(s.averageChipsCount),
    totalChips: num(s.totalChipsCount),
    prizePool: num(s.totalPayoutAmount) || num(s.guaranteedAmount),
    itm: num(s.totalPayouts),
  };
}

// running 用 live{}。実データは休憩が index=0 なので、配列の「位置」で前後を判定する。
function buildLive(ev, levels) {
  const st = ev.status || {};
  const idx = num(st.levelIndex);
  const arr = Array.isArray(levels) ? levels : [];
  const isBreak = (l) => l.type === 'break' || l.type === 2 || l.type === '2';

  // 現在レベルの位置(type=1 かつ index===idx)。無ければ index<=idx の最後のレベル位置。
  let pos = arr.findIndex((l) => !isBreak(l) && num(l.index) === idx);
  if (pos < 0) for (let i = 0; i < arr.length; i++) if (!isBreak(arr[i]) && num(arr[i].index) <= idx) pos = i;
  const cur = pos >= 0 ? arr[pos] : null;

  const elapsed = num(st.level && st.level.elapsedSeconds);
  const levelMinutes = num(cur ? cur.minutes : ev.dailyDetails && ev.dailyDetails.levelMinutes) || num(st.levelMinutes);
  const remaining = Math.max(0, levelMinutes * 60 - elapsed);

  // elapsedSeconds は st.date 時点のスナップショット。レベル終了の「絶対時刻」を渡し、
  // クライアントが (endsAt - now) で毎秒計算すれば、取得ラグ / CDN キャッシュの古さ /
  // カード展開までの時間に依存せず自己補正できる(スナップショットのまま表示すると
  // その古さ分だけタイマーが遅れる = 残りが多く見える)。
  const statusDateMs = Date.parse(st.date);
  const endsAt = Number.isFinite(statusDateMs) ? statusDateMs + remaining * 1000 : null;

  // 現在位置より後の最初のレベル / 休憩
  let next = null, nextBreak = null;
  for (let i = pos + 1; i < arr.length; i++) {
    if (!next && !isBreak(arr[i])) next = arr[i];
    if (!nextBreak && isBreak(arr[i])) nextBreak = arr[i];
    if (next && nextBreak) break;
  }

  // 次の休憩が始まる絶対時刻(ms epoch)。
  // 現在レベルの終了時刻に、そこから休憩までの各レベルの長さを足していく。
  // endsAt と同じく絶対時刻で渡し、クライアントが (breakAt - now) で毎秒計算する。
  let breakAt = null;
  if (endsAt != null) {
    let ms = endsAt;
    for (let i = pos + 1; i < arr.length; i++) {
      if (isBreak(arr[i])) { breakAt = ms; break; }
      ms += num(arr[i].minutes) * 60000;
    }
  }

  return {
    levelIndex: idx,
    sb: cur ? num(cur.smallBlind) : 0,
    bb: cur ? num(cur.bigBlind) : 0,
    ante: cur ? num(cur.ante) : 0,
    remainingSec: remaining,
    endsAt: endsAt, // レベル終了の絶対時刻(ms epoch)。クライアントが real-time 補正に使う

    nextLevel: next ? `SB ${num(next.smallBlind)} / BB ${num(next.bigBlind)}` : '',
    nextBreak: nextBreak ? `${num(nextBreak.minutes)} min break` : '',
    breakAt: breakAt, // 次の休憩開始の絶対時刻(ms epoch)。無ければ null
    tables: num(ev.stats && ev.stats.totalTables),
  };
}

// future 用 registration{}
function buildRegistration(ev) {
  const dd = ev.dailyDetails || {};
  const sub = ev.subscription || {};
  const s = ev.stats || {};
  const closeParts = parseParts(dd.subscriptionClose);

  const state = dd.subscriptionAllowed === false ? 'closed' : 'open';
  const options = (sub.buyins && sub.buyins.length ? sub.buyins : [sub.buyin])
    .filter(Boolean)
    .map((b) => ({
      label: b.description || 'Entry',
      amount: num(b.amount) || num(b.buyin) + num(b.fee),
      chips: `${num(b.chips).toLocaleString('en-US')} chips`,
    }));

  return {
    state, // 'open' | 'openSoon' | 'closed'
    stateLabel: state === 'open' ? 'Registration open' : 'Registration closed',
    entries: num(s.totalReservations) || num(s.totalEntries),
    cap: num(dd.playerAllowed),
    closesLabel: closeParts ? dateLabel(closeParts) : '',
    note: '',
    options,
  };
}

// past 用 results[]
// players は bare 配列ではなくページング形式 {results:[...]} で返るため両対応。
export function buildResults(players) {
  const arr = Array.isArray(players) ? players : (players && players.results) || [];
  return arr
    .map((p) => {
      const pl = p.player || {};
      const pay = p.payout || {};
      return {
        pos: num(p.position),
        player: pl.preferredName || pl.nickname || [pl.firstname, pl.lastname].filter(Boolean).join(' ') || '—',
        country: pl.countryName || '',
        prize: num(pay.payoutAmount),
        bounty: num(pay.bountyAmount),
      };
    })
    .filter((r) => r.pos > 0)
    .sort((a, b) => a.pos - b.pos);
}

// GET /v1/event/{id}/payouts → app.js payouts[]
// 実データ: [{ position, percentage, amount, payoutAmount, description, winner, ... }]
//   - description は現物賞品の表記("4 Tickets" / "1E × 2,000P")。現金のみの大会では ""。
//   - percentage はサテライト等では 0(配分率を使わずチケット固定のため)。
// 管理画面と同じく 1 順位 1 行のまま返す(同額が続いても結合しない)。
export function buildPayouts(payouts) {
  const arr = Array.isArray(payouts) ? payouts : (payouts && payouts.results) || [];
  return arr
    .map((p) => ({
      pos: num(p.position),
      pct: Number(p.percentage) || 0,
      amount: num(p.payoutAmount) || num(p.amount),
      description: (p.description || '').trim(),
    }))
    .filter((r) => r.pos > 0)
    .sort((a, b) => a.pos - b.pos);
}

// --- イベント本体 ---------------------------------------------------------

// 共通の(カード/ヘッダ/情報タブに必要な)フィールドを組み立てる
function baseEvent(ev, levels) {
  const dd = ev.dailyDetails || {};
  const sub = ev.subscription || {};
  const buyin = sub.buyin || {};
  const parts = parseParts(dd.startDate || (ev.status && ev.status.date));
  const closeParts = parseParts(dd.subscriptionClose);
  const status = statusOf(ev);
  const lateRegLevel = sub.lateRegistrationLevel;

  return {
    id: ev.id,
    category: categoryOf(ev),
    status,
    name: ev.name || dd.name || '',
    number: num(ev.behaviour && ev.behaviour.number), // イベント No(behaviour.number)
    flight: dd.flight || '',
    tags: tagsOf(ev),
    year: parts ? parts.year : 0,
    month: parts ? parts.month : 0,
    day: parts ? parts.day : 0,
    dateLabel: dateLabel(parts),
    // カウントダウン用: 開始/レジクロの絶対時刻(JST基準)+ レジクロの表示時刻
    startAt: jstInstant(dd.startDate || (ev.status && ev.status.date)),
    regCloseAt: jstInstant(dd.subscriptionClose),
    regCloseTime: timeLabel(closeParts),
    venue: (ev.venue && ev.venue.name) || '',
    buyin: num(buyin.buyin),
    fee: num(buyin.fee),
    guarantee: num(sub.guaranteedAmount) || num(ev.stats && ev.stats.guaranteedAmount),
    startingStack: num(buyin.chips),
    levelMinutes:
      firstLevelMinutes(levels) || num(dd.levelMinutes) || num(ev.status && ev.status.levelMinutes),
    lateReg: lateRegLevel != null ? `Late Reg until Lv.${num(lateRegLevel)}` : '',
    reentry: reentryText(ev),
    gameType: (ev.behaviour && ev.behaviour.gameType && ev.behaviour.gameType.name) || '',
    /* 大会説明文は dailyDetails.levelDescription(管理画面の Description)。
     * dailyDetails.description は管理画面の Announcement で、"Unlimited" や
     * "Level 8 / 18:30" のような運用メモが入るため表示には使わない。 */
    description: dd.levelDescription || '',
    stats: buildStats(ev),
    _lateRegLevel: lateRegLevel, // 内部利用(structure 生成)。フロントには影響しない
  };
}

// 一覧用(カード表示に必要なところまで。structure/results は詳細で遅延ロード)
export function toListEvent(ev, { levels } = {}) {
  const base = baseEvent(ev, levels);
  const out = Object.assign({}, base);
  delete out._lateRegLevel;
  // 詳細(structure/results)は空で返し、カード展開時に /api/events/:id で差し替える。
  // app.js が描画時に参照するため、空配列/オブジェクトを必ず用意しておく(未定義だと落ちる)。
  out.structure = [];
  out.payouts = [];
  if (base.status === 'running') out.live = buildLive(ev, levels);
  if (base.status === 'future') out.registration = buildRegistration(ev);
  if (base.status === 'past') out.results = [];
  return out;
}

// 進行中の座席情報 seats[](players から着席者を抽出)
export function buildSeats(players) {
  const arr = Array.isArray(players) ? players : (players && players.results) || [];
  return arr
    .filter((p) => !p.busted && p.seatIndex != null)
    .map((p) => {
      const pl = p.player || {};
      return {
        table: num(p.tableIndex),
        seat: num(p.seatIndex),
        player: pl.nickname || pl.preferredName || [pl.firstname, pl.lastname].filter(Boolean).join(' ') || '—',
        chips: num(p.chipsCount),
      };
    })
    .sort((a, b) => a.table - b.table || a.seat - b.seat);
}

// 詳細用(アコーディオン内の structure / results / live / seats をフルに埋める)
export function toDetailEvent(ev, { levels, players, payouts } = {}) {
  const base = baseEvent(ev, levels);
  const lateRegLevel = base._lateRegLevel;
  delete base._lateRegLevel;
  const out = Object.assign({}, base);
  out.structure = buildStructure(levels, lateRegLevel);
  out.payouts = buildPayouts(payouts); // Prize タブ(空なら app.js 側でモデル表示にフォールバック)
  if (base.status === 'running') {
    out.live = buildLive(ev, levels);
    out.seats = buildSeats(players); // 座席No + プレイヤー名
  }
  if (base.status === 'future') out.registration = buildRegistration(ev);
  if (base.status === 'past') out.results = buildResults(players);
  return out;
}

// CALENDAR({ months:[{year,month}], today:{year,month,day} })を組み立てる
export function buildCalendar(events) {
  const seen = new Set();
  const months = [];
  events.forEach((e) => {
    if (!e.year || !e.month) return;
    const key = `${e.year}-${e.month}`;
    if (!seen.has(key)) {
      seen.add(key);
      months.push({ year: e.year, month: e.month });
    }
  });
  months.sort((a, b) => a.year - b.year || a.month - b.month);

  // 会場ローカル(JST)の「今日」
  const today = todayInTokyo();
  return { months, today };
}

function todayInTokyo() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  } catch {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
}
