// GET /api/events
// PokerLens の event/search を叩き、app.js 契約の一覧 + CALENDAR を返す。
// 取得範囲 = 「今日の historyDays 日前」以降(今後の予定は全部含む)。
// これにより Wolf / 宴 / Other すべてのタブに内容が入る(過去の WOLF SERIES 等も表示)。
// structure/results はカード展開時に /api/events/:id で遅延取得。

import { plPost } from './lib/pokerlens.mjs';
import { config as appConfig } from './lib/config.mjs';
import { toListEvent, buildCalendar, markMultiDay } from './lib/adapter.mjs';
import { json, handle } from './lib/http.mjs';

export const config = { path: '/api/events' };

// JST で「今日から days 日前」の YYYY-MM-DD
function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export default async () =>
  handle(async () => {
    const days = Number.isFinite(appConfig.historyDays) ? appConfig.historyDays : 120;
    const startDate = days > 0 ? isoDaysAgo(days) : undefined;

    // 期間内をなるべく少ない往復で取得(pageSize を大きめにして通常1回で完了)。
    // pageIndex は 1 始まり。安全のため最大 6 ページ(=3000件)を上限に。
    const PAGE = 500;
    const results = [];
    for (let pi = 1; pi <= 6; pi++) {
      const page = await plPost('/v1/event/search', {
        text: '',
        startDate,
        includeSummary: false,
        includeFlights: true,
        orderBy: 'date',
        pageIndex: pi,
        pageSize: PAGE,
        gameTypeCategories: null,
        gameTypeLimits: null,
      });
      const rows = (page && page.results) || [];
      results.push(...rows);
      if (rows.length < PAGE) break;
    }

    const events = markMultiDay(results.map((ev) => toListEvent(ev)));
    const calendar = buildCalendar(events);
    // CDN 耐久キャッシュ: 30秒は新鮮、以降10分は stale を返しつつ裏で更新(2人目以降は即時)
    return json({ events, calendar }, { cacheSeconds: 30, swrSeconds: 600 });
  });
