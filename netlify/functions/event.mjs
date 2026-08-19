// GET /api/events/:id            … アコーディオン詳細用のフル変換イベント(structure/results/live 込み)
// GET /api/events/:id/:part      … 個別サブリソース(levels|players|payouts|structure)を生データ寄りで返す
//
// フロントはカード展開時に /api/events/:id を取得し、一覧のイベントにマージする。

import { plGet, plPost } from './lib/pokerlens.mjs';
import { toDetailEvent, buildStructure, buildResults, buildPayouts, pausedLive } from './lib/adapter.mjs';
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
    const [levels, players, payouts, points] = await Promise.all([
      plGet(`/v1/event/${id}/levels`).catch(() => null),
      needPlayers ? plPost(`/v1/event/${id}/players`, {}).catch(() => null) : Promise.resolve(null),
      plGet(`/v1/event/${id}/payouts`).catch(() => null),
      pointsForEvent(id).catch(() => null),
    ]);

    /* running は毎回鮮度が要るので短め、それ以外は長めにキャッシュ(stale-while-revalidate 付き)。
     * 一時停止中はさらに短くする — 再開は次の取得で status.code が Running に戻ることでしか
     * 分からず、キャッシュ 10 秒 + フロントのポーリング 25 秒だと復帰まで最大 35 秒かかる。
     * 停止中はフロント側も 10 秒間隔に上げるので、合わせて最大 15 秒で復帰する(#55)。
     * 一時停止は status.code が Opened に戻る(= adapter の pausedLive)。 */
    const cacheSeconds = code === 'running' ? 10 : pausedLive(ev) ? 5 : 120;
    return json(toDetailEvent(ev, { levels, players, payouts, points }), {
      cacheSeconds,
      swrSeconds: cacheSeconds * 10,
    });
  });
