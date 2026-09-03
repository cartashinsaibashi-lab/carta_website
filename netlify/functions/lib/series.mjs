// 「種別|開催日 → シリーズ(リーグ)名」の対応表。写真まとめの帯の見出しに使う。
//
// **写真まとめ(photos.mjs)と prewarm の両方から使うのでモジュールに切り出してある。**
// prewarm が先に作って Blobs に置き、閲覧者のリクエストは読むだけにするため
// (理由は seriesMap() のコメント)。
//
// 入出力:
//   seriesMap(maxAgeMs?) → Map<'wolf|2026-05-27', 'WOLF SERIES of POKER 2026 #02'>

import { plPost } from './pokerlens.mjs';
import { categoryOf } from './adapter.mjs';
import { cached } from './drivecache.mjs';

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

/* シリーズ名の対応表を Blobs にも置く(#114)。
 * seriesByDate() は /v1/event/search を 500 件ずつ全ページ舐めるため実測 7.6 秒かかり、
 * /api/photos のオリジン応答(実測 9.7〜13.9 秒)の大半を占めていた。Netlify の同期関数の
 * 上限(既定 10 秒)に触れうるうえ、prewarm がタイムアウトすると CDN も温まらず、
 * 次の閲覧者がその待ち時間をそのまま受ける。
 * 中身は「種別|開催日 → リーグ名」の対応表で、シリーズが増えるまで変わらないので、
 * Drive 索引と同じ Blobs キャッシュに乗せる(作り直しは prewarm が担う)。
 * Map はそのまま JSON にできないので配列(エントリの列)にして保存する。 */
const SERIES_KEY = 'series-by-date-v1';

export async function seriesMap(maxAgeMs) {
  const res = await cached(SERIES_KEY, async () => [...(await seriesByDate())], maxAgeMs);
  return new Map(res.items);
}


