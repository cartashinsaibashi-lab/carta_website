// GET /api/site-links … フィルタ下のクイックリンク行に出す内容(#73 / #78)
//
// フロントは静的配信で Drive にも PokerLens にも触れないため、「どのボタンを出せるか」は
// サーバーが決めて渡す。`/api/events` には相乗りさせない — あちらは 30 秒キャッシュで
// 頻繁に取り直すのに対し、こちらは 10 分に 1 度でよく、キャッシュの寿命が合わないため。
//
// 返す形(データ契約):
//   {
//     wolf:  { guidePdf: <URL|null>, ranking: { name, players } | null },
//     utage: { guidePdf: <URL|null>, ranking: { name, players } | null }
//   }
//
// **null のものはフロントがボタンを出さない**(空リンクを踏ませない)。
//
// guidePdf … 種別フォルダ直下の「Play Guide」フォルダにある PDF。ファイル ID は設定に
//   持たず毎回探す。運営は PDF を差し替えるだけでよく、設定変更も再デプロイも要らない
//   (反映はキャッシュぶんの最大 10 分)。
// ranking  … 公開されているシリーズランキング。**ここでは順位表そのものは取らない** —
//   ボタンを出すかの判断に要るのは名前と登録者数だけで、数百行の順位表は
//   パネルを開いたとき(/api/ranking/:category)に取ればよいため。
//
// 2 つは別々の外部サービスに依存するので、**片方が落ちてももう片方は出す**。

import { config as appConfig } from './lib/config.mjs';
import { listPdfs, guideUrl, DriveError } from './lib/drive.mjs';
import { cached, loadFolders } from './lib/drivecache.mjs';
import { findRanking } from './lib/ranking.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: '/api/site-links' };

/* クイックリンク行を出す種別。歌留多(other)は Player's Guide を作らない運用で、
 * シリーズランキングも無いため行ごと出さない(#73)。 */
const LINK_CATEGORIES = ['wolf', 'utage'];

// 写真と同じ 10 分。Drive / ランキングの更新が反映されるまでの上限もこの値になる
const CACHE_SECONDS = 600;

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

/* 種別 → Player's Guide の URL。Drive 側の障害・設定漏れでは例外にせず全部 null にする
 * (ボタンが出ないだけで、ランキングと大会一覧は今までどおり出したい)。 */
async function guideLinks() {
  const out = {};
  for (const cat of LINK_CATEGORIES) out[cat] = null;
  if (!appConfig.photosEnabled) return out;

  try {
    const folders = await loadFolders();
    const guides = (folders.items.guides || []).filter(
      (g) => LINK_CATEGORIES.indexOf(g.category) !== -1
    );
    // 種別ごとに 1 往復。多くて 2 件なので直列にせず並べて待つ
    const found = await Promise.all(guides.map((g) => guidePdfFor(g)));
    guides.forEach((g, i) => {
      out[g.category] = found[i];
    });
  } catch (err) {
    if (!(err instanceof DriveError)) throw err;
    console.error('[site-links] Player\'s Guide を取得できませんでした:', err.message);
  }
  return out;
}

/* 種別 → ランキング(名前と登録者数だけ)。
 * 登録者が 0 名のランキングはボタンを出さない — 開いても空の表しか出ないため。 */
async function rankingLinks() {
  const out = {};
  const found = await Promise.all(LINK_CATEGORIES.map((cat) => findRanking(cat).catch(() => null)));
  LINK_CATEGORIES.forEach((cat, i) => {
    const rk = found[i];
    out[cat] = rk && rk.players > 0 ? { name: rk.name, players: rk.players } : null;
  });
  return out;
}

export default async () =>
  handle(async () => {
    const [guides, rankings] = await Promise.all([guideLinks(), rankingLinks()]);

    const links = {};
    for (const cat of LINK_CATEGORIES) {
      links[cat] = { guidePdf: guides[cat], ranking: rankings[cat] };
    }
    return json(links, { cacheSeconds: CACHE_SECONDS });
  });
