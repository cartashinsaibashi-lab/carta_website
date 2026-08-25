// シリーズランキングのポイントを「大会 → 順位 → ポイント」の索引にまとめるモジュール。
// Prize タブ(順位ごとの配点)と Results タブ(その選手が得たポイント)の両方が同じ索引を引く。
//
// 入出力:
//   pointsForEvent(eventId)  → { "1": 260, "2": 182, … } | null(ランキング対象外の大会)
//   findRanking(category)    → { id, name, players } | null(種別 → ランキングの対応づけ #78)
//   rankingRows(rankingId)   → [{ rank, name, points, events }](順位表 #78)
//
// なぜ索引を作るのか — API の都合でこうするしかない:
//   POST /v1/ranking/{id}/points が返すレコードは reference{ id, description, type:'event' } を
//   持つが、**この reference.id は VenueEvent の id ではない**(/v1/event/{reference.id} は 404)。
//   実イベント ID への変換は
//     GET /v1/ranking/{rankingId}/event-by-reference/{reference.id} → { id: <VenueEvent id> }
//   で行うが、**逆向き(イベント ID → reference)は 404 で引けない**。
//   つまり「この大会のポイントをくれ」と直接は聞けないため、ランキング側から全件を舐めて
//   対応表を作り、それを Blobs にキャッシュして使い回す。
//
// 実データの傾向(2026-08-14 時点):
//   ランキングは 3 件 — WOLF 2026 #02(24 大会 / 244 行)、宴POS ver3(19 大会 / 901 行)、
//   宴POS ver2(0 件)。参照は合計 43 件。
//   ポイントが付くのは入賞者だけで、1 大会あたり 9〜47 名程度(82 名参加でも 9 行の大会がある)。
//   ポイントは整数とは限らない(46.8 / 83.2 / 330.6 など)。
//   Day 1A/1B などのフライトではなく、flight が空の親イベントに紐づく。
//
// **索引はリクエストの経路では作らない。**
//   参照 43 件ぶんの event-by-reference が必要で、実測で 6〜7 秒かかる。これを大会詳細の
//   取得に背負わせると、カードを開くのに 4.6 秒かかった(実測)。そのため
//   prewarm(10 分ごと)に作らせ、リクエスト側は Blobs のキャッシュを読むだけにする。
//   キャッシュが無い間はポイントが出ないだけで、大会情報の表示には影響しない。
//   mock は fixtures なので即座に作れる。ローカルで動かないと開発できないため、mock のみ
//   その場で作る。

import { plGet, plPost } from './pokerlens.mjs';
import { config } from './config.mjs';

// 索引の更新間隔は prewarm の cron(10 分ごと)がそのまま決める。
// 読み出し側で期限切れを判定しない — 古い索引でも出したほうがよいため(上記の理由)。
const INDEX_KEY = 'points-index';

// 安全弁。シリーズが増えても往復が青天井にならないようにする。
// 現状はランキング 3 件・参照 43 件なので、いずれにも遠く届かない。
const MAX_RANKINGS = 20;
const MAX_POINT_PAGES = 10; // 1 ページ 1000 件。最大のランキングでも実測 901 行なので 1 ページで足りる
const REF_CONCURRENCY = 8; // event-by-reference の同時実行数(43 件なら 6 往復)

/* --- 種別 → ランキングの対応づけ / 順位表(#78) ------------------------- */

/* ランキングの一覧。名前も選手数もここから取れるので、順位表を引く前の
 * 「ボタンを出すか」の判断にも使う(site-links.mjs)。 */
async function searchRankings() {
  const res = await plPost('/v1/ranking/search', { text: '', pageIndex: 1, pageSize: 100 });
  return ((res && res.results) || []).slice(0, MAX_RANKINGS);
}

function rankingKeywords(category) {
  if (category === 'wolf') return config.rankingNameWolf;
  if (category === 'utage') return config.rankingNameUtage;
  return null; // 歌留多(other)にシリーズランキングは無い
}

function configuredRankingId(category) {
  if (category === 'wolf') return config.rankingWolfId;
  if (category === 'utage') return config.rankingUtageId;
  return '';
}

function startDateOf(rk) {
  return String((rk.behaviour && rk.behaviour.startDate) || '');
}

/* 種別に対応するランキングを 1 つ選ぶ。
 *
 * 環境変数で ID が指定されていればそれを最優先する。**名前だけでは決められない**ため:
 *   - 「宴」で名前一致させると、中身が空の旧版(宴POS ver2 / 登録 0 名)も当たる
 *   - 一方でランキング名にはシリーズ番号が入る(WOLF 2026 #02)ので、
 *     ID を設定に焼き込むと次のシリーズで更新漏れになる
 * そのため既定は名前一致で、**登録者 0 名を除いたうえで開催期間が最も新しいもの**を選ぶ。
 * 0 名を除くのは旧版を掴まないため、新しい方を採るのはシリーズが更新されたら
 * 自動で追従するため。全部 0 名なら(=まだ誰も付いていない新シリーズ)新しい方を返す。 */
export async function findRanking(category) {
  const keywords = rankingKeywords(category);
  if (!keywords) return null;

  const all = await searchRankings();
  const wanted = configuredRankingId(category);
  if (wanted) {
    const hit = all.find((rk) => rk.id === wanted);
    // 設定した ID が見つからないのは設定ミス。黙って別のランキングに差し替えない
    if (!hit) {
      console.warn(`[ranking] 指定された ${category} のランキング ID が見つかりません: ${wanted}`);
      return null;
    }
    return toRankingInfo(hit);
  }

  const lower = keywords.map((k) => k.toLowerCase());
  const matched = all.filter((rk) => {
    const name = String(rk.name || '').toLowerCase();
    return lower.some((k) => name.indexOf(k) !== -1);
  });
  if (!matched.length) return null;

  const withPlayers = matched.filter((rk) => playersOf(rk) > 0);
  const pool = withPlayers.length ? withPlayers : matched;
  const newest = pool.reduce((a, b) => (startDateOf(b) > startDateOf(a) ? b : a));
  return toRankingInfo(newest);
}

function playersOf(rk) {
  return Number(rk.stats && rk.stats.totalPlayers) || 0;
}

function toRankingInfo(rk) {
  return { id: rk.id, name: rk.name || '', players: playersOf(rk) };
}

/* 順位表。1 リクエストで全員ぶん取れる(実測 218 名 / 480 名)。
 *
 * **orderBy は 'position' を使う。** 'points' を指定すると最下位から返る既知の癖がある。
 * position はスカラーではなく { index, events, points } のオブジェクトで、表の 3 列は
 * すべてここから取れる。ポイントは整数とは限らない(46.8 / 83.2 など)ので丸めない。
 *
 * 表示名は nickname を優先し、空なら description のイニシャル表記(「Y. Y.」)にする。
 * 本名は出さない — 実測で全員 privacyAgree: false のため。
 * nickname の登録率は live で Wolf 218/218・宴 461/480 で、宴には未登録が 19 名いる。 */
export async function rankingRows(rankingId) {
  const res = await plPost(`/v1/ranking/${rankingId}/players`, {
    text: '',
    orderBy: 'position',
    pageIndex: 1, // pageIndex は 1 始まり。0 を渡すと 500(ArgumentException)
    pageSize: 1000,
  });
  const rows = (res && res.results) || [];
  return rows
    .map((r) => {
      const pos = r.position || {};
      const player = r.player || {};
      const nickname = String(player.nickname || '').trim();
      return {
        rank: Number(pos.index) || 0,
        name: nickname || String(player.description || '').trim(),
        points: Number(pos.points) || 0,
        events: Number(pos.events) || 0,
      };
    })
    // 応答は position 順で返るが、順位が入れ替わって見えると表として壊れるので念のため揃える
    .sort((a, b) => a.rank - b.rank);
}

let _store; // undefined=未試行 / null=利用不可 / object=store

async function indexStore() {
  if (_store !== undefined) return _store;
  try {
    const { getStore } = await import('@netlify/blobs');
    _store = getStore('ranking');
  } catch {
    // Blobs が使えない環境(ローカル未リンク等)ではキャッシュ無しで動く
    _store = null;
  }
  return _store;
}

// 配列を limit 件ずつ並列で処理する。全部同時に投げると API に負荷をかけるため。
async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

// 1 ランキングぶんのポイントを全ページ取得する
async function fetchPoints(rankingId) {
  const rows = [];
  for (let page = 1; page <= MAX_POINT_PAGES; page++) {
    const res = await plPost(`/v1/ranking/${rankingId}/points`, {
      // 選手情報は順位表を作るときに要るが、ここでは順位とポイントしか使わないので取らない
      includePlayerInfo: false,
      pageIndex: page, // pageIndex は 1 始まり。0 を渡すと 500(ArgumentException)になる
      pageSize: 1000,
    });
    const list = (res && res.results) || [];
    rows.push(...list);
    if (list.length < 1000) break;
  }
  return rows;
}

/* 全ランキングを舐めて { イベントID: { 順位: ポイント } } を作る。
 * 複数のランキングが同じ大会を対象にしていることは現状無いが、
 * あっても壊れないよう同じイベントのエントリはマージする。 */
async function buildIndex() {
  const search = await plPost('/v1/ranking/search', { text: '', pageIndex: 1, pageSize: 100 });
  const rankings = ((search && search.results) || []).slice(0, MAX_RANKINGS);

  const index = {};
  for (const rk of rankings) {
    const rows = await fetchPoints(rk.id);

    // reference(= ランキング内部のイベント参照)ごとにまとめる
    const byRef = new Map();
    for (const row of rows) {
      const refId = row.reference && row.reference.id;
      if (!refId || !row.position) continue;
      if (!byRef.has(refId)) byRef.set(refId, []);
      byRef.get(refId).push(row);
    }

    // reference → 実イベント ID に変換(ここだけは 1 参照 1 リクエスト)
    const refIds = [...byRef.keys()];
    const resolved = await mapLimit(refIds, REF_CONCURRENCY, (refId) =>
      plGet(`/v1/ranking/${rk.id}/event-by-reference/${refId}`).catch(() => null)
    );

    refIds.forEach((refId, i) => {
      const eventId = resolved[i] && resolved[i].id;
      if (!eventId) return; // 変換できない参照は捨てる(大会が消された等)
      const table = index[eventId] || (index[eventId] = {});
      byRef.get(refId).forEach((row) => {
        table[row.position] = row.points;
      });
    });
  }
  return index;
}

async function readCache() {
  const store = await indexStore();
  if (!store) return null;
  try {
    return await store.get(INDEX_KEY, { type: 'json' });
  } catch {
    return null; // 読めなければキャッシュ無し扱い
  }
}

/* 1 大会ぶんの「順位 → ポイント」。対象外の大会や、索引がまだ無いときは null を返し、
 * フロントがポイント列ごと出さないようにする。
 *
 * ここでは索引を作らない(作ると 6〜7 秒かかり、カードを開くのが目に見えて遅くなる)。
 * 期限切れのキャッシュもそのまま使う — ポイントは大会終了後の集計で決まってその後は
 * ほとんど動かないので、古いものを出す不利益より、出ない不利益のほうが大きい。
 * 更新は prewarm(10 分ごと)が担当する。 */
export async function pointsForEvent(eventId) {
  // mock は fixtures なので即座に作れる。ローカルで prewarm を回さなくても確認できるようにする。
  const index = config.isMock ? await buildIndex() : ((await readCache()) || {}).index || {};
  const table = index[eventId];
  return table && Object.keys(table).length ? table : null;
}

/* prewarm から呼ぶ。索引を作り直して Blobs に保存する。
 * 失敗しても例外は投げない(prewarm の他の処理を巻き込まない)。戻り値は登録した大会数。
 * 本番デプロイ直後は索引が無いので、最初の prewarm が走るまで(最大 10 分)ポイントは出ない。
 * すぐ反映したいときは `netlify functions:invoke prewarm` を叩く。 */
export async function warmPointsIndex() {
  const index = await buildIndex();
  const store = await indexStore();
  if (store) {
    try {
      await store.setJSON(INDEX_KEY, { at: Date.now(), index });
    } catch (err) {
      console.error('[ranking] 索引の保存に失敗:', err && err.message);
    }
  }
  return Object.keys(index).length;
}
