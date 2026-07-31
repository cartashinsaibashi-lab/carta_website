// Functions 共通の HTTP ヘルパ。

import { PokerLensError } from './pokerlens.mjs';

export function json(data, { status = 200, cacheSeconds = 0, swrSeconds = 0 } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cacheSeconds > 0) {
    const swr = swrSeconds > 0 ? `, stale-while-revalidate=${swrSeconds}` : '';
    // ブラウザ向け
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}${swr}`;
    // Netlify CDN の耐久キャッシュ(最初の1人以外は CDN から即返す。stale を返しつつ裏で更新)
    headers['Netlify-CDN-Cache-Control'] =
      `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${swrSeconds || cacheSeconds * 20}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(data), { status, headers });
}

// ハンドラを包んでエラーを JSON に整形する
export async function handle(fn) {
  try {
    return await fn();
  } catch (err) {
    const status = err instanceof PokerLensError ? err.status || 502 : 500;
    // サーバーログには詳細、クライアントには最小限
    console.error('[api error]', err);
    return json({ error: err.message || 'internal error' }, { status });
  }
}
