// GET /api/photos/:eventId        … その大会の写真一覧(Google Drive から)
// GET /api/photos                 … 種別フォルダ配下の大会フォルダ一覧
//                                   (運用確認用 + 写真まとめ画面の一覧 #74)
// GET /api/photos/folder/:folderId … フォルダ ID を直接指定して写真一覧(#74)
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

import { plGet, plPost } from './lib/pokerlens.mjs';
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

/* :eventId と folder/:folderId はセグメント数が違うので取り違えは起きない
 * (/api/photos/folder/xxx は 3 セグメントで :eventId には当たらない)。 */
export const config = {
  path: ['/api/photos', '/api/photos/:eventId', '/api/photos/folder/:folderId'],
};

/* 表示に使う幅。実測(2026-08-13)の転送量は w400=49KB / w1200=294KB / w2000=608KB。
 * サムネイルはグリッド 1 枚あたり 200px 前後で出すので w400 が等倍、w800 が 2x。
 * 拡大表示は w1600 — スマホからノート PC の全画面までこれで足り、原寸(886KB)を
 * 読ませずに済む。 */
const THUMB_W = 400;
const THUMB2X_W = 800;
const FULL_W = 1600;

/* フォルダ名の先頭の番号を分解する(#4 → {kind:'', no:4} / #SP2 → {kind:'SP', no:2})。
 * 写真まとめの並び替えに使う。番号が読めないフォルダは末尾に回す。 */
function folderNumber(title) {
  const m = /^#([A-Za-z]*)(\d+)/.exec(String(title || '').trim());
  return m ? { kind: (m[1] || '').toUpperCase(), no: Number(m[2]) } : null;
}

/* 「種別 + 開催日 → シリーズ名」の対応表。写真まとめをシリーズ単位で並べるために使う。
 *
 * シリーズ名は大会の `behaviour.league.name`(「WOLF SERIES of POKER 2026 #02」
 * 「宴 2026/07」)。フォルダ側は名前と日付しか持たないので、大会一覧から引く。
 * **1 つのシリーズは連続した日程を占め、同じ日・同じ種別に別シリーズは無い**
 * (実データ: WOLF #02 = 5/27〜5/31 / 宴 2026/07 = 7/30〜8/02 / WOLF #03 = 9/22)。
 * そのため日付と種別だけで引ける。同じ日に複数のリーグが混ざっていたら、
 * 大会数が多いほうを採る(判断を止めない)。
 *
 * 取得に失敗しても写真は出す — シリーズ名が付かず、フロントが日付で並べるだけになる。 */
async function seriesByDate() {
  const map = new Map(); // 'wolf|2026-05-27' → { 名前: 件数 }
  let page = 1;
  for (; page <= 6; page++) {
    const res = await plPost('/v1/event/search', {
      text: '',
      includeSummary: false,
      includeFlights: true,
      orderBy: 'date',
      pageIndex: page,
      pageSize: 500,
    });
    const rows = (res && res.results) || [];
    for (const ev of rows) {
      const name = (ev.behaviour && ev.behaviour.league && ev.behaviour.league.name) || '';
      if (!name) continue;
      const date = String((ev.dailyDetails && ev.dailyDetails.startDate) || '').slice(0, 10);
      if (!date) continue;
      const key = categoryOf(ev) + '|' + date;
      const tally = map.get(key) || {};
      tally[name] = (tally[name] || 0) + 1;
      map.set(key, tally);
    }
    if (rows.length < 500) break;
  }
  const out = new Map();
  for (const [key, tally] of map) {
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (best) out.set(key, best[0]);
  }
  return out;
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
    const { eventId, folderId } = context.params;

    // 環境変数が未設定でもエラーにしない(写真が無いだけでサイトは成立する)
    if (!appConfig.photosEnabled) {
      return json({ eventId: eventId || null, folder: null, photos: [] }, { cacheSeconds: 300 });
    }

    try {
      return folderId ? await respondFolder(folderId) : await respond(eventId);
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
   * misplaced は**置き場所の間違い**(#72 / #114)。親フォルダ直下に残っているものと、
   * WOLF / 宴 の種別フォルダ直下(シリーズフォルダへの移し忘れ)の両方が入る。
   * ここが空になっていれば移行完了。 */
  if (!eventId) {
    const { events, categories, unnamed, misplaced } = folders.items;
    /* シリーズ名は写真まとめの見出しに使う。取れなくても写真は出す(名前が付かないだけ)。 */
    let series = new Map();
    try {
      series = await seriesByDate();
    } catch (err) {
      console.warn('[photos] シリーズ名を取得できませんでした:', err.message);
    }
    return json(
      {
        parentFolderId: appConfig.photoFolderId,
        categories: categories.map((c) => ({ id: c.id, name: c.name, category: c.category })),
        misplaced, // 置き場所が違って写真が出ない大会フォルダ(親フォルダ直下 / シリーズの外)
        unnamed, // 命名規約を満たさず写真が出ないフォルダ
        folders: events.map((f) => {
          const num = folderNumber(f.title);
          return {
            id: f.id,
            name: f.name,
            date: f.date,
            title: f.title,
            category: f.category, // 'wolf' | 'utage' | 'other'
            series: series.get(f.category + '|' + f.date) || '', // 例「WOLF SERIES of POKER 2026 #02」
            // 番号(#SP2 のような種別つきも分解して返す)。読めなければ null
            no: num ? num.no : null,
            noKind: num ? num.kind : '',
            /* 表紙(#102)。索引が持っている 1 枚目から URL を組む。
             * 読めなかったフォルダは null で、フロントは写真の無いタイルにする。 */
            cover: f.cover
              ? { url: photoSrc(f.cover, THUMB_W), url2x: photoSrc(f.cover, THUMB2X_W) }
              : null,
          };
        }),
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

/* フォルダ ID を直接指定して写真を返す(#74)。
 * 写真まとめ画面はフォルダ一覧から辿るため、大会 ID を経由できない
 * (フォルダに対応する大会が一覧に無いこともある)。
 *
 * **索引に載っているフォルダしか受け付けない。** ID をそのまま Drive に投げると、
 * このエンドポイントが「公開フォルダなら何でも一覧できる代理サーバー」になってしまう。
 * 索引 = 親フォルダ配下の大会フォルダなので、突き合わせるだけで範囲を閉じられる。
 *
 * 知らない ID には **404 ではなく「写真 0 枚」を返す**。同じ Function に複数のパスを
 * 持たせていると、404 を返した時点で Netlify が次に一致するパスへ配送し直すため
 * (実測: /api/photos/folder/<未知の ID> が /api/photos のフォルダ一覧を返した)。
 * 404 は呼び出し側に届かず、まったく別の応答に化ける。上の :eventId も同じ癖を持つ。
 * フロントは folder が null なら一覧へ戻す。 */
async function respondFolder(folderId) {
  const folders = await loadFolders();
  const hit = folders.items.events.find((f) => f.id === folderId);
  if (!hit) return json({ folder: null, photos: [] }, cacheOpts(folders.stale));

  const files = await loadImages(hit.id);
  return json(
    {
      folder: { id: hit.id, name: hit.name, date: hit.date, title: hit.title, category: hit.category },
      photos: files.items.map(toPhoto),
      stale: folders.stale || files.stale,
    },
    cacheOpts(folders.stale || files.stale)
  );
}
