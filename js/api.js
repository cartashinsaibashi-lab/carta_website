/* =========================================================
 * CARTA POKER SERIES - データ取得ブリッジ(フロント側シーム)
 *
 * 役割:
 *   1) BFF(/api/events)からイベント一覧 + カレンダーを取得
 *   2) app.js が読むグローバル(MOCK_EVENTS / CALENDAR)に流し込む
 *   3) 準備が整ってから app.js を注入して起動する
 *
 * 取得に失敗した場合(バックエンド未接続・オフライン等)は、
 * ダミーデータは一切表示せず、空(0 件)+ エラーメッセージにフォールバックする。
 *   __CARTA_DATA_SOURCE__ = 'api' | 'empty' | 'error'
 * ========================================================= */
(function () {
  'use strict';

  var API_ENDPOINT = '/api/events';
  var TIMEOUT_MS = 8000;

  function injectApp() {
    var s = document.createElement('script');
    s.src = 'js/app.js';
    s.async = false;
    document.body.appendChild(s);
  }

  function fetchWithTimeout(url) {
    // AbortController でタイムアウト(遅い/無応答なバックエンドでフォールバックへ)
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
      .finally(function () { clearTimeout(timer); });
  }

  // JST の「今日」(視聴者の TZ に依存しない)
  function jstToday() {
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      });
      var p = {};
      fmt.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { year: +p.year, month: +p.month, day: +p.day };
    } catch (e) {
      var d = new Date();
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }
  }

  // app.js が起動時に必要とする最小限の空カレンダー(当月のみ)
  function emptyCalendar() {
    var t = jstToday();
    return { months: [{ year: t.year, month: t.month }], today: t };
  }

  function validCalendar(cal) {
    return cal && Array.isArray(cal.months) && cal.today ? cal : emptyCalendar();
  }

  function boot() {
    fetchWithTimeout(API_ENDPOINT)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && Array.isArray(data.events) && data.events.length) {
          window.MOCK_EVENTS = data.events;
          window.CALENDAR = validCalendar(data.calendar);
          window.__CARTA_DATA_SOURCE__ = 'api';
        } else {
          // 正常応答だがイベント 0 件 → 空表示(ダミーは出さない)
          window.MOCK_EVENTS = [];
          window.CALENDAR = validCalendar(data && data.calendar);
          window.__CARTA_DATA_SOURCE__ = 'empty';
        }
      })
      .catch(function (err) {
        // 取得失敗 → 空 + エラー表示(ダミーは出さない)
        window.MOCK_EVENTS = [];
        window.CALENDAR = emptyCalendar();
        window.__CARTA_DATA_SOURCE__ = 'error';
        console.warn('[carta] /api/events 取得失敗:', err && err.message);
      })
      .finally(injectApp);
  }

  // スクリプトは </body> 直前に置かれるため DOM は既に存在する。
  // 念のため readyState を見てから起動する。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
