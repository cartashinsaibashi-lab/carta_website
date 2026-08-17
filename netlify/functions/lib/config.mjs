// 環境変数を 1 か所に集約する設定モジュール。
// 各 Function / lib はここから設定を読む(process.env を直接触らない)。
//
// 認証フロー(実サイトの通信解析で確定):
//   POST /v1/security/authenticate
//     { clientID, clientSecretID:<APIキー>, deviceUID, deviceName, ..., playerToken:"" }
//   → レスポンスの token を access_token ヘッダに付けて各 API を呼ぶ。
//   ※ clientID は任意文字列で可。アクセス範囲は clientSecretID(=カルタの API キー)で決まる。

function csv(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const MODE = (process.env.POKERLENS_MODE || 'mock').toLowerCase();

export const config = {
  mode: MODE,
  isMock: MODE !== 'live',

  baseUrl: (process.env.POKERLENS_BASE_URL || 'https://api.pokerlens.net').replace(/\/+$/, ''),

  // --- 認証(live で必須) ---
  // clientSecretID = 管理コンソール Integration の API キー(carta_api_key)
  clientSecret: process.env.POKERLENS_CLIENT_SECRET || process.env.POKERLENS_API_KEY || '',
  // clientID は任意文字列で可(アクセス範囲はキーで決まる)
  clientId: process.env.POKERLENS_CLIENT_ID || 'net.pokerlens.webapi',
  // device 情報(固定値でよい)
  deviceUid: process.env.POKERLENS_DEVICE_UID || 'carta-website-bff-0001',
  // 発行するトークンの有効期間
  tokenExpiration: Number(process.env.POKERLENS_TOKEN_EXP || 1),
  tokenExpirationType: process.env.POKERLENS_TOKEN_EXP_TYPE || 'days',

  // 取得した token を付けるヘッダ(実サイトは access_token に生値)
  authHeaderName: process.env.POKERLENS_AUTH_HEADER || 'access_token',
  authTokenPrefix: process.env.POKERLENS_AUTH_PREFIX || '',

  // 一覧で「今日から何日前まで」さかのぼって取得するか(今後の予定は常に全部含む)。
  // 過去の WOLF SERIES 等も出したいので既定は広め。0 で「今後のみ」。
  historyDays: Number(process.env.POKERLENS_HISTORY_DAYS || 120),

  // wolf / utage の league 名部分一致マップ(それ以外は other)
  categoryWolf: csv(process.env.POKERLENS_CATEGORY_WOLF || 'wolf,ウルフ'),
  categoryUtage: csv(process.env.POKERLENS_CATEGORY_UTAGE || 'utage,宴'),

  // --- 大会写真(Google Drive) ---
  // PokerLens には大会に複数枚の写真を紐づける仕組みが無い(告知用の 1 枚だけ)ため、
  // 写真は Drive の「リンクを知っている全員が閲覧可」な親フォルダから読む。
  // 認証は API キーのみで、公開されたファイルしか読めない。
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  // 親フォルダの ID(URL の /folders/ の後ろ)。直下に「YYYY-MM-DD 大会名」のフォルダが並ぶ。
  photoFolderId: process.env.PHOTO_DRIVE_FOLDER_ID || '',
};

// 写真機能が使えるか。live では両方の環境変数が要る。
// 未設定でもエラーにはせず「写真が 0 枚」として扱い、サイトの他の機能を巻き込まない
// (写真は付加機能で、これが無くても大会情報は成立するため)。
config.photosEnabled = config.isMock || !!(config.googleApiKey && config.photoFolderId);

export function assertLiveCredentials() {
  if (config.isMock) return;
  if (!config.clientSecret) {
    throw new Error(
      'PokerLens live モードですが API キーが未設定です。' +
        'POKERLENS_API_KEY(または POKERLENS_CLIENT_SECRET)にカルタの API キーを設定してください。'
    );
  }
}
