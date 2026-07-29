/* =========================================================
 * CARTA POKER SERIES - データ取得ブリッジ(フロント側シーム)
 *
 * 役割:
 *   1) BFF(/api/events)からイベント一覧 + カレンダーを取得
 *   2) app.js が読むグローバル(MOCK_EVENTS / CALENDAR)に流し込む
 *   3) 準備が整ってから app.js を注入して起動する
 *
 * 取得に失敗した場合(バックエンド未接続・オフライン等)は、
 * data.js が定義済みのモック(MOCK_EVENTS / CALENDAR)をそのまま使う。
 * これにより「API 無しでも静的サイトとして動く」状態を保つ。
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

  function boot() {
    fetchWithTimeout(API_ENDPOINT)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && Array.isArray(data.events) && data.events.length) {
          window.MOCK_EVENTS = data.events;
          if (data.calendar && Array.isArray(data.calendar.months)) {
            window.CALENDAR = data.calendar;
          }
          window.__CARTA_DATA_SOURCE__ = 'api';
          console.info('[carta] PokerLens BFF から ' + data.events.length + ' 件のイベントを取得');
        } else {
          window.__CARTA_DATA_SOURCE__ = 'mock';
          console.warn('[carta] API 応答が空/不正のためモックデータを使用');
        }
      })
      .catch(function (err) {
        window.__CARTA_DATA_SOURCE__ = 'mock';
        console.warn('[carta] /api/events 取得失敗のためモックデータを使用:', err && err.message);
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
