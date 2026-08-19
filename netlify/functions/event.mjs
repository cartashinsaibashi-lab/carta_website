// GET /api/events/:id            … アコーディオン詳細用のフル変換イベント(structure/results/live 込み)
// GET /api/events/:id/:part      … 個別サブリソース(levels|players|payouts|structure)を生データ寄りで返す
//
// フロントはカード展開時に /api/events/:id を取得し、一覧のイベントにマージする。

import { plGet, plPost } from './lib/pokerlens.mjs';
import {
  toDetailEvent, buildStructure, buildResults, buildPayouts,
  isFinalDay, summaryIdOf, pausedLive,
} from './lib/adapter.mjs';
import { pointsForEvent } from './lib/ranking.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: ['/api/events/:id', '/api/events/:id/:part'] };

export default async (_req, context) =>
  handle(async () => {
    const { id, part } = context.params;

    const ev = await plGet(`/v1/event/${id}`);
    if (!ev) return json({ error: 'event not found' }, { status: 404 });

    const code = String((ev.status && ev.status.code) || '').toLowerCase();

    // 個別サブリソース
    if (part === 'levels' || part === 'structure') {
      const levels = await plGet(`/v1/event/${id}/levels`).catch(() => null);
      const lateReg = ev.subscription && ev.subscription.lateRegistrationLevel;
      return json({ structure: buildStructure(levels, lateReg) }, { cacheSeconds: 300 });
    }
    if (part === 'players') {
      const players = await plPost(`/v1/event/${id}/players`, {}).catch(() => null);
      return json({ results: buildResults(players) }, { cacheSeconds: 60 });
    }
    if (part === 'payouts') {
      const payouts = await plGet(`/v1/event/${id}/payouts`).catch(() => null);
      return json({ payouts: buildPayouts(payouts) }, { cacheSeconds: 300 });
    }

    // フル詳細: structure / payouts は常に取得。players は past(結果)と running(座席)で取得。
    // ランキングポイントは Prize / Results の両タブで使うため、ここで一緒に載せて往復を減らす
    // (対象外の大会では null が返り、フロントはポイント列を出さない)。
    const needPlayers = code === 'closed' || code === 'running';

    /* 日をまたぐ大会の日別レコード(behaviour.isFlight)だけ、同じ大会の全日程を取りに行く。
     * これで「最終日かどうか」が決まり、通過日は Survivor タブ、最終日は Results タブになる(#54)。
     * 946 件中 70 件しか該当しないので、単日大会には往復が増えない。 */
    const isFlight = !!(ev.behaviour && ev.behaviour.isFlight);
    let [levels, players, payouts, points, flights] = await Promise.all([
      plGet(`/v1/event/${id}/levels`).catch(() => null),
      needPlayers ? plPost(`/v1/event/${id}/players`, {}).catch(() => null) : Promise.resolve(null),
      plGet(`/v1/event/${id}/payouts`).catch(() => null),
      pointsForEvent(id).catch(() => null),
      isFlight ? plGet(`/v1/event/${id}/flights`).catch(() => null) : Promise.resolve(null),
    ]);

    /* 最終日は入賞者を親(サマリー)レコードから取り直す。最終日のレコードには
     * その日に来た人しか居らず(実データで入賞 32 名に対し結果 9 名)、入賞者を全員出せない。
     * 親の id は flights の応答からしか引けない(summaryId は親の referenceId であって id ではなく、
     * GET /v1/event/{summaryId} は 404)。取れなければその日の結果のままフォールバックする。 */
    let summaryPlayers = null;
    if (flights && isFinalDay(ev, flights)) {
      const summaryId = summaryIdOf(flights);
      if (summaryId) {
        if (needPlayers) {
          summaryPlayers = await plPost(`/v1/event/${summaryId}/players`, {}).catch(() => null);
        }
        /* ランキングポイントも親レコードから引く(#64)。
         * **ポイントは日別レコードには紐づかず、親(isSummary)にだけ付く** — ランキングを
         * 全件たどって確認した(#3 MAIN EVENT の親に 32 行、#2 BABY WOLF の親に 9 行)。
         * そのため最終日のカードは自分の id では 0 件になり、Points 列が出ていなかった。
         * 親の順位は「大会全体の最終成績」で、上の summaryPlayers と同じ並びなので順位が一致する。
         * 索引(Blobs)を読むだけなので往復は増えない。日別側にポイントがあればそちらを優先する。 */
        if (!points || !Object.keys(points).length) {
          points = await pointsForEvent(summaryId).catch(() => null);
        }
      }
    }

    /* running は毎回鮮度が要るので短め、それ以外は長めにキャッシュ(stale-while-revalidate 付き)。
     * 一時停止中はさらに短くする — 再開は次の取得で status.code が Running に戻ることでしか
     * 分からず、キャッシュ 10 秒 + フロントのポーリング 25 秒だと復帰まで最大 35 秒かかる。
     * 停止中はフロント側も 10 秒間隔に上げるので、合わせて最大 15 秒で復帰する(#55)。
     * 一時停止は status.code が Opened に戻る(= adapter の pausedLive)。 */
    const cacheSeconds = code === 'running' ? 10 : pausedLive(ev) ? 5 : 120;
    return json(toDetailEvent(ev, { levels, players, payouts, points, flights, summaryPlayers }), {
      cacheSeconds,
      swrSeconds: cacheSeconds * 10,
    });
  });
