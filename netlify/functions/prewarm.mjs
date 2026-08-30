// プリウォーム(スケジュール関数): 定期的に走らせて
//   1) 認証トークンを温める(Blobs に有効なトークンを確保 → 実リクエストは認証を省ける)
//   2) /api/events と /api/photos の CDN キャッシュを新鮮に保つ(2人目以降が常に即時)
// を行う。Netlify の cron で自動実行される(HTTP パスは持たない)。

import { getToken } from './lib/pokerlens.mjs';
import { warmPointsIndex } from './lib/ranking.mjs';
import { config as appConfig } from './lib/config.mjs';

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

  // 3) /api/events を叩いて CDN キャッシュを温める(本番の公開 URL がある場合)
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (base) {
    try {
      const r = await fetch(base + '/api/events', { headers: { 'x-prewarm': '1' } });
      results.push('events: ' + r.status);
    } catch (e) {
      results.push('events: ' + (e.message || 'error'));
    }

    /* 4) /api/photos も温める(#102)。写真まとめがアルバム表示になり、
     *    フォルダ一覧が**各フォルダの 1 枚目**を必要とするようになった。
     *    実データで 62 フォルダ = 62 往復あり、キャッシュが切れた最初の閲覧者に
     *    これを背負わせると数秒待たせる。ここで先に読んで Blobs に置いておけば、
     *    閲覧者は常にキャッシュ済みの状態に当たる(ランキング索引と同じ考え方)。
     *    ファイル一覧のキャッシュは写真タブと共用なので、こちらも一緒に温まる。 */
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
