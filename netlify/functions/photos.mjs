// GET /api/photos/:eventId … その大会の写真一覧(Google Drive から)
// GET /api/photos          … 親フォルダ直下のフォルダ一覧(運用確認用)
//
// PokerLens には大会に複数枚の写真を紐づける仕組みが無い(告知用の 1 枚だけで、
// 実データでは過去 921 大会すべてで空)。そのため写真は Drive に置いてもらい、
// 「YYYY-MM-DD 大会名」のフォルダ名から大会を突き合わせる(詳細は lib/drive.mjs)。
//
// 閲覧者のアクセスがそのまま Drive に飛ばないよう、フォルダ一覧・ファイル一覧とも
// Netlify Blobs に置いて使い回す。画像そのものは Google の CDN からブラウザが直接
// 読むので、この Function を通らない(= こちらの転送量はかからない)。
//
// 写真は付加機能なので、Drive 側の障害や設定漏れでこのエンドポイントが 5xx を返して
// サイト全体の印象を悪くしないようにする。取れないときは前回のキャッシュ、それも
// 無ければ空配列を返し、フロントは写真タブを出さないだけになる。

import { plGet } from './lib/pokerlens.mjs';
import { config as appConfig } from './lib/config.mjs';
import {
  listFolders,
  listImages,
  matchFolder,
  eventFolderKey,
  photoSrc,
  DriveError,
} from './lib/drive.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: ['/api/photos', '/api/photos/:eventId'] };

/* 表示に使う幅。実測(2026-08-13)の転送量は w400=49KB / w1200=294KB / w2000=608KB。
 * サムネイルはグリッド 1 枚あたり 200px 前後で出すので w400 が等倍、w800 が 2x。
 * 拡大表示は w1600 — スマホからノート PC の全画面までこれで足り、原寸(886KB)を
 * 読ませずに済む。 */
const THUMB_W = 400;
const THUMB2X_W = 800;
const FULL_W = 1600;

/* Blobs キャッシュの有効期間。
 * 写真は大会終了後にまとめてアップされるだけで、秒単位の鮮度は要らない。
 * 一方で「掲載を取り下げたい」という依頼は Drive からファイルを消して対応する運用に
 * するため、長すぎると消えるまでの時間が延びる。その折り合いで 10 分にしている。 */
const CACHE_MS = 10 * 60e3;

const FOLDERS_KEY = 'folder-index';

let _store; // undefined=未試行 / null=利用不可 / object=store

async function cacheStore() {
  if (_store !== undefined) return _store;
  try {
    const { getStore } = await import('@netlify/blobs');
    _store = getStore('photos');
  } catch {
    // Blobs が使えない環境(ローカル未リンク等)ではキャッシュ無しで動く
    _store = null;
  }
  return _store;
}

/* キャッシュ越しに Drive を読む。
 * 戻り値の stale=true は「Drive から取れず、期限切れの内容を返した」の意味。
 * 呼び出し側はこれを見てキャッシュヘッダを短くし、復旧後すぐ新しい内容に戻るようにする。
 * mock ではキャッシュを挟まない(fixtures は「今」を基準に日付を組み立てるため、
 * 保存すると時間の経過でフォルダ名の日付が実際の大会とずれる)。 */
async function cached(key, load) {
  if (appConfig.isMock) return { items: await load(), stale: false, fetched: true };

  const store = await cacheStore();
  let rec = null;
  if (store) {
    try {
      rec = await store.get(key, { type: 'json' });
    } catch {
      /* 読めなければ取得しに行くだけ */
    }
  }
  if (rec && Date.now() - rec.at < CACHE_MS) return { items: rec.items, stale: false, fetched: false };

  try {
    const items = await load();
    if (store) {
      try {
        await store.setJSON(key, { at: Date.now(), items });
      } catch {
        /* 保存に失敗しても応答は返せる */
      }
    }
    return { items, stale: false, fetched: true };
  } catch (err) {
    // Drive 側の障害・クォータ超過。前回の内容があるならそれで凌ぐ
    console.error('[photos] Drive 取得失敗:', err && err.message);
    if (rec) return { items: rec.items, stale: true, fetched: false };
    throw err;
  }
}

/* 親フォルダ直下のフォルダ一覧。
 * 命名規約(先頭に YYYY-MM-DD)を満たさないフォルダは、写真が出ないまま気付かれない
 * ことになるので警告に出す。Drive を実際に見に行ったときだけログするので、
 * キャッシュが効いている間は繰り返さない。 */
async function loadFolders() {
  const res = await cached(FOLDERS_KEY, () => listFolders(appConfig.photoFolderId));
  if (res.fetched) {
    const bad = res.items.filter((f) => !f.date).map((f) => f.name);
    if (bad.length) {
      console.warn(
        '[photos] 日付が読めないフォルダ名(「YYYY-MM-DD 大会名」にしてください): ' + bad.join(' / ')
      );
    }
  }
  return res;
}

function loadImages(folderId) {
  return cached('folder:' + folderId, () => listImages(folderId));
}

function toPhoto(file) {
  return {
    id: file.id,
    name: file.name,
    // 幅・高さはフロントが img に入れて、読み込み前から場所を確保する(レイアウトのガタつき防止)
    w: file.w,
    h: file.h,
    thumb: photoSrc(file, THUMB_W),
    thumb2x: photoSrc(file, THUMB2X_W),
    full: photoSrc(file, FULL_W),
  };
}

// stale(前回のキャッシュで凌いでいる)ときは短めにして、復旧後すぐ新しい内容に切り替わるようにする
function cacheOpts(stale) {
  return stale ? { cacheSeconds: 60 } : { cacheSeconds: 600, swrSeconds: 86400 };
}

export default async (_req, context) =>
  handle(async () => {
    const { eventId } = context.params;

    // 環境変数が未設定でもエラーにしない(写真が無いだけでサイトは成立する)
    if (!appConfig.photosEnabled) {
      return json({ eventId: eventId || null, folder: null, photos: [] }, { cacheSeconds: 300 });
    }

    try {
      return await respond(eventId);
    } catch (err) {
      // Drive 側の障害で、前回のキャッシュも無い場合。5xx にせず「写真 0 枚」として返す。
      // フロントは写真タブを出さないだけで、大会情報の表示には影響しない。
      // 復旧したらすぐ拾い直せるよう、キャッシュは 60 秒に留める。
      if (err instanceof DriveError) {
        console.error('[photos] 写真を取得できませんでした:', err.message);
        return json({ eventId: eventId || null, folder: null, photos: [] }, { cacheSeconds: 60 });
      }
      throw err; // PokerLens 側のエラーは従来どおり handle() が整形する
    }
  });

async function respond(eventId) {
  const folders = await loadFolders();

  // 引数なし: フォルダ一覧をそのまま返す。運営が付けたフォルダ名がこちらでどう
  // 解釈されているか(日付を読めているか)を、実際に大会を開かずに確認するため。
  if (!eventId) {
    return json(
      {
        parentFolderId: appConfig.photoFolderId,
        folders: folders.items.map((f) => ({
          id: f.id,
          name: f.name,
          date: f.date,
          title: f.title,
          named: !!f.date, // false = 命名規約を満たしていない(写真が出ない)
        })),
        stale: folders.stale,
      },
      cacheOpts(folders.stale)
    );
  }

  const ev = await plGet(`/v1/event/${eventId}`);
  if (!ev) return json({ error: 'event not found' }, { status: 404 });

  const hit = matchFolder(folders.items, eventFolderKey(ev));
  if (!hit) {
    // 大半の大会には写真フォルダが無い(= 正常)。ここでログを出すと本当の命名ミスが埋もれる
    return json({ eventId, folder: null, photos: [] }, cacheOpts(folders.stale));
  }

  const files = await loadImages(hit.id);
  return json(
    {
      eventId,
      folder: { id: hit.id, name: hit.name, match: hit.match },
      photos: files.items.map(toPhoto),
      stale: folders.stale || files.stale,
    },
    cacheOpts(folders.stale || files.stale)
  );
}
