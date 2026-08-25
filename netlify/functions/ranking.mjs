// GET /api/ranking/:category … シリーズ通算のポイントランキング(#78)
//
// 集計は PokerLens 側にあるので自前では作らない。会場が「公開」に設定したランキングだけが
// API に出てくる(未公開だと /v1/ranking/search が 200 で 0 件を返す)。
//
// 返す形(データ契約):
//   { category, name: <ランキング名|null>, rows: [{ rank, name, points, events }] }
//
// 対応するランキングが無い種別(歌留多)・未公開のときは name:null / rows:[] を返す。
// フロントはそれを見てボタンとパネルを出さない。
//
// 種別 → ランキングの選び方と、順位表の癖(orderBy / position の形 / 表示名)は
// lib/ranking.mjs 側にまとめてある。

import { findRanking, rankingRows } from './lib/ranking.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: '/api/ranking/:category' };

/* ランキングは大会が終わるたびに更新されるが、進行中に秒単位で変わるものではない。
 * 一覧(30 秒)より長く、写真(600 秒)より短い 300 秒にしてある。
 * SWR を長めに置いて、2 人目以降は CDN から即返しつつ裏で取り直す。 */
const CACHE_SECONDS = 300;
const SWR_SECONDS = 3600;

function empty(category) {
  return { category, name: null, rows: [] };
}

export default async (_req, context) =>
  handle(async () => {
    const category = String(context.params.category || '');

    const info = await findRanking(category);
    if (!info) return json(empty(category), { cacheSeconds: CACHE_SECONDS, swrSeconds: SWR_SECONDS });

    const rows = await rankingRows(info.id);
    return json(
      { category, name: info.name, rows },
      { cacheSeconds: CACHE_SECONDS, swrSeconds: SWR_SECONDS }
    );
  });
