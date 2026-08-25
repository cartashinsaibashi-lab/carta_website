// GET /api/site-links … フィルタ下のクイックリンク行に出す URL(#73)
//
// フロントは静的配信で Drive の中身を知らないため、リンク先はサーバーから渡す。
// `/api/events` には相乗りさせない — あちらは 30 秒キャッシュで頻繁に取り直すのに対し、
// こちらは 10 分に 1 度でよく、キャッシュの寿命が合わないため。
//
// 返す形(データ契約):
//   { wolf: { guidePdf: <URL|null> }, utage: { guidePdf: null } }
//
// **guidePdf が null のときフロントはボタンを出さない**(空リンクを踏ませない)。
// PDF のファイル ID は設定に持たず、種別フォルダ直下の「Play Guide」フォルダを
// その都度見に行く。運営は PDF を差し替えるだけでよく、設定変更も再デプロイも要らない
// (反映はキャッシュぶんの最大 10 分)。

import { config as appConfig } from './lib/config.mjs';
import { listPdfs, guideUrl, DriveError } from './lib/drive.mjs';
import { cached, loadFolders } from './lib/drivecache.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: '/api/site-links' };

/* クイックリンク行を出す種別。歌留多(other)は運営が Player's Guide を作らない運用で、
 * 行ごと出さない(#73)。ここに載っていない種別は Drive に Guide があっても返さない。 */
const LINK_CATEGORIES = ['wolf', 'utage'];

// 写真と同じ 10 分。Drive の更新が反映されるまでの上限もこの値になる
const CACHE_SECONDS = 600;

function emptyLinks() {
  const out = {};
  for (const cat of LINK_CATEGORIES) out[cat] = { guidePdf: null };
  return out;
}

/* Player's Guide フォルダの中から出す PDF を 1 つ選ぶ。
 * 複数入っているときは更新日が最新のものを使い、取り違えに気付けるようログに残す
 * (運営が古い版を消し忘れているケースを想定)。 */
async function guidePdfFor(guide) {
  const res = await cached('guide:' + guide.id, () => listPdfs(guide.id));
  const pdfs = res.items || [];
  if (!pdfs.length) return null;
  if (pdfs.length > 1 && res.fetched) {
    console.warn(
      `[site-links] ${guide.category} の ${guide.name} に PDF が ${pdfs.length} 件あります。` +
        `更新日が最新の「${pdfs[0].name}」を使います: ` +
        pdfs.map((f) => f.name).join(' / ')
    );
  }
  return guideUrl(pdfs[0].id);
}

export default async () =>
  handle(async () => {
    // 環境変数が未設定でもエラーにしない(ボタンが出ないだけでサイトは成立する)
    if (!appConfig.photosEnabled) return json(emptyLinks(), { cacheSeconds: 300 });

    try {
      const folders = await loadFolders();
      const guides = (folders.items.guides || []).filter(
        (g) => LINK_CATEGORIES.indexOf(g.category) !== -1
      );

      const links = emptyLinks();
      // 種別ごとに 1 往復。3 種別なので直列にせず並べて待つ(待ち時間を積み上げない)
      const found = await Promise.all(guides.map((g) => guidePdfFor(g)));
      guides.forEach((g, i) => {
        links[g.category] = { guidePdf: found[i] };
      });

      // stale(前回のキャッシュで凌いでいる)ときは短くして、復旧後すぐ切り替わるようにする
      return json(links, folders.stale ? { cacheSeconds: 60 } : { cacheSeconds: CACHE_SECONDS });
    } catch (err) {
      /* Drive 側の障害で前回のキャッシュも無い場合。5xx にはせず「リンク無し」として返す。
       * クイックリンクが出ないだけで、大会一覧の表示には影響させない。 */
      if (err instanceof DriveError) {
        console.error('[site-links] リンクを取得できませんでした:', err.message);
        return json(emptyLinks(), { cacheSeconds: 60 });
      }
      throw err;
    }
  });
