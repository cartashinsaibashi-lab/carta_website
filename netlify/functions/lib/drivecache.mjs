// Google Drive の読み取り結果を Netlify Blobs に置いて使い回す共有キャッシュ。
//
// 閲覧者のアクセスがそのまま Drive に飛ぶと、Drive 側のクォータを閲覧者数で消費してしまう。
// そのためフォルダ索引・ファイル一覧はここを通して読む。
// **写真(photos.mjs)とクイックリンク(site-links.mjs)は同じフォルダ索引を見る**ので、
// キャッシュを Function ごとに持たずこのモジュールに集約する
// (別々に持つと同じ Drive 呼び出しを 2 回することになる)。
//
// 入出力:
//   cached(key, load) → { items, stale, fetched }
//     stale=true は「Drive から取れず、期限切れの内容を返した」の意味。
//     呼び出し側はこれを見てキャッシュヘッダを短くし、復旧後すぐ新しい内容に戻す。
//     fetched=true は「実際に Drive を読んだ」= 警告ログを出してよいタイミング。
//   loadFolders()     → cached() の結果 + 運用ミス(命名・置き場所)の警告ログ

import { config as appConfig } from './config.mjs';
import { listFolderTree } from './drive.mjs';

/* Blobs キャッシュの有効期間。
 * 写真は大会終了後にまとめてアップされるだけで、秒単位の鮮度は要らない。
 * 一方で「掲載を取り下げたい」という依頼は Drive からファイルを消して対応する運用に
 * するため、長すぎると消えるまでの時間が延びる。その折り合いで 10 分にしている。
 * Player's Guide の PDF 差し替え(#73)が反映されるまでの時間も同じくここで決まる。 */
export const CACHE_MS = 10 * 60e3;

/* フォルダ索引のキャッシュキー。
 * **保存する形が変わったら必ず名前も変える。** #72 で配列から
 * { events, categories, unnamed, misplaced } のオブジェクトに変わったため v3 にし、
 * #73 で Player's Guide の場所(guides)が増えたため v4、
 * #82 で大会フォルダに base(番号を外した名前)が増えたため v5 にした。
 * 同じキーのままだと、デプロイ直後に前の形の値を読んで落ちる
 * (guides が無い索引を掴むとクイックリンクが出ないまま 10 分待つことになる)。 */
const FOLDERS_KEY = 'folder-index-v5';

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
 * mock ではキャッシュを挟まない(fixtures は「今」を基準に日付を組み立てるため、
 * 保存すると時間の経過でフォルダ名の日付が実際の大会とずれる)。 */
export async function cached(key, load) {
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
    console.error('[drive] 取得失敗:', err && err.message);
    if (rec) return { items: rec.items, stale: true, fetched: false };
    throw err;
  }
}

/* 種別フォルダを 1 段降りて集めた大会フォルダの索引。
 * 命名規約(先頭に YYYY-MM-DD)を満たさないフォルダは、写真が出ないまま気付かれない
 * ことになるので警告に出す。Drive を実際に見に行ったときだけログするので、
 * キャッシュが効いている間は繰り返さない。 */
export async function loadFolders() {
  const res = await cached(FOLDERS_KEY, () => listFolderTree(appConfig.photoFolderId));
  if (res.fetched) {
    if (res.items.unnamed.length) {
      console.warn(
        '[photos] 日付が読めないフォルダ名(「YYYY-MM-DD 大会名」にしてください): ' +
          res.items.unnamed.join(' / ')
      );
    }
    /* 種別フォルダの外に大会フォルダが残っていると写真が出ない。命名ミスとは
     * 直し方が違う(名前ではなく置き場所を直す)ので、別の文言で警告する。 */
    if (res.items.misplaced.length) {
      console.warn(
        '[photos] 種別フォルダ(WOLF / 宴 / 歌留多)の外にある大会フォルダ' +
          '(移動しないと写真が出ません): ' +
          res.items.misplaced.join(' / ')
      );
    }
  }
  return res;
}
