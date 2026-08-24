// Google Drive を「大会写真の保管庫」として読むクライアント。
//
// Drive 側の運用(顧客と合意済み):
//   親フォルダ … 「リンクを知っている全員が閲覧可」で共有。ID は PHOTO_DRIVE_FOLDER_ID
//     ├ 「WOLF」/「宴」/「歌留多」… 種別フォルダ。**この 1 段で大会写真の種別が決まる**
//     │    ├ 「Play Guide」… Player's Guide の PDF(写真ではないのでここでは無視する)
//     │    └ 「YYYY-MM-DD 大会名」… 大会 1 つにつき 1 フォルダ
//     │         └ 写真ファイル
//     └ 「YYYY-MM-DD 大会名」… 種別フォルダを作る前の旧構成。移行中だけ存在する
//
// 共有してもらうのは親フォルダだけで、大会ごとのフォルダは名前から自動照合する。
// こうすると運営は「フォルダを作って写真を入れる」だけでよく、
// 大会 ID とアルバム URL を対応づける台帳(スプレッドシート)の運用が要らない。
//
// **旧構成(親フォルダ直下に大会フォルダ)も読み続ける(#72)。**
// 種別フォルダは運営が手で作って既存フォルダを移動する。移動とデプロイを同時刻に
// 合わせるのは無理なので、両方を読めるようにしておく。旧位置のフォルダは種別不明
// (category: null)として扱い、大会との照合ではフォールバックとして使う。
// 移行が済んで種別不明が 0 件になったら旧構成の読み取りを外す。
//
// フォルダ名に開催日を入れてもらうのは必須。実データで、過去 921 大会のうち
// ユニークな大会名は 274 種類しかなく(FREEROLL が 147 件、#2 DEEP STACK が 141 件)、
// 名前だけでは 77% の大会が特定できないため。日付を足すと 921 件中 917 件が一意になる。
//
// 認証は API キーのみ(OAuth 不要)。公開されたファイルしか読めないので、
// 万一キーが漏れても非公開のドライブには届かない。
//
// 入出力:
//   listFolderTree(parentId)              → { events, categories, unnamed }
//   listImages(folderId)                  → [{ id, name, w, h, takenAt }]
//   matchFolder(events, evKey, category)  → 一致したフォルダ(+ match 種別)| null
//   eventFolderKey(venueEvent)            → { date, name } (照合に使う大会側のキー)

import { config } from './config.mjs';
import { mockDriveFolders, mockDriveImages, mockPhotoSrc } from './fixtures.mjs';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

// Drive のファイル/フォルダ ID は英数と - _ のみ。q パラメータに素で埋め込むため、
// 想定外の文字(クォート等)が混じっていたら組み立てる前に弾く。
// 環境変数の設定ミス(URL を丸ごと貼った等)でクエリが壊れるのも同時に防げる。
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;

function assertId(id, what) {
  if (!ID_RE.test(String(id || ''))) {
    throw new DriveError(500, `${what} の形式が不正です(英数・- ・_ のみ。URL ではなく ID を設定してください)`);
  }
}

// files.list を全ページ取得する。q は呼び出し側で組み立てた検索条件。
// fields は files(...) の中身(必要な項目だけを取ることで応答を小さくする)。
async function driveList(q, fields) {
  if (!config.googleApiKey) throw new DriveError(500, 'GOOGLE_API_KEY が未設定です');

  const out = [];
  let pageToken = '';
  // 1 ページ 1000 件(Drive v3 の上限)。安全弁として 10 ページ = 10,000 件で打ち切る。
  // 親フォルダにも 1 大会のフォルダにもこの規模は現実的に無いため、ここに達したら
  // 親フォルダの取り違え(マイドライブ直下を指している等)を疑う。
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      pageSize: '1000',
      orderBy: 'name_natural', // ページをまたいでも順序が安定するように指定する
      key: config.googleApiKey,
      // 親フォルダが共有ドライブ上に置かれても動くようにする(マイドライブ上では無害)
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${DRIVE_FILES_URL}?${params}`);
    const text = await res.text();
    if (!res.ok) {
      // 応答本文に API キーは含まれないが、長い HTML が返ることがあるので切り詰める
      throw new DriveError(res.status, `drive files.list ${res.status}: ${text.slice(0, 300)}`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new DriveError(502, 'drive files.list: 非 JSON 応答');
    }
    out.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

// --- 名前の正規化 ---------------------------------------------------------

/* 同じ大会を指す名前が、Drive・PokerLens・Google フォトで別々の記号を使っていることを
 * 実測で確認している。特に**チルダは 3 種類**が混在する:
 *   Drive のフォルダ名   「#1 狼煙 〜NOROSHI〜」 U+301C 波ダッシュ
 *   PokerLens の大会名   「#1 狼煙 ～NOROSHI～」 U+FF5E 全角チルダ
 *   Google フォト        「#1 狼煙~NOROSHI~」    U+007E 半角チルダ
 *
 * 落とし穴: NFKC は U+FF5E を U+007E に直すが、U+301C は直さない。
 * 標準の正規化に任せるだけでは Drive のフォルダ名が PokerLens と一致しないので、
 * チルダは明示的に統一する。引用符・ダッシュも同じ「字形違い」の問題なので併せて畳む。
 * 記号前後のスペースの有無も揃っていないため、空白は全部落とす。
 *
 * 長音記号(ー U+30FC)はダッシュに含めない。日本語では別の文字で、
 * 畳むと「ポーカー」と「ポ-カ-」のような別語が一致してしまうため。
 *
 * 文字クラスはコードポイントで書く。見た目で区別できない文字を扱うので、
 * ソースに生の記号を置くと、貼り付けやエディタの設定で別の字に化けても気付けない。 */
const TILDES = /[\u301c\uff5e\u223c\u007e]/g; // 波ダッシュ / 全角チルダ / チルダ演算子 / 半角チルダ
const DQUOTES = /[\u201c\u201d\u201e\u201f\u2033\uff02]/g; // 各種ダブルクォート
const SQUOTES = /[\u2018\u2019\u201a\u201b\u2032\uff07]/g; // 各種シングルクォート
// ハイフン〜ダッシュ・マイナス。長音記号(ー U+30FC)は日本語の別の文字なので含めない
const DASHES = /[\u2010-\u2015\u2212\uff0d]/g;

export function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(TILDES, '~')
    .replace(DQUOTES, '"')
    .replace(SQUOTES, "'")
    .replace(DASHES, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/* フォルダ名「YYYY-MM-DD 大会名」を日付と大会名に割る。
 * 規約は YYYY-MM-DD だが、運営が / や . で書いたり区切りを省いたりしても拾えるようにする
 * (人が手で作るフォルダなので、ここで厳しくすると写真が出ないだけの事故になる)。
 * 日付として読めなければ null を返し、呼び出し側が「命名ミス」としてログに出す。 */
const FOLDER_RE = /^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})[\s_－-]*(.*)$/;

export function parseFolderName(name) {
  const m = FOLDER_RE.exec(String(name || '').trim());
  if (!m) return null;
  const [, y, mo, d, rest] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return { date: `${y}-${mo}-${d}`, title: rest.trim(), norm: normalizeTitle(rest) };
}

/* 照合に使う大会側のキー。開催日は dailyDetails.startDate / date から取る
 * (VenueEvent のトップレベルに date は無い。adapter.mjs も startDate を見ている)。
 * 日付は JST の壁時計としてそのまま先頭 10 文字を切り出す。タイムゾーン変換をすると
 * 深夜開始の大会が前日にずれ、フォルダ名と合わなくなるため。 */
export function eventFolderKey(ev) {
  const dd = (ev && ev.dailyDetails) || {};
  const iso = String(dd.startDate || dd.date || (ev && ev.status && ev.status.date) || '');
  return { date: iso.slice(0, 10), name: (ev && ev.name) || dd.name || '' };
}

/* 開催日 + 名前でフォルダを 1 つ選ぶ。
 *   1) 開催日 + 正規化した大会名の完全一致
 *   2) 同じ開催日で、どちらかの名前がもう一方を含む(運営が大会名を一部だけ書いた場合)。
 *      候補が 1 つに絞れるときだけ採用する
 * 同日・同名の大会は実データで 4 件だけ存在する(昼の部・夜の部と思われる)。
 * その 4 件は区別できないので、両方に同じフォルダを出す(先頭を使う)。 */
function pickFolder(folders, key) {
  const want = normalizeTitle(key.name);

  const exact = folders.filter((f) => f.date === key.date && f.norm === want);
  if (exact.length) return { ...exact[0], match: 'exact' };

  // 短すぎる名前での部分一致は誤爆する(「#1」が何にでも当たる)ので 3 文字以上に限る
  const partial = folders.filter(
    (f) =>
      f.date === key.date &&
      f.norm.length >= 3 &&
      want.length >= 3 &&
      (f.norm.includes(want) || want.includes(f.norm))
  );
  return partial.length === 1 ? { ...partial[0], match: 'partial' } : null;
}

/* 大会 → フォルダの照合。
 *
 * **同じ種別のフォルダを先に探し、無ければ種別不明(旧構成)から探す**(#72)。
 * 移行中は同じ大会のフォルダが新旧どちらの位置にもあり得るので、新しい位置を優先する。
 * category を渡さないときは全部から探す(種別が決まらない呼び出し向け)。
 * 種別で先に絞ることで、別シリーズの同日同名フォルダを掴む事故も防げる。 */
export function matchFolder(folders, key, category) {
  if (!key.date || !key.name) return null;
  if (!category) return pickFolder(folders, key);
  return (
    pickFolder(folders.filter((f) => f.category === category), key) ||
    pickFolder(folders.filter((f) => !f.category), key)
  );
}

// --- 取得 -----------------------------------------------------------------

/* フォルダ名 → 種別。normalizeTitle() を通した**完全一致**で判定する。
 * 部分一致にすると「WOLF」が大会フォルダ名(例: 2026-08-23 WOLF MAIN EVENT)にも
 * 当たってしまい、大会フォルダを種別フォルダと誤認する。 */
function folderCategory(name) {
  const n = normalizeTitle(name);
  const hit = (list) => list.some((k) => normalizeTitle(k) === n);
  if (hit(config.photoFolderWolf)) return 'wolf';
  if (hit(config.photoFolderUtage)) return 'utage';
  if (hit(config.photoFolderOther)) return 'other';
  return null;
}

// Player's Guide の PDF を入れるフォルダか。大会フォルダではないので写真の対象から外す。
function isGuideFolder(name) {
  const n = normalizeTitle(name);
  return config.photoGuideFolder.some((k) => normalizeTitle(k) === n);
}

function toEventFolder(f, parsed, category) {
  return {
    id: f.id,
    name: f.name,
    date: parsed.date,
    title: parsed.title,
    norm: parsed.norm,
    category, // null = 旧構成(親フォルダ直下)で種別が決まらないもの
  };
}

/* 親フォルダ配下のフォルダを、種別フォルダ 1 段を降りて集める(#72)。
 *
 * 返り値:
 *   events     … 大会フォルダ [{ id, name, date, title, norm, category }]
 *                 category は 'wolf'|'utage'|'other'|null(null = 旧構成)
 *   categories … 見つかった種別フォルダ [{ id, name, category }]
 *   unnamed    … 命名規約を満たさないフォルダ名。呼び出し側が警告に出す(黙って捨てない)
 *
 * Drive の読み取りは「親 1 回 + 種別フォルダの数」。種別は 3 つなので最大 4 往復で、
 * 結果は photos.mjs が Blobs に 10 分キャッシュするため閲覧者が増えても回数は増えない。
 * 種別フォルダの取得は並列にする(直列だと 3 往復ぶん待ち時間が積み上がる)。 */
export async function listFolderTree(parentId) {
  const top = config.isMock ? mockDriveFolders(parentId) : await fetchFolders(parentId);

  const categories = [];
  const events = [];
  const unnamed = [];

  for (const f of top) {
    const cat = folderCategory(f.name);
    if (cat) {
      categories.push({ id: f.id, name: f.name, category: cat });
      continue;
    }
    // 種別フォルダでなければ旧構成の大会フォルダとして読む(移行中だけ存在する)
    const parsed = parseFolderName(f.name);
    if (parsed) events.push(toEventFolder(f, parsed, null));
    else unnamed.push(f.name);
  }

  const children = await Promise.all(
    categories.map((c) => (config.isMock ? mockDriveFolders(c.id) : fetchFolders(c.id)))
  );

  categories.forEach((c, i) => {
    for (const f of children[i]) {
      if (isGuideFolder(f.name)) continue; // Player's Guide の置き場。写真ではない
      const parsed = parseFolderName(f.name);
      if (parsed) events.push(toEventFolder(f, parsed, c.category));
      else unnamed.push(`${c.name}/${f.name}`);
    }
  });

  return { events, categories, unnamed };
}

async function fetchFolders(parentId) {
  assertId(parentId, 'PHOTO_DRIVE_FOLDER_ID');
  return driveList(
    `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    'id,name'
  );
}

/* 大会フォルダの中の画像一覧。
 * 並び順は撮影日時(imageMediaMetadata.time)が全ファイルにあるときだけそれを使い、
 * 無ければファイル名の自然順にする。カメラとスマホが混ざると名前の連番が
 * 撮影順にならないが、撮影日時が欠けるファイル(加工済み・スクショ等)もあるため、
 * 全部揃っているときだけ時刻順に切り替える。 */
export async function listImages(folderId) {
  const raw = config.isMock ? mockDriveImages(folderId) : await fetchImages(folderId);
  const files = raw.map((f) => {
    const meta = f.imageMediaMetadata || {};
    return {
      id: f.id,
      name: f.name || '',
      w: Number(meta.width) || 0,
      h: Number(meta.height) || 0,
      // "2026:05:27 19:12:03" 形式(EXIF そのまま)。並べ替えにしか使わないので変換しない
      takenAt: meta.time || '',
    };
  });

  const allTimed = files.length > 0 && files.every((f) => f.takenAt);
  files.sort((a, b) =>
    allTimed
      ? a.takenAt.localeCompare(b.takenAt)
      : a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  return files;
}

async function fetchImages(folderId) {
  assertId(folderId, 'フォルダ ID');
  return driveList(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    'id,name,imageMediaMetadata(width,height,time)'
  );
}

/* 表示用の画像 URL(幅を指定してリサイズ済みを受け取る)。
 * drive.google.com/thumbnail?id=…&sz=w1200 でも同じ画像が取れるが、あちらはリダイレクトを
 * 挟む。lh3.googleusercontent.com は Google の CDN を直接叩くので 1 往復速い
 * (実測 2026-08-13: どちらも w1200 で 294KB、w400 で 49KB、w2000 で 608KB)。
 * ブラウザに直接読ませるので、この配信でこちら側の転送量はかからない。
 * mock では実在しない ID なので、代わりに単色のプレースホルダ画像を返す。 */
export function photoSrc(file, width) {
  if (config.isMock) return mockPhotoSrc(file, width);
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(file.id)}=w${width}`;
}
