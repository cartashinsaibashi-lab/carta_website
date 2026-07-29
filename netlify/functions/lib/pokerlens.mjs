// PokerLens API クライアント。
// 認証は OAuth2 client_credentials(identity.pokerlens.net/connect/token)。
//   1) client_id + client_secret(=APIキー)で access_token(JWT)を取得
//   2) JWT を TTL(expires_in)付きでキャッシュ(warm な関数インスタンス間で再利用)
//   3) resource には access_token ヘッダ(既定)で付与。401 なら 1 回だけ再取得リトライ
//   4) mock モードでは fixtures を返し、ネットワークに出ない
//
// ステートレスなためコールドスタートでキャッシュは消えるが、その場合は再取得されるだけ。

import { config, assertLiveCredentials } from './config.mjs';
import { mockRequest } from './fixtures.mjs';

let tokenCache = null; // { token: string, expiresAt: number(ms) } | null

export class PokerLensError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PokerLensError';
    this.status = status;
  }
}

function resourceHeaders(token, body) {
  const h = { Accept: 'application/json' };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (token) h[config.authHeaderName] = config.authTokenPrefix + token;
  return h;
}

// /v1/security/authenticate でアクセストークン取得(playerToken 無し=匿名)
async function fetchToken() {
  assertLiveCredentials();
  const body = {
    clientID: config.clientId,
    clientSecretID: config.clientSecret,
    deviceUID: config.deviceUid,
    deviceName: 'carta-website',
    deviceOSVersion: 'server',
    deviceModel: 'bff',
    appVersion: '1.0.0',
    expiration: config.tokenExpiration,
    expirationType: config.tokenExpirationType,
    playerToken: '',
  };
  const res = await fetch(config.baseUrl + '/v1/security/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PokerLensError(res.status, `authenticate ${res.status}: ${text.slice(0, 200)}`);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new PokerLensError(502, 'authenticate: 非 JSON 応答'); }
  if (!j.token) throw new PokerLensError(502, 'authenticate: token がありません');
  return { token: j.token };
}

// トークンの実効 TTL(ミリ秒)。expiration/expirationType から算出し、
// 実際の失効より手前で切り替える。
function tokenTtlMs() {
  const n = config.tokenExpiration;
  const per = { minutes: 60e3, hours: 3600e3, days: 86400e3 }[config.tokenExpirationType] || 3600e3;
  // 実 TTL の 80% を有効期間として扱う(最低 5 分)
  return Math.max(5 * 60e3, n * per * 0.8);
}

async function getToken({ force = false } = {}) {
  const now = Date.now();
  if (!force && tokenCache && tokenCache.expiresAt > now) return tokenCache.token;
  const { token } = await fetchToken();
  tokenCache = { token, expiresAt: now + tokenTtlMs() };
  return token;
}

async function liveRequest(method, path, body) {
  const doFetch = (token) =>
    fetch(config.baseUrl + path, {
      method,
      headers: resourceHeaders(token, body),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(await getToken());
  if (res.status === 401) {
    // トークン失効の可能性 → 強制再取得して 1 回だけリトライ
    res = await doFetch(await getToken({ force: true }));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PokerLensError(res.status, `${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  const text = await res.text(); // 204 等の空対策
  return text ? JSON.parse(text) : null;
}

// 公開インターフェイス: mock/live を吸収する
export async function plGet(path) {
  if (config.isMock) return mockRequest('GET', path, undefined);
  return liveRequest('GET', path, undefined);
}

export async function plPost(path, body) {
  if (config.isMock) return mockRequest('POST', path, body);
  return liveRequest('POST', path, body);
}

export function _resetTokenCache() {
  tokenCache = null;
}
