# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 作業ルール(必ず守る)

リポジトリ: `cartashinsaibashi-lab/carta_website`(`gh` CLI 利用可)。

### 1. GitHub issue 番号で作業ブランチを作る

作業は必ず対応する issue を起点にする。`main` に直接コミットしない。

```bash
gh issue view <番号>                      # 着手前に内容を確認する
git switch main && git pull
git switch -c feature/<番号>-<短い英語の要約>   # 例: feature/42-live-seat-sync
```

- ブランチ名は既存の `feature/*` 形式を踏襲し、先頭に issue 番号を入れる(例 `feature/42-...`)。
  バグ修正は `fix/<番号>-...` でもよい。
- 対応する issue が無い依頼を受けたら、**先に issue を作るかどうかをユーザーに確認する**。
  勝手に issue を作らない。
- コミットメッセージは日本語 + `feat(scope): …` / `fix(card): …` 形式(既存の履歴に合わせる)。

### 2. PR は作成する。マージは絶対にユーザーが行う

```bash
git push -u origin feature/<番号>-<要約>
gh pr create --base main --title "..." --body "... Closes #<番号>"
```

- PR 本文には **何を・なぜ変えたか**と、動作確認した手順(`netlify dev` で確認した画面・叩いた
  エンドポイント等)を書く。関連 issue は `Closes #<番号>` で紐付ける。
- **`gh pr merge` / `git merge` / `main` への push は、Claude は絶対に実行しない。**
  マージ・リリースの判断とマージ操作はユーザーが行う。PR を作ったら URL を報告して止まる。
- レビュー指摘への修正はブランチに追加コミットして push する(PR は作り直さない)。

## Commands

```bash
npm run dev      # netlify dev — 静的サイト + /api/* を http://localhost:8888 で同一オリジン配信
npm run check    # node --check for events.mjs / event.mjs のみ(lib/*.mjs は対象外)
curl localhost:8888/api/events
curl localhost:8888/api/events/<id>
```

テストランナー・リンター・ビルドステップは無い。フロントは素の HTML/CSS/JS をそのまま配信し、
Functions は `.mjs`(ESM)を esbuild がバンドルする。依存は `@netlify/blobs` のみ。

`POKERLENS_MODE=mock`(既定)なら認証情報なしで fixtures から動く。`live` は `.env` に
`POKERLENS_MODE=live` と `POKERLENS_API_KEY=<carta_api_key>` が要る。

## アーキテクチャ

静的フロント + **Netlify Functions を BFF** として挟み、PokerLens API に接続する。
PokerLens は公開系エンドポイントも含めて全て認証必須で、秘密鍵をブラウザに置けないため
サーバー層が必須(詳細は `docs/architecture.md`)。

```
browser (index.html)
  └ js/api.js   … GET /api/events → window.MOCK_EVENTS / window.CALENDAR を用意 → app.js を注入
      └ js/app.js … 描画・状態管理(API を直接は知らない)
          └ fetch /api/events/:id … カード展開時に詳細をマージ
                 ↓ 同一オリジン
netlify/functions/
  events.mjs  GET /api/events           → POST /v1/event/search(ページング、historyDays 以降)
  event.mjs   GET /api/events/:id       → event + levels + players + payouts を並列取得
              GET /api/events/:id/:part → levels|structure|players|payouts の個別取得
  photos.mjs  GET /api/photos/:id        → Google Drive から大会写真(下記)
              GET /api/photos            → 種別フォルダ配下の大会フォルダ一覧
              GET /api/photos/folder/:id → フォルダ指定で写真一覧(写真まとめ画面 #74)
  site-links.mjs GET /api/site-links     → クイックリンク行の中身(Player's Guide / ランキング)
  ranking.mjs GET /api/ranking/:category → シリーズ通算の順位表(下記)
  prewarm.mjs cron */10 — トークンとランキングポイント索引を温め、/api/events の CDN キャッシュを更新
  lib/pokerlens.mjs 認証 + トークンキャッシュ + 401 リトライ + mock/live の分岐
  lib/adapter.mjs   VenueEvent → フロントのデータ契約(唯一の変換層)
  lib/config.mjs    環境変数の集約(他のモジュールは process.env を直接読まない)
  lib/drive.mjs     Drive API v3 + フォルダ名 → 大会の照合(正規化)
  lib/drivecache.mjs Drive 読み取りの Blobs キャッシュ(photos と site-links で共有)
  lib/ranking.mjs   ランキングの索引(下記)+ 種別 → ランキングの対応づけ / 順位表
  lib/fixtures.mjs  mock モードの VenueEvent/EventLevel/EventPlayer サンプル
  lib/http.mjs      json() / handle()
```

**ルーティングは各 Function の `export const config = { path: ... }`(Functions v2)で定義**。
`netlify.toml` にリダイレクトは書かない。

### フロントの契約(重要なシーム)

`app.js` はグローバル `MOCK_EVENTS`(配列)と `CALENDAR`(`{months, today}`)だけを読む。
`api.js` がそれを組み立て、`window.__CARTA_DATA_SOURCE__ = 'api' | 'empty' | 'error'` を立てる。
取得失敗時は**ダミーデータを出さず空 + エラーメッセージ**(かつて存在した `js/data.js` フォールバックは削除済み。
`docs/architecture.md` の記述はこの点だけ古い)。

`__CARTA_DATA_SOURCE__ !== 'api'` のときは詳細の遅延ロード・ライブポーリングを一切行わない。

イベントの形状は `lib/adapter.mjs` 冒頭のコメントが正。**金額・チップは生の数値**で BFF から渡し、
整形は `app.js` の `yen()` / `num()` が行う。

### mock / live

`plGet` / `plPost` が `config.isMock` を見て `fixtures.mockRequest` か実 API に振り分ける。
adapter は同じスキーマの入力を受けるので、mock で変換を検証すれば live でもそのまま動く。
未対応パスの mock は `null` を返す(エラーにしない)。

## 押さえておくべき癖

**認証**: `POST /v1/security/authenticate` にキーを渡してトークンを得て、以降は
`access_token` ヘッダに**生値**で付ける。`Authorization: Bearer` でも OAuth2 の
`/connect/token` でもない。`.env.example` は OAuth2 client_credentials 時代の記述が残っていて誤り。
**正は `docs/getting-credentials.md`**。アクセス範囲は `clientSecretID`(= API キー)で決まり、
`clientID` は任意文字列でよい。

**トークンキャッシュは 2 段**: モジュールスコープのメモリ → Netlify Blobs(`pokerlens` store /
`session-token`)。Blobs が使えない環境では静かに null になりメモリのみで動く。401 を受けたら
`getToken({force:true})` で 1 回だけリトライ。

**時刻は JST の wall-clock として扱い、タイムゾーン変換をしない**。会場ローカル時刻をそのまま出す。
カウントダウンだけは視聴者の TZ に依存しないよう、adapter の `jstInstant()` が `+09:00` を付けた
絶対時刻(`startAt` / `regCloseAt`)を渡す。ライブのレベルタイマーも同様に `endsAt`(絶対時刻 ms)を
渡し、クライアントが毎秒 `endsAt - now` で再計算する — `elapsedSeconds` をそのまま表示すると
CDN キャッシュの古さ分だけタイマーがずれる。

**一覧は浅く、詳細は遅延**。`/api/events` は structure/results/payouts を空で返す(`app.js` が
描画時に参照するので、未定義ではなく必ず空配列を入れる)。カード展開時に `/api/events/:id` を取得して
`ev` にマージし、`ev._detail = 'loaded'` を立てる。表示中の先頭 12 件は背景で先読みする。

**`render()` は一覧を innerHTML で丸ごと作り直す**。そのため再描画をまたいで保持したい選択は
`state.openedTab` / `state.seatTable` に持たせてある(ここを忘れると詳細ロード後にタブが Info に戻る)。
再描画のたびに `clearTimers()` → `startTimers()` でカウントダウンを貼り直す。
座席表の卓タブはライブ更新でパネルごと差し替わるため、カードではなく `listEl` に委譲リスナーを置く。

**ライブポーリングは 25 秒**、進行中カードを開いている間だけ。タブ非表示中はスキップ。
レベルタイマーが 0 になった瞬間も即時再取得する。

**タイマーが 0 になったら、取得を待たずに手元のストラクチャーで次の項目へ繰り上げる**
(`app.js` の `projectedStep()` / `liveView()`)。取得を待つと 00:00 のまま止まって見えるため。
実測(2026-08-17 の本番)で **レベル間 9〜27 秒 / 休憩に入るとき 22 秒**止まっていた。内訳は
`/api/events/:id` の CDN キャッシュ(最大 10 秒)と PokerLens 側の反映待ちで、どちらも取得側では
縮められない。繰り上げの基準は `live.stepIndex`(adapter が `structure[]` 上の位置を渡す)。
**一度繰り上げたら `ev._rollover` に予定を固定する** — サーバーが前の項目を返し続けている間、
`endsAt` は取得のたびに「今」へずれる(残り 0 だと `endsAt = status.date = 応答時刻`)ので、
毎回計算し直すとカウントダウンが数秒巻き戻る。

**会場の時計はレベル内では完全に連続、境界でだけ数秒止まる。** 実測(同上):
同一レベル内で `endsAt` を 64 秒ポーリングしてもぶれ幅 **0 ms**。一方 Lv5 → Lv6 の境界では
`endsAt(Lv6) - endsAt(Lv5)` が **1,206,210 ms**(レベル長 20 分 = 1,200,000 ms に対して **+6.2 秒**)。
つまり会場が次のレベルを開始するまで 6 秒ほど時計が止まっている。
そのため実データが届いた瞬間、繰り上げ表示から **数秒巻き戻る**。
**この誤差は累積しない** — 毎回サーバーの最新 `endsAt` を基準に取り直すため、
1 回あたり数秒で頭打ちになる(会場の進行そのものは 15 レベルで 1〜2 分遅れていくが、それは実態)。

**キャッシュヘッダは `lib/http.mjs` の `json()` で付ける**。ブラウザ向け `Cache-Control` と
Netlify CDN 向け `Netlify-CDN-Cache-Control`(stale-while-revalidate)の両方。running は 10 秒、
それ以外は 120 秒、一覧は 30 秒 + SWR 600 秒。

**wolf / utage / other の分類**は `behaviour.league.name` の部分一致(`POKERLENS_CATEGORY_WOLF` /
`_UTAGE`、既定 `wolf,ウルフ` / `utage,宴`)。API に分類フィールドは無い。

**説明文は `dailyDetails.levelDescription`**(管理画面の Description)。`dailyDetails.description` は
Announcement タブの運用メモ(`Unlimited` / `Level 8 / 18:30` 等)なので表示に使わない。

**Buy-in 表示は `subscription.buyin.fee` のみ**(カード・Info タブとも本体/合計は出さない)。

**日をまたぐ大会の「通過日」は Prize を出してはいけない**。Day 1A などのレコードに紐づく
`payout` は**大会全体の最終成績の賞金**で、その日の成績ではない。実データ
(`#3 (1A) MAIN EVENT DAY 1A` / 2026-05-27)では 1 位 ¥60,000・3 位 ¥600,000 と、
その日の順位(通過スタック順)と噛み合わない値が入っていた(payout の日付も最終日の 5/31)。
代わりに翌日へ持ち込むチップ(`EventPlayer.chipsCount`)を出す(#44)。タブ名は **Survivors**、
サマリーは In the Money ではなく **Remaining(翌日へ進む人数)**。**Prize タブ自体は出す** —
出さないのは Results の賞金であって、ペイアウト表は通過日にも見たい(運営の指定)。

**通過日かどうかの判定は `summaryId` でグループ化し `dailyDetails.day` の最大値と比べる**(#54)。
`summaryId` は同じ大会の全日程が共有する親レコードのキーで、946 件中 70 件
(= `behaviour.isFlight` が true の日別レコード)にだけ入る。詳細では
`GET /v1/event/{id}/flights` で全日程を取って判定し、一覧では出そろっている日別レコードから
`markMultiDay()` が決める。以前は「`results` に `chips > 0` の人が居るか」で見ていたが、
**まだ結果が入っていない大会を判別できない**(未開催のグループは全員 0)ため置き換えた。
flights が取れないときのフォールバックとしてチップ判定は残してある。

**Survivors に出す人の絞り込みは `busted`**。実データ 70 レコード中 69 件は `chipsCount > 0` と
一致するが、`2026-04-24 #1 MAIN EVENT DAY 1B` だけ `busted=false` が 5 名・`chips>0` が 6 名で
食い違う(`stats.totalPlayers` は 5)。API の生存者定義に合わせる。

**詳細でだけ返る項目のマージ箇所は 2 つある** — `maybeLoadDetail()` の中と `applyDetail()`。
片方だけ足すとカードを開いたときには反映されずライブ更新時だけ効く(実際に踏んだ)。
`points` / `carryOver` のように **false や 0 が意味を持つ値は `'key' in d` で判定する**
(truthy 判定だと取りこぼす)。

**ストラクチャーの `type` は実データでは数値**(1=レベル, 2=休憩)。文字列 `'break'` と両対応にしてある。
配列の並び順が進行順で、先頭(受付前)の休憩は表示しない。

**現在位置は `status.level.id` で引く。`index` では引けない。** `EventLevel.index` は
**レベル行だけの通し番号**で、**休憩行は 0** で返る。休憩中は `status.levelIndex` も
`status.level.index` も 0 になるため、index で引くと「該当なし」になり、そこから導く値
(ブラインド・次のレベル・次の休憩)が全部ずれる(#38 で実際に起きた)。
`id` は休憩も含めた全行の通し番号で休憩行にも一意に振られており、行を指せる唯一のキー。
`buildLive()` は id で引き、id を返さない応答向けに index 引きのフォールバックを残してある。
**mock の `makeLevels()` もこの形(先頭に受付前休憩 / 休憩は `index: 0` / `type` は数値)に
揃えてある。崩すと mock で通っても live で壊れる。**

**ランキングポイントは逆引きできない**。`/v1/ranking/{id}/points` のレコードが持つ
`reference.id` は **VenueEvent の id ではない**(`/v1/event/{reference.id}` は 404)。実イベントへの変換は
`GET /v1/ranking/{id}/event-by-reference/{reference.id}` だけで、**逆向き(イベント → 参照)は 404**。
そのためランキング側から全件舐めて索引を作るしかない(`lib/ranking.mjs`)。実測で 6〜7 秒かかるので
**リクエストの経路では作らず prewarm(10 分ごと)に作らせ、`/api/events/:id` は Blobs を読むだけ**にしてある。
索引が無い間はポイントが出ないだけ。ポイントは整数とは限らない(46.8 / 83.2 など)。
Day 1A/1B のフライトではなく `flight` が空の親イベントに紐づく。
なお `/v1/ranking/{id}/players` の `position` は `{index, points, events}` のオブジェクトで、
`orderBy: 'points'` は**最下位から**返る(順位順に出したいときも `orderBy: 'position'` を使う)。

**大会写真は PokerLens に無い**(告知用の 1 枚だけで、実データでは過去 921 大会すべて空)。
Google Drive の親フォルダを「リンクを知っている全員が閲覧可」で共有してもらい、その直下の
**`YYYY-MM-DD 大会名`** というフォルダ名で大会と突き合わせる(`lib/drive.mjs`)。日付が必須なのは
大会名だけでは 77% が同名で特定できないため。**チルダは Drive(U+301C)/ PokerLens(U+FF5E)/
Google フォト(U+007E)で全部違い、NFKC は U+301C を変換しない** ので `normalizeTitle()` で
明示的に統一している。画像は `lh3.googleusercontent.com/d/<fileId>=w<幅>` をブラウザが直接読む
(BFF を通らないので転送量がかからない)。取得できないときは空配列を返し、写真タブが出ないだけにする。
**大会の状態では絞らない**(開催予定・開催中・終了のどれでも取りに行く)。以前は「開催予定の大会は
写真がありえない」として future を除外していたが、告知画像を先に載せる運用があり前提が誤りだった(#48)。
取得はカードを開いたときだけで、一覧の先読みには混ぜない。

**クイックリンク行(フィルタの下)は Wolf / 宴のみ**。Player's Guide(Drive の `PlayGuide`
フォルダにある最新 PDF)・Ranking・Photos の 3 つで、**データが用意できていないボタンは出さない**
(空リンクを踏ませないため)。中身は `/api/site-links` が返す。Ranking と Photos は
**大会一覧を差し替えるインラインパネル**で、別ページは作らない。URL は `?ranking=<種別>` /
`?photos=<フォルダID|種別>`。パネルを開いたまま種別を切り替えるとその種別の内容に差し替わり、
出せるものが無い種別(歌留多)では閉じて一覧に戻る。

**種別 → シリーズランキングは名前の部分一致で決めてはいけない**。実データのランキングは 3 件で、
「宴」で引くと**中身が空の旧版(宴POS ver2 / 登録 0 名)も当たる**。既定は「登録者 0 名を除き、
開催期間が最も新しいもの」を選ぶ。`WOLF 2026 #02` のように名前にシリーズ番号が入り、
シリーズが増えるたびにランキングも増えるため、ID を焼き込むと更新漏れになる
(`POKERLENS_RANKING_WOLF` / `_UTAGE` で明示指定はできる)。順位表は
`POST /v1/ranking/{id}/players` の 1 往復で、**`orderBy` は `'position'`**
(`'points'` は最下位から返る)。`position` は `{index, points, events}` のオブジェクト。
表示名は nickname 優先で、空なら `player.description` のイニシャル表記(`Y. Y.`)。
live の登録率は Wolf 218/218・宴 461/480。

**同じ Function に複数のパスを持たせている場合、404 を返すと Netlify が次に一致するパスへ
配送し直す**。実測で `/api/photos/folder/<未知の ID>` が `/api/photos` のフォルダ一覧を返した。
404 は呼び出し側に届かず別の応答に化けるので、この種のエンドポイントでは
「空の結果を 200 で返す」に寄せる。

## コード規約

- `js/*.js` は ES5 スタイルの IIFE(`var` / `function`)、フレームワーク無し、テンプレートリテラルも使わず
  文字列連結で HTML を組む。ユーザー入力を差し込む箇所は必ず `esc()` を通す。
- `netlify/functions/**` は ESM(`.mjs`)、Node 18+ の native fetch。
- コメント・コミットメッセージは日本語(後述の「コメントの書き方」を必ず守る)。
- CSS は `css/style.css` 1 枚。先頭にテーマ変数(wolf / utage / other)、以降はセクションコメントで区切る。
  テーマは `body[data-theme]` で切り替わる。

## コメントの書き方(必須)

コメントは**コードを読んだだけでは分からないこと**を日本語で書く。読み手は数ヶ月後の人間で、
PokerLens API の癖も過去の不具合も覚えていない前提に立つ。以下の 3 点が伝わるように書く。

1. **何のために** — この処理が満たしている要件・画面上の意味(例:「カウントダウンが視聴者の TZ に
   依存しないようにするため」)
2. **なぜこの方法なのか** — 素直に書かない理由。API の実データの癖、過去に踏んだ不具合、
   ブラウザ/CDN の制約など、その判断の根拠を必ず残す
3. **どのような処理か** — 非自明なアルゴリズムやデータの流れの要約(自明な 1 行の言い換えは書かない)

書き方の決まり:

- ファイル冒頭に、そのモジュールの役割と入出力(データ契約)を数行で書く。
- 関数の直前に、その関数が何を受け取り何を返すか + 上記の「なぜ」を書く。
- マジックナンバー・閾値には必ず根拠を添える(例:`PREFETCH_LIMIT = 12` なら「なぜ 12 件か」)。
- API 由来の値を触る箇所には、**実データがどうなっているか**を書く
  (例:「`type` は数値で返る(1=レベル, 2=休憩)」「8 割の大会にしか説明文が入っていない」)。
- バグ修正のコメントは「何が起きていたか → だからこう直した」を残す。再発防止の情報になる。
- コードを変更したら、周辺のコメントが古くなっていないか必ず確認して直す。
  **嘘のコメントはコメントが無いより悪い。**
- コメントアウトした古いコードを残さない(履歴は git にある)。

既存コードの以下が手本になる。同じ密度・粒度で書く。

- `netlify/functions/lib/adapter.mjs` の `buildLive()` 内 `endsAt` の説明(なぜ絶対時刻を渡すのか)
- `netlify/functions/lib/adapter.mjs` の `baseEvent()` 内 `description` の説明(なぜ
  `dailyDetails.description` を使わないのか)
- `js/app.js` の `cardHtml()` 冒頭のタブ選択復元の説明(何の不具合を防いでいるのか)

## ドキュメント

- `docs/architecture.md` — 構成・PokerLens → フロントの変換表・フェーズ計画
- `docs/pokerlens-api.md` — API 調査(画面と API の対応、実データの傾向、未確認事項)
- `docs/getting-credentials.md` — 認証フローの正解(`.env.example` より優先)
- `docs/vendor-request.md` — ベンダー確認依頼の文面

Phase 2(ログイン・申込・マイページ)は未実装。`app.js` の申込モーダル、お気に入り(localStorage)は
モックのままで、本番では `PUT /v1/player/ticket` / `POST /v1/device/favorites` に繋ぐ想定。
