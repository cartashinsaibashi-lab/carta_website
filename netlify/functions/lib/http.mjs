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

/* ハンドラを包んでエラーを JSON に整形する。
 *
 * **上流(PokerLens / Drive)のメッセージをブラウザに返さない**(#106)。
 * `PokerLensError.message` は `GET /v1/event/xxx -> 500 <上流の応答本文の先頭 300 文字>`、
 * `DriveError` も同じ形で、以前はこれをそのままレスポンス本文に載せていた。実際に
 * `/api/events/<不正なID>` を叩くと PokerLens の内部コントローラ名まで開発者ツールに出ていた。
 * 参加者データ(`POST /v1/event/{id}/players`)は本名・会員カード番号・チケット QR を含み、
 * **API 側では項目を絞れない**(検索オプションに項目選択が無く、`includePlayerInfo` も効かない)。
 * つまり「BFF が必要な項目だけ組み直して捨てる」ことに依存しており、上流の本文を素通しする
 * このエラー経路だけがその唯一の抜け穴だった。
 *
 * 返すのは状態を表す固定文言だけにする。フロントは `res.ok` しか見ておらず本文を読まない
 * (`js/api.js`)ので表示は変わらない。調査に要る詳細は console.error でサーバーログにだけ残す。 */
export async function handle(fn) {
  try {
    return await fn();
  } catch (err) {
    const upstream = err instanceof PokerLensError;
    const status = upstream ? err.status || 502 : 500;
    console.error('[api error]', err);
    // 4xx = 呼び出し方の問題 / 5xx = 上流かこちらの障害。これ以上は明かさない
    const message = status < 500 ? 'bad request' : upstream ? 'upstream error' : 'internal error';
    return json({ error: message }, { status });
  }
}
