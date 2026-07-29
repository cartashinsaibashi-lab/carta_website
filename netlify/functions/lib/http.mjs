// Functions 共通の HTTP ヘルパ。

import { PokerLensError } from './pokerlens.mjs';

export function json(data, { status = 200, cacheSeconds = 0 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
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
