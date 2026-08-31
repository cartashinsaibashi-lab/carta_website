// 変換層: PokerLens の VenueEvent(standard swagger)を
// フロント app.js が期待するデータ契約に変換する。
//
// app.js が読むイベント形状(要点):
//   { id, category:'wolf'|'utage'|'other', status:'running'|'future'|'past',
//     name(番号を含まない大会名), no(カードのバッジ "#12" / "#SP2"), flight, tags[],
//     year, month, day, dateLabel, venue,
//     buyin, fee, guarantee, startingStack, levelMinutes, lateReg, reentry,
//     gameType, description, details[]?,
//     structure[], stats{}, live{}?(running), registration{}?(future), results[]?(past),
//     points{順位:ポイント}?(シリーズランキング対象の大会のみ。詳細のみ) }
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

/* league 名から wolf/utage/other を判定(部分一致・大文字小文字無視)。
 * photos.mjs も使う — 大会写真のフォルダを種別で絞り込むため(#72)。 */
export function categoryOf(ev) {
  const name = ((ev.behaviour && ev.behaviour.league && ev.behaviour.league.name) || '').toLowerCase();
  const hit = (list) => list.some((k) => name.includes(k.toLowerCase()));
  if (hit(config.categoryWolf)) return 'wolf';
  if (hit(config.categoryUtage)) return 'utage';
  return 'other';
}

/* 会場がタイマーを一時停止しているか。
 *
 * PokerLens の API に「一時停止」を表す値は無く、**管理画面で Paused にすると
 * status.code が開始前と同じ `Opened` に戻る**(2026-08-19 に本番の #1 Demo と
 * #1 FREE ROLL で、管理画面の表示と API 応答を突き合わせて確認)。
 *   管理画面 In progress → code = Running
 *   管理画面 Paused      → code = Opened
 * そのため「まだ始まっていない大会」と区別する必要がある。判定材料は現在位置で、
 * levels の先頭は必ず受付前の休憩(id=1)なので、**id が 2 以上か経過秒があれば開始済み**。
 * 実データ 2026-04 以降の Opened 29 件のうちこの条件に当たるのは一時停止中の 1 件だけで、
 * 過去の大会が誤って「開催中」に戻ることはない。 */
export function pausedLive(ev) {
  const st = ev.status || {};
  if (String(st.code || '').toLowerCase() !== 'opened') return false;
  const lvl = st.level || {};
  return num(lvl.elapsedSeconds) > 0 || num(lvl.id) > 1;
}

// status.code(Opened|Running|Closed。大文字小文字はAPIで揺れる)→ running|future|past
function statusOf(ev) {
  const code = String((ev.status && ev.status.code) || '').toLowerCase();
  if (code === 'running') return 'running';
  if (code === 'closed') return 'past';
  // 一時停止中も「開催中」として扱う。future に落とすと Live タブごと消えて、
  // 開催予定のカード(STARTS IN のカウントダウン)に化けてしまう。
  if (pausedLive(ev)) return 'running';
  return 'future'; // opened / scheduled など
}

/* カードのイベント No バッジの表記(#58)。
 *
 * 管理画面の No. は数値しか入らないため、特殊イベントやサテライトは
 * **Short descr.(= dailyDetails.shortName)に "#SP2" のような表記を入れる運用**になっている。
 * 実データ 947 件では shortName の入力が 114 件あり、書式が時期によって揺れる:
 *   "#3"(45) / "3"(28) / "SP"(14) / "#SP2"(9) / "#S1"(6) / "SP1"(3) / "S"(2) / "#3/A"(7)
 * 2025-09〜2026-03 は英字だけ("SP")で番号が入っていないので、その場合は No. を足す。
 * shortName が空でも番号があればタイトル先頭の "#3" と必ず一致する(553 件で確認済み)。
 * 両方無い 280 件(FREE ROLL 等)はバッジを出さない。
 *
 * フライト付きの "#3/A" は運営の入力どおりそのまま出す(運営の指定)。 */
function eventNo(ev) {
  const short = String((ev.dailyDetails && ev.dailyDetails.shortName) || '').trim().replace(/^#+/, '').trim();
  const no = num(ev.behaviour && ev.behaviour.number);
  if (short) return '#' + (/\d/.test(short) ? short : short + (no || ''));
  return no ? '#' + no : '';
}

function tagsOf(ev) {
  const raw = ev.behaviour && ev.behaviour.tags;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/* Info タブの Re-entry 行。**再エントリーできる回数**を出す。
 *
 * PokerLens が返す `description.multipleEntries` は、管理画面の
 * 「Maximum no. of entries per player」= `behaviour.maxEntriesPerPlayer` の値で、
 * **初回エントリーを含む合計エントリー数の上限**。実データ 950 大会でこの 2 つは
 * 完全に一致する(0 → "Unlimited" 869 件 / 3 → "3" 46 件 / 4 → "4" / 2 → "2")。
 * 管理画面にある「Maximum no. of **re**-entries per player」のほうは API に
 * 出てこないので使えない(re-entry を名前に含むのは実績値の
 * `stats.totalReEntries` と可否フラグ `description.hasReEntry` だけ)。
 *
 * そのままだと見出し(Re-entry)と中身がずれて「3 = 再エントリー 3 回」と読めるため、
 * **数値のときは 1 を引いて再エントリー回数に直す**(運営の指定 2026-08-28)。
 *
 * **"NO" は "Freezeout" と出す**(同上)。PokerLens は freezeout の大会に "NO" を
 * 返すが、見出しが Re-entry だと「再エントリー不可」なのか「上限なし」なのか
 * 読み取れないため、ポーカーの用語に置き換える。合計 1 エントリー(= 引いて 0)の
 * 大会も再エントリー不可なので同じ表記に揃える。
 *
 * "Unlimited" はそのまま通す — 上限の有無を表す語で引き算が成り立たない。
 * 実データでは `maxEntriesPerPlayer` が 0 でも freezeout の大会は "NO" が返るため、
 * 0 を「上限なし」と読んではいけない。 */
const FREEZEOUT = 'Freezeout';

function reentryText(ev) {
  const d = ev.description && ev.description.multipleEntries;
  if (d) {
    const text = String(d).trim();
    if (text.toUpperCase() === 'NO') return FREEZEOUT;
    const total = /^\d+$/.test(text) ? Number(text) : null;
    if (total === null) return d;
    return total - 1 > 0 ? String(total - 1) : FREEZEOUT;
  }
  /* multipleEntries は実データでは 950 件すべてに入っていて、ここへは来ない。
   * 念のためのフォールバック。**大文字小文字を無視して比べる** — 実データの code は
   * 'Freezeout' で、以前は小文字の 'freezeout' と突き合わせていたため
   * ここに来ても判定できなかった。 */
  const code = String((ev.behaviour && ev.behaviour.code) || '').toLowerCase();
  return code === 'freezeout' ? FREEZEOUT : 'Unlimited';
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
    /* 日をまたぐ大会の「その日に参加した人数」と「大会全体のエントリー数」。
     * 実データ(#3 MAIN EVENT / 2026-05-27〜31)では、Day 1A〜1D は totalEntries が
     * その日の数(66/79/116/69)なのに対し、Day 2 以降は大会全体の 330 に変わる。
     * totalEntriesGlobal はどの日のレコードでも 330 で一貫しているので、
     * 「その日 / 全体」を出すときはこの 2 つを使う(#54)。単日大会は両方同じ値。 */
    entriesDay: num(s.totalEntriesDay),
    entriesTotal: num(s.totalEntriesGlobal) || num(s.totalEntries),
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

  /* 現在位置は **status.level.id** で引く。
   * 実データの癖: 休憩行の index は 0 で返り(レベルは 1,2,3...)、休憩中は
   * status.levelIndex / status.level.index も 0 になる。index で引くと休憩中は
   * 「該当なし」になり、そこから導く値が全部おかしくなっていた(#38)——
   * ブラインドが 0/0、次のレベルが Lv.1、次の休憩が今の休憩、という状態。
   * id は休憩行にも一意に振られているので、行を指せる唯一のキーが id になる。 */
  const curId = num(st.level && st.level.id);
  let pos = curId > 0 ? arr.findIndex((l) => num(l.id) === curId) : -1;

  /* id を返さない応答向けのフォールバック(従来の index 引き)。
   * 休憩は id が無いと特定できないので、レベル行だけを対象にする。 */
  if (pos < 0) {
    pos = arr.findIndex((l) => !isBreak(l) && num(l.index) === idx);
    if (pos < 0) for (let i = 0; i < arr.length; i++) if (!isBreak(arr[i]) && num(arr[i].index) <= idx) pos = i;
  }
  const cur = pos >= 0 ? arr[pos] : null;
  const onBreak = !!cur && isBreak(cur);

  const elapsed = num(st.level && st.level.elapsedSeconds);
  const levelMinutes = num(cur ? cur.minutes : ev.dailyDetails && ev.dailyDetails.levelMinutes) || num(st.levelMinutes);
  const remaining = Math.max(0, levelMinutes * 60 - elapsed);

  // elapsedSeconds は st.date 時点のスナップショット。レベル終了の「絶対時刻」を渡し、
  // クライアントが (endsAt - now) で毎秒計算すれば、取得ラグ / CDN キャッシュの古さ /
  // カード展開までの時間に依存せず自己補正できる(スナップショットのまま表示すると
  // その古さ分だけタイマーが遅れる = 残りが多く見える)。
  //
  // ただし一時停止中は endsAt を渡さない。会場が止めている間 status.date も
  // elapsedSeconds も更新されないため、endsAt(= 過去の時刻 + 残り)を基準にすると
  // 画面のカウントダウンだけが進んで 0 になり、次のレベルへ繰り上がってしまう(#55)。
  // 代わりに remainingSec の固定値をそのまま表示させる。
  const paused = pausedLive(ev);
  const statusDateMs = Date.parse(st.date);
  const endsAt = !paused && Number.isFinite(statusDateMs) ? statusDateMs + remaining * 1000 : null;

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
  // 一時停止中は絶対時刻が使えないので、代わりに「休憩まであと何秒か」を固定値で渡す。
  let breakAt = null, breakInSec = null;
  {
    let ms = endsAt, sec = remaining;
    for (let i = pos + 1; i < arr.length; i++) {
      if (isBreak(arr[i])) {
        if (endsAt != null) breakAt = ms;
        breakInSec = sec;
        break;
      }
      ms += num(arr[i].minutes) * 60000;
      sec += num(arr[i].minutes) * 60;
    }
  }

  /* structure[] 上の現在位置。フロントがレベル終了後、サーバーの更新を待たずに
   * 次の項目へ繰り上げるために使う(実測でレベル間 9 秒・休憩へ 22 秒、00:00 のまま
   * 止まっていた。内訳は CDN キャッシュと PokerLens 側の反映待ちで、どちらも取得側では
   * 縮められない)。buildStructure() は先頭の受付前休憩を落とすので、その分だけずらす。 */
  const firstLevelPos = arr.findIndex((l) => !isBreak(l));
  const stepIndex = pos >= 0 && firstLevelPos >= 0 && pos >= firstLevelPos ? pos - firstLevelPos : null;

  return {
    levelIndex: idx,
    stepIndex: stepIndex,
    /* 休憩中であることをフロントに伝える。休憩行の smallBlind/bigBlind/ante は
     * 実データでも 0 なので、そのまま出すと「0 / 0 ante 0」になる。
     * フロントは isBreak のときブラインド行を出さず、見出しを BREAK にする。 */
    isBreak: onBreak,
    sb: cur ? num(cur.smallBlind) : 0,
    bb: cur ? num(cur.bigBlind) : 0,
    ante: cur ? num(cur.ante) : 0,
    remainingSec: remaining,
    endsAt: endsAt, // レベル終了の絶対時刻(ms epoch)。クライアントが real-time 補正に使う
    /* 会場がタイマーを止めているか。true のときフロントはカウントダウンを動かさず、
     * レベルの繰り上げも行わない(pausedLive() の説明を参照)。 */
    paused: paused,

    nextLevel: next ? `SB ${num(next.smallBlind)} / BB ${num(next.bigBlind)}` : '',
    nextBreak: nextBreak ? `${num(nextBreak.minutes)} min break` : '',
    breakAt: breakAt, // 次の休憩開始の絶対時刻(ms epoch)。無ければ null(一時停止中も null)
    breakInSec: breakInSec, // 次の休憩までの残り秒。一時停止中の固定表示に使う
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

/* nickname も preferredName も無いプレイヤーの表示名。**本名は絶対に出さない。**
 *
 * 実測(2026-08-31 / 直近 60 大会・ユニーク 393 名)で **全員 privacyAgree: false** =
 * 本名を公開する同意が無い。それなのに以前はフォールバックが firstname + lastname で、
 * nickname 未登録の 6 名(1.5%)だけ Results と座席表に本名フルネームが出ていた(#104)。
 *
 * 代わりに PokerLens が自動生成する description に落とす。実データでは
 * イニシャル表記「Y. Y.」が 370 件、firstname が空の当日登録は「Anonymous」が 23 件で、
 * 393 名すべてに必ず入っている(= 「—」になるのは player ごと欠けているときだけ)。
 * シリーズランキング(ranking.mjs)は元からこの扱いで、そちらに揃えた。 */
function fallbackName(pl) {
  return String(pl.description || '').trim() || '—';
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
        player: pl.preferredName || pl.nickname || fallbackName(pl),
        country: pl.countryName || '',
        prize: num(pay.payoutAmount),
        /* バウンティ(賞金首)の獲得額。**フロントでは表示していない**。
         * 実データでは過去 290 大会すべてで 0 で、バウンティ大会がまだ 1 件も無い。
         * かつ payoutAmount がバウンティを含むのか別建てなのかをベンダーに確認できておらず、
         * Prize と並べると二重計上に見えるおそれがあるため、運営判断で Results から
         * 列ごと外した。API が返す値なので受け渡し自体は残してある。 */
        bounty: num(pay.bountyAmount),
        /* 翌日へ持ち込むチップ数。日をまたぐ大会の通過日でだけ 0 より大きくなる。
         * 実データ(#3 (1A) MAIN EVENT DAY 1A / 2026-05-27): 通過者 12 名が
         * busted=false かつ chipsCount>0(436,500 / 394,000 …)。
         * 最終日(#2 (2) BABY WOLF DAY 2 FINAL)は全員 busted=true で chipsCount は 0。
         * この差を carryOver の判定に使う(toDetailEvent)。 */
        chips: num(p.chipsCount),
        /* まだ生き残っているか。通過日の Survivor タブは **busted で絞る**(#54)。
         * 実データ 70 レコード中 69 件は chipsCount>0 と一致するが、
         * 2026-04-24 #1 MAIN EVENT DAY 1B だけ busted=false が 5 名・chips>0 が 6 名で
         * 食い違う(stats.totalPlayers は 5)。API の生存者定義に合わせる。 */
        busted: !!p.busted,
      };
    })
    .filter((r) => r.pos > 0)
    .sort((a, b) => a.pos - b.pos);
}

// GET /v1/event/{id}/payouts → app.js payouts[]
// 実データ: [{ position, percentage, amount, payoutAmount, description, winner, ... }]
//   - description は現物賞品の表記("4 Tickets" / "1E × 2,000P")。現金のみの大会では ""。
//   - percentage はサテライト等では 0(配分率を使わずチケット固定のため)。
//     実データでは 0 でない大会がまだ 1 件も無く、かつ運営から「Prize タブに % を出さない」
//     指示が出たため、pct はフロントで表示していない(app.js の payoutTable() 参照)。
//     API の応答をそのまま写す層なので、値自体は落とさず渡しておく。
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
    /* 表示用の大会名。**dailyDetails.name は「番号とフライト表記を除いた大会名」**で、
     * PokerLens が組み立てる ev.name(= "#2 白豚 ～HAKUTON～ …")や fullname とは別物。
     * カードは番号をバッジ(下の no)で出すので、タイトルには番号の無いこちらを使う(#58)。
     *   ev.name           "#3 (1A) MAIN EVENT DAY 1A"
     *   dailyDetails.name "MAIN EVENT DAY 1A"        ← これ。末尾の DAY 1A は残るので
     *                                                  同日の複数フライトも区別できる
     * 写真の照合(lib/drive.mjs)は生の ev.name を使っているため、ここを変えても影響しない。 */
    name: dd.name || ev.name || '',
    number: num(ev.behaviour && ev.behaviour.number), // イベント No(behaviour.number)
    no: eventNo(ev), // カードのバッジ表記("#12" / "#SP2" / "#3/A")。無い大会は空
    flight: dd.flight || '',
    /* 日をまたぐ大会の「何日目か」(dailyDetails.day)。単日大会は 0。
     * 上の day(開催日の「日」)と紛らわしいので dayNo にしている。
     * summaryId は同じ大会の全日程が共有する親レコードのキーで、946 件中 70 件
     * (= behaviour.isFlight が true の日別レコード)にだけ入る。これでグループ化し、
     * dailyDetails.day の最大値が最終日になる(#54)。 */
    dayNo: num(dd.day),
    isFlight: !!(ev.behaviour && ev.behaviour.isFlight),
    summaryId: ev.summaryId || null,
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
        player: pl.nickname || pl.preferredName || fallbackName(pl),
        chips: num(p.chipsCount),
      };
    })
    .sort((a, b) => a.table - b.table || a.seat - b.seat);
}

// 詳細用(アコーディオン内の structure / results / live / seats をフルに埋める)
export function toDetailEvent(ev, { levels, players, payouts, points, flights, summaryPlayers } = {}) {
  const base = baseEvent(ev, levels);
  const lateRegLevel = base._lateRegLevel;
  delete base._lateRegLevel;
  const out = Object.assign({}, base);
  out.structure = buildStructure(levels, lateRegLevel);
  out.payouts = buildPayouts(payouts); // Prize タブ(空なら app.js 側でモデル表示にフォールバック)
  /* シリーズランキングのポイント({ 順位: ポイント })。ランキング対象外の大会では null。
   * Prize タブ(順位ごとの配点)と Results タブ(その選手が得たポイント)は、
   * 現状どちらもこの同じ表を順位で引く(値は一致する)。
   * 空オブジェクトではなく null に寄せておき、フロントの「あるときだけ列を出す」判定を
   * 1 つの条件で書けるようにする。 */
  out.points = points && Object.keys(points).length ? points : null;
  if (base.status === 'running') {
    out.live = buildLive(ev, levels);
    out.seats = buildSeats(players); // 座席No + プレイヤー名
  }
  if (base.status === 'future') out.registration = buildRegistration(ev);
  if (base.status === 'past') {
    /* 「通過日」= 日をまたぐ大会の最終日以外。
     *
     * 判定は flights(= 同じ大会の全日程)の dailyDetails.day の最大値と比べる(#54)。
     * 以前は「チップを持って残っている人が居るか」で見ていたが(#44)、それだと
     * **まだ結果が入っていない大会を判別できない**(未開催のグループは全員 0)。
     * flights が取れなかったときのフォールバックとして、その判定も残してある。
     *
     * 通過日は Results の Prize が実態と合わない。実データでは Day 1A のレコードに
     * **最終日(5/31)の賞金**が紐づいており、Day 1A の順位(通過スタック順)と
     * 噛み合わずちぐはぐな表示になっていた(#44)。そのため通過日は賞金ではなく
     * 翌日へ持ち込むチップを出す(Survivors タブ)。ペイアウト表そのものは通過日にも
     * 見たいので Prize タブは出す(#44 で一度隠したが運営の指定で戻した)。 */
    const dayResults = buildResults(players);
    const maxDay = maxDayOf(flights);
    out.carryOver = base.isFlight && maxDay > 0
      ? base.dayNo < maxDay
      : dayResults.some((r) => r.chips > 0);

    /* 最終日は「入賞者全員」を出したいが、**最終日のレコードにはその日に来た人しか居ない**。
     * 実データ(#3 (3) MAIN EVENT DAY 3 FINAL / 2026-05-31)では入賞 32 名に対して
     * 結果一覧が 9 名(ファイナルテーブル)だけだった。親(サマリー)レコードは
     * 順位 1〜200・賞金付き 32 名で、順位も最終成績として正しいので、取得できていれば
     * そちらを使う。Day 2 のレコードにも 32 名は揃っているが、順位が Day 2 終了時の
     * スタック順(1 位 ¥300,000 / 7 位 ¥1,600,000)で最終成績と噛み合わないため使わない。 */
    out.results = !out.carryOver && summaryPlayers ? buildResults(summaryPlayers) : dayResults;
  }
  return out;
}

/* 一覧に出そろった日別レコードから「通過日か」を決めて carryOver を立てる(#54)。
 *
 * 詳細(/api/events/:id)は flights を取って正確に判定できるが、それはカードを開いてから。
 * タブ名(Survivor / Results)は開く前から出るので、一覧の時点でも決めておかないと
 * 詳細が届いた瞬間にタブ名が入れ替わって見える。
 *
 * summaryId が同じものを 1 つの大会とみなし、dailyDetails.day の最大値より小さい日を通過日とする。
 * 取得期間(historyDays)の切れ目で最終日が一覧に入っていないと最大値がずれるが、
 * その場合もカードを開いた時点で flights 由来の値に上書きされる。 */
export function markMultiDay(events) {
  const maxByGroup = new Map();
  for (const e of events) {
    if (!e.summaryId) continue;
    maxByGroup.set(e.summaryId, Math.max(maxByGroup.get(e.summaryId) || 0, e.dayNo));
  }
  for (const e of events) {
    if (!e.summaryId) continue;
    const max = maxByGroup.get(e.summaryId) || 0;
    e.carryOver = max > 0 && e.dayNo < max;
  }
  return events;
}

/* flights(GET /v1/event/{id}/flights)の中で最も大きい dailyDetails.day。
 * 応答には親(day=0 / isSummary)も混ざるので、そのまま最大値を取ればよい。
 * 単日大会では応答が null なので 0 を返す。 */
function maxDayOf(flights) {
  const arr = Array.isArray(flights) ? flights : (flights && flights.results) || [];
  return arr.reduce((m, f) => Math.max(m, num(f.dailyDetails && f.dailyDetails.day)), 0);
}

/* flights から親(サマリー)レコードの id を取り出す。
 * 子が持つ summaryId は親の referenceId であって **id ではない**ため、
 * GET /v1/event/{summaryId} は 404 になる。親の id を知る唯一の経路がこの応答。 */
export function summaryIdOf(flights) {
  const arr = Array.isArray(flights) ? flights : (flights && flights.results) || [];
  const parent = arr.find((f) => f.behaviour && f.behaviour.isSummary);
  return parent ? parent.id : null;
}

/* この日が最終日か(= 入賞者を親レコードから取り直す必要があるか)。
 * event.mjs が「親の players を取りに行くか」を決めるのに使う。 */
export function isFinalDay(ev, flights) {
  if (!(ev.behaviour && ev.behaviour.isFlight)) return false; // 単日大会
  const maxDay = maxDayOf(flights);
  return maxDay > 0 && num(ev.dailyDetails && ev.dailyDetails.day) >= maxDay;
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
