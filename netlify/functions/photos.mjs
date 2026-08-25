// GET /api/photos/:eventId … その大会の写真一覧(Google Drive から)
// GET /api/photos          … 親フォルダ直下のフォルダ一覧(運用確認用)
//
// PokerLens には大会に複数枚の写真を紐づける仕組みが無い(告知用の 1 枚だけで、
// 実データでは過去 921 大会すべてで空)。そのため写真は Drive に置いてもらい、
// 「YYYY-MM-DD 大会名」のフォルダ名から大会を突き合わせる(詳細は lib/drive.mjs)。
// 大会フォルダは種別フォルダ(WOLF / 宴 / 歌留多)の下にあるものだけを読む
// — 構成の詳細は lib/drive.mjs 冒頭。
//
// フォルダ一覧・ファイル一覧は lib/drivecache.mjs 越しに読む(Netlify Blobs に 10 分)。
// 画像そのものは Google の CDN からブラウザが直接読むので、この Function を通らない
// (= こちらの転送量はかからない)。
//
// 写真は付加機能なので、Drive 側の障害や設定漏れでこのエンドポイントが 5xx を返して
// サイト全体の印象を悪くしないようにする。取れないときは前回のキャッシュ、それも
// 無ければ空配列を返し、フロントは写真タブを出さないだけになる。

import { plGet } from './lib/pokerlens.mjs';
import { categoryOf } from './lib/adapter.mjs';
import { config as appConfig } from './lib/config.mjs';
import {
  listImages,
  matchFolder,
  eventFolderKey,
  photoSrc,
  DriveError,
} from './lib/drive.mjs';
import { cached, loadFolders } from './lib/drivecache.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: ['/api/photos', '/api/photos/:eventId'] };

/* 表示に使う幅。実測(2026-08-13)の転送量は w400=49KB / w1200=294KB / w2000=608KB。
 * サムネイルはグリッド 1 枚あたり 200px 前後で出すので w400 が等倍、w800 が 2x。
 * 拡大表示は w1600 — スマホからノート PC の全画面までこれで足り、原寸(886KB)を
 * 読ませずに済む。 */
const THUMB_W = 400;
const THUMB2X_W = 800;
const FULL_W = 1600;

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

  /* 引数なし: フォルダ一覧をそのまま返す。運営が付けたフォルダ名がこちらでどう
   * 解釈されているか(日付を読めているか・どの種別に入っているか)を、
   * 実際に大会を開かずに確認するため。
   * misplaced は**種別フォルダへの移動漏れ**(#72)。ここが空になっていれば移行完了。 */
  if (!eventId) {
    const { events, categories, unnamed, misplaced } = folders.items;
    return json(
      {
        parentFolderId: appConfig.photoFolderId,
        categories: categories.map((c) => ({ id: c.id, name: c.name, category: c.category })),
        misplaced, // 親フォルダ直下に残っていて写真が出ない大会フォルダ
        unnamed, // 命名規約を満たさず写真が出ないフォルダ
        folders: events.map((f) => ({
          id: f.id,
          name: f.name,
          date: f.date,
          title: f.title,
          category: f.category, // 'wolf' | 'utage' | 'other'
        })),
        stale: folders.stale,
      },
      cacheOpts(folders.stale)
    );
  }

  const ev = await plGet(`/v1/event/${eventId}`);
  if (!ev) return json({ error: 'event not found' }, { status: 404 });

  // 種別を渡して、同じシリーズのフォルダを優先して照合する(旧構成はフォールバック)
  const hit = matchFolder(folders.items.events, eventFolderKey(ev), categoryOf(ev));
  if (!hit) {
    // 大半の大会には写真フォルダが無い(= 正常)。ここでログを出すと本当の命名ミスが埋もれる
    return json({ eventId, folder: null, photos: [] }, cacheOpts(folders.stale));
  }

  const files = await loadImages(hit.id);
  return json(
    {
      eventId,
      folder: { id: hit.id, name: hit.name, match: hit.match, category: hit.category },
      photos: files.items.map(toPhoto),
      stale: folders.stale || files.stale,
    },
    cacheOpts(folders.stale || files.stale)
  );
}
