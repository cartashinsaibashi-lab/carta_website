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

  /* --- シリーズランキング(#78) ---
   * 種別 → ランキングの対応づけ。**名前だけでは決められない**ので ID を直接指定できる。
   * 実データのランキングは 3 件で、「宴」で名前一致させると中身が空の旧版
   * (宴POS ver2 / 登録 0 名)も当たってしまう。
   * ID を空にしておくと下の名前一致で選ぶ(登録者 0 名を除き、期間が最も新しいもの)。 */
  rankingWolfId: process.env.POKERLENS_RANKING_WOLF || '',
  rankingUtageId: process.env.POKERLENS_RANKING_UTAGE || '',

  /* 名前一致に使う語。ランキング名は「WOLF 2026 #02」「宴POS ver3」で、
   * シリーズが増えるたびに新しい名前のものが増える(= ID を固定で焼き込めない)。
   * 上の categoryWolf / categoryUtage とは別物 — あちらは PokerLens の**リーグ名**。 */
  rankingNameWolf: csv(process.env.POKERLENS_RANKING_NAME_WOLF || 'wolf,ウルフ'),
  rankingNameUtage: csv(process.env.POKERLENS_RANKING_NAME_UTAGE || '宴,utage'),

  // --- 大会写真(Google Drive) ---
  // PokerLens には大会に複数枚の写真を紐づける仕組みが無い(告知用の 1 枚だけ)ため、
  // 写真は Drive の「リンクを知っている全員が閲覧可」な親フォルダから読む。
  // 認証は API キーのみで、公開されたファイルしか読めない。
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  /* 親フォルダの ID(URL の /folders/ の後ろ)。直下に種別フォルダが並ぶ(下記)。
   * **Drive で固定するのはこの ID だけ**で、種別・シリーズ・大会のフォルダは
   * 毎回この下を辿って見つける。運営がシリーズや大会のフォルダを増やしても
   * 設定変更もデプロイも要らない(反映は索引のキャッシュ 10 分ぶん遅れる)。 */
  photoFolderId: process.env.PHOTO_DRIVE_FOLDER_ID || '',

  /* 親フォルダ直下に置く種別フォルダの名前(#72)。この 1 段で大会写真の種別が決まる。
   *   親フォルダ / WOLF|宴 / シリーズ名 / YYYY-MM-DD 大会名 / 写真   (#114)
   *   親フォルダ / 歌留多 / YYYY-MM-DD 大会名 / 写真                  (シリーズを挟まない)
   * 上の categoryWolf / categoryUtage とは別物 — あちらは PokerLens のリーグ名、
   * こちらは Drive のフォルダ名で、運営が手で作る。名前を変えたときに写真が消えないよう、
   * カンマ区切りで別名を足せるようにしてある。照合は normalizeTitle() を通した完全一致
   * (部分一致にすると「WOLF」が大会フォルダ名にも当たってしまう)。 */
  photoFolderWolf: csv(process.env.PHOTO_FOLDER_WOLF || 'WOLF,ウルフ'),
  photoFolderUtage: csv(process.env.PHOTO_FOLDER_UTAGE || '宴,UTAGE'),
  photoFolderOther: csv(process.env.PHOTO_FOLDER_OTHER || '歌留多,カルタ,CARTA,OTHER'),

  /* 種別フォルダの直下に置く Player's Guide(PDF)のフォルダ名。
   * ここでフォルダ名を持っておくのは、大会フォルダの命名ミス警告から除外するため
   * (「YYYY-MM-DD で始まっていない」と毎回警告に出てしまう)。
   * PDF を実際に読むのは別 issue。
   * 実際に運営が作ったフォルダは**スペース無しの「PlayGuide」**(2026-08-24 に確認)。
   * normalizeTitle() が空白を全部落とすのでこの綴りでも一致する。 */
  photoGuideFolder: csv(process.env.PHOTO_GUIDE_FOLDER || "Play Guide,Player's Guide"),
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
