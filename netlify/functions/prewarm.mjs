// プリウォーム(スケジュール関数): 定期的に走らせて
//   1) 認証トークンを温める(Blobs に有効なトークンを確保 → 実リクエストは認証を省ける)
//   2) ランキング索引・写真の索引・シリーズ名を Blobs に用意する(重い処理を閲覧者に背負わせない)
//   3) /api/events と /api/photos の CDN キャッシュを新鮮に保つ(2人目以降が常に即時)
// を行う。Netlify の cron で自動実行される(HTTP パスは持たない)。

import { getToken } from './lib/pokerlens.mjs';
import { warmPointsIndex } from './lib/ranking.mjs';
import { config as appConfig } from './lib/config.mjs';
import { loadFolders, PREWARM_MAX_AGE_MS } from './lib/drivecache.mjs';
import { seriesMap } from './lib/series.mjs';

export const config = { schedule: '*/10 * * * *' }; // 10 分ごと

export default async () => {
  if (appConfig.isMock) {
    return new Response(JSON.stringify({ ok: true, skipped: 'mock' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = [];

  // 1) トークンを確保(有効ならそのまま、失効間近なら再認証して Blobs 更新)
  try {
    await getToken();
    results.push('token: ok');
  } catch (e) {
    results.push('token: ' + (e.message || 'error'));
  }

  // 2) ランキングポイントの索引を温める。
  //    索引を作るにはランキング内の参照ぶんだけ event-by-reference を叩く必要があり
  //    (逆引きの API が無いため。詳細は lib/ranking.mjs)、大会詳細の初回アクセスに
  //    その往復を背負わせたくないので、ここで先に作って Blobs に置いておく。
  try {
    results.push('points: ' + (await warmPointsIndex()) + ' events');
  } catch (e) {
    results.push('points: ' + (e.message || 'error'));
  }

  /* 3) 写真まとめの重い部分(Drive の索引と、シリーズ名の対応表)を Blobs に用意する。
   *    索引は**各フォルダの 1 枚目**まで読むため実データで 100 往復以上(実測 3〜6 秒)、
   *    シリーズ名は /v1/event/search を全ページ舐めるので実測 7.6 秒かかる(#114)。
   *    これを閲覧者のリクエストの中でやると、Netlify の同期関数の上限(既定 10 秒)に
   *    かかって索引が保存されないまま打ち切られ、次のリクエストもまた冷たいところから
   *    やり直す、という状態になりうる。スケジュール関数はもっと長く動けるので
   *    ここで作る(ランキング索引と同じ考え方)。
   *    2 つは互いに独立なので同時に取る。片方が失敗しても、もう片方は温めておく。
   *    PREWARM_MAX_AGE_MS(5 分)より古ければ作り直す — 読み手の期限(15 分)より
   *    手前で入れ替えて、閲覧者が期限切れに当たらないようにするため。 */
  const warmed = await Promise.allSettled([
    loadFolders(PREWARM_MAX_AGE_MS),
    seriesMap(PREWARM_MAX_AGE_MS),
  ]);
  results.push('drive-index: ' + (warmed[0].status === 'fulfilled'
    ? warmed[0].value.items.events.length + ' folders'
    : (warmed[0].reason && warmed[0].reason.message) || 'error'));
  results.push('series: ' + (warmed[1].status === 'fulfilled'
    ? warmed[1].value.size + ' days'
    : (warmed[1].reason && warmed[1].reason.message) || 'error'));

  // 4) /api/events を叩いて CDN キャッシュを温める(本番の公開 URL がある場合)
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (base) {
    try {
      const r = await fetch(base + '/api/events', { headers: { 'x-prewarm': '1' } });
      results.push('events: ' + r.status);
    } catch (e) {
      results.push('events: ' + (e.message || 'error'));
    }

    /* 5) /api/photos の CDN キャッシュを温める(#102)。
     *    中身(Drive 索引・シリーズ名)は上の 3) で Blobs に入れてあるので、
     *    ここは読むだけの速い往復で済む。 */
    try {
      const r = await fetch(base + '/api/photos', { headers: { 'x-prewarm': '1' } });
      results.push('photos: ' + r.status);
    } catch (e) {
      results.push('photos: ' + (e.message || 'error'));
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
