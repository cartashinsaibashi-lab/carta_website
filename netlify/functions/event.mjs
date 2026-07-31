// GET /api/events/:id            … アコーディオン詳細用のフル変換イベント(structure/results/live 込み)
// GET /api/events/:id/:part      … 個別サブリソース(levels|players|live|structure)を生データ寄りで返す
//
// フロントはカード展開時に /api/events/:id を取得し、一覧のイベントにマージする。

import { plGet, plPost } from './lib/pokerlens.mjs';
import { toDetailEvent, buildStructure, buildResults } from './lib/adapter.mjs';
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

    // フル詳細: structure は常に取得。players は past(結果)と running(座席)で取得。
    const needPlayers = code === 'closed' || code === 'running';
    const [levels, players] = await Promise.all([
      plGet(`/v1/event/${id}/levels`).catch(() => null),
      needPlayers ? plPost(`/v1/event/${id}/players`, {}).catch(() => null) : Promise.resolve(null),
    ]);

    // running は毎回鮮度が要るので短め、それ以外は長めにキャッシュ(stale-while-revalidate 付き)
    const cacheSeconds = code === 'running' ? 10 : 120;
    return json(toDetailEvent(ev, { levels, players }), { cacheSeconds, swrSeconds: cacheSeconds * 10 });
  });
