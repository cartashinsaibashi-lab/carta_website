# PokerLens API 調査まとめ

- ベース URL: `https://api.pokerlens.net`
- Swagger UI: <https://api.pokerlens.net/swagger/ui/index>
- 仕様書は 4 分割されている(Swagger UI 右上のドロップダウンで切替):
  - `GET /standard/swagger` — **イベント・会場・ランキングなど公開系(今回のメイン)**
  - `GET /player/swagger` — プレイヤー個人系(プロフィール、エントリー履歴、チケット等)
  - `GET /security/swagger` — 認証
  - `GET /service/swagger` — 運営・管理系(サイトからは基本使わない)

## 認証

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/security/authenticate` | ユーザー認証(トークン取得)。プレイヤー系 API 呼び出しに必要 |

一覧・詳細などの公開情報にどこまで認証が必要かは、API キー/契約内容と合わせて要確認。

## 今回のサイトで使用する可能性が高い API(standard)

### 1. 大会一覧(トップのカード一覧)

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/event/search` | イベント検索。**一覧表示の中核** |
| POST | `/v1/event/search-dates` | 開催日ベースの検索(カレンダー表示する場合) |
| POST | `/v1/gametype/search` | ゲーム種別マスタ取得 |
| POST | `/v1/venueleague/search` | リーグ(シリーズ)検索。「ウルフ / 宴 / その他」の分類は `leagueId` か `tags` で表現できる可能性が高い |

`EventsSearchOptions`(検索リクエスト)の主なパラメータ:

- `status`: `scheduled | running | results | closed` → **過去 / 進行中 / 未来 の絞り込みにそのまま使える**
- `subscriptionStatus`: `opened | closed | openSoon` → 申込受付状況での絞り込み
- `venueId` / `leagueId` / `gameTypeId` / `text` / `startDate` / `endDate` / `buyinMin` / `buyinMax`
- `orderBy`: `date | date_Desc | name | ...`、`pageIndex` / `pageSize`(ページング)

レスポンス `EventsResult.results[]` は `VenueEvent`。カード表示に必要な項目はほぼ揃う:
`name` / `status.code`(opened, running, closed)/ `subscription.buyin`(buyin, fee, currencySymbol)/
`subscription.guaranteedAmount` / `stats.totalEntries` / `behaviour.gameType` / `venue` / `description.logoUrl, bannerUrl` など。

### 2. 大会詳細(アコーディオン「大会情報」タブ)

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/event/{id}` | イベント全データ取得(詳細タブの中核) |
| GET | `/v1/event/{id}/flights` | マルチフライト(Day1A/1B 等)の一覧 |
| GET | `/v1/eventimage/{id}` / `/v1/event/{id}/logo` / `/v1/event/{id}/banner` | イベント画像類 |

`VenueEvent` 内の使いどころ:

- `subscription`: バイイン内訳(`buyin` / `fee`)、リエントリー可否(`rebuyAllowed` 等)、レイトレジ(`lateRegistrationLevel`)、保証額(`guaranteedAmount`)
- `description`: スタック(`chips`)、リエントリー(`multipleEntries`)、マルチデイ(`multiDay`)などの**整形済み表示用テキスト**(¥表記等がすでに整形されている)
- `behaviour`: フリーズアウト等の形式(`code`)、ゲーム種別、日数
- **`dailyDetails.description`(string): 大会の自由記述の説明文**。モックの「大会情報」タブ内『大会詳細』セクションはこのフィールドを想定
  - 補足: `dailyDetails.levelDescription`(ストラクチャー概要文)、`dailyDetails.name / fullname / shortName`(表示名のバリエーション)、`dailyDetails.subscriptionOpen / subscriptionClose`(受付期間)もここにある
  - 注意: 実データでこのフィールドに説明文が入力されているかは店舗側の運用次第のため要確認(未入力の場合はセクション非表示にする実装をモックに入れてある)

### 3. ストラクチャー(「ストラクチャー」タブ)

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/event/{id}/structure` | ストラクチャー取得 |
| GET | `/v1/event/{id}/levels` | レベル一覧取得(`EventLevel[]`) |

`EventLevel`: `index` / `type`(level, break)/ `smallBlind` / `bigBlind` / `ante` / `minutes` / `startTime`。
モックのストラクチャー表とほぼ 1:1 で対応。

### 4. 進行中の大会(「ライブ状況」タブ)

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/event/{id}` | `status` + `stats` をポーリングして現在状況を表示 |
| POST | `/v1/event/{id}/prizepool` | プライズプール取得 |
| GET | `/v1/event/{id}/payouts` | ペイアウト構成(入賞ライン表示) |
| POST | `/v1/event/{id}/tables` | テーブル状況(必要なら) |

現在ブラインドの計算に使う項目:

- `status.code`: `opened | running | closed`
- `status.levelIndex` + `status.level.elapsedSeconds` → 現在レベルと経過時間(残り時間 = `EventLevel.minutes × 60 − elapsedSeconds`)
- `stats`: `totalEntries` / `totalPlayers`(残り人数)/ `averageChipsCount` / `totalChipsCount` / `totalTables` / `totalPayoutAmount`(プライズプール)/ `guaranteedAmount`

WebSocket 等のプッシュ配信は standard 仕様には見当たらないため、**ポーリング(例: 15〜30 秒間隔)想定**。
※ player 系に `GET /v1/player/listen/{id}` があるので、リアルタイム配信の可否はベンダーへ要確認。

### 5. 過去の大会(「結果」タブ)

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/event/{id}/players` | プレイヤー結果一覧(順位・賞金)。**結果タブの中核** |
| POST | `/v1/event/{id}/search` | イベント結果検索 |
| GET | `/v1/event/{id}/payouts` | ペイアウト表 |
| GET | `/v1/event/{id}/results-export` | 結果エクスポート |

`EventPlayer`: `position` / `player`(名前等)/ `payout.payoutAmount` / `payout.bountyAmount` / `countryName` / `countryUrl`(国旗)。

### 6. 未来の大会(「申込状況」タブ)

| Method | Path | 用途 |
|---|---|---|
| GET | `/v1/event/{id}` | `subscription` と `stats.totalReservations` 等で申込状況を表示 |
| POST | `/v1/event/{id}/ticket-groups` / `/v1/event/{id}/tickets` | チケット(サテライト獲得シート等)関連 |

- 受付状態: 検索時の `subscriptionStatus`(`opened | closed | openSoon`)
- 申込数: `stats.totalReservations` / `totalEntries`、定員はイベント設定側(要確認)

### 7. 大会への申込(エントリー予約)— player 系・要認証

**申込は API で実行可能**。`PlayerTicketAddRequest.type` に `eventReservation`(イベント予約)が定義されている。

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/security/authenticate` | 認証。`playerToken` + `clientID` / `clientSecretID` / `domainID` を渡してセッション `token` を取得 |
| **PUT** | **`/v1/player/ticket`** | **申込の実行**。`{ type: 'eventReservation', referenceID: <イベントID>, note }` を送信 |
| POST | `/v1/player/ticket/search` | 自分の申込(予約・チケット)一覧 → マイページ |
| GET | `/v1/player/ticket/{id}` | 申込詳細(QR コード等) |
| DELETE | `/v1/player/ticket/{id}` | **申込キャンセル** |
| POST | `/v1/player/ticket/{id}/event/search` | チケット(サテライト獲得シート等)が使えるイベントの検索 |
| POST | `/v1/player/ticket/{id}/consume` | チケットの使用(獲得シートでのエントリー等) |
| POST | `/v1/player/evententry/search` | 受付後の正式エントリー一覧(`EventPlayerSubscription`: QR コード URL、チェックイン日時、フライト等) |

`PlayerTicketAddRequest.type` は `eventReservation | cashWaitingList | eventTicket` の 3 種。
`cashWaitingList` はリングゲームのウェイティングリスト登録に使える。

想定フロー(Web サイト側):
1. 申込ボタン → ログイン(未ログイン時)
2. `PUT /v1/player/ticket`(eventReservation)で予約作成
3. 予約 QR コード(`qrCodeUrl`)を表示 → 当日受付で提示・チェックイン
4. マイページで `ticket/search` の一覧表示、`DELETE` でキャンセル

**申込機能の未確認事項(ベンダーに確認)**:
1. `clientID` / `clientSecretID` / `domainID` の発行(API 契約)
2. `playerToken` の取得方法 — プレイヤーのアカウント作成・ログインのフロー(パスワード認証のエンドポイントは公開仕様に見当たらない。PokerLens アプリのアカウントや PLAYERS+ など既存会員基盤との連携方法を要確認)
3. 決済 API は存在しない — 支払いは現地(現金・カルタドル等)前提。事前オンライン決済が必要なら別の仕組みが必要
4. 定員到達時の挙動(ウェイティング behavior)、キャンセル期限の制御

## 補助的に使う可能性がある API

| Method | Path | 用途 |
|---|---|---|
| POST | `/v1/venue/search` / GET `/v1/venue/{id}` | 会場情報・会場ページ |
| GET | `/v1/venue/image/{id}` | 会場画像 |
| POST | `/v1/ranking/search` / GET `/v1/ranking/{id}` ほか | シリーズランキング表示(POY 等) |
| GET | `/v1/domain/announcements` | お知らせ表示 |
| POST | `/v1/device/favorites` | お気に入り登録(`DeviceFavoriteRequest { id, type, enabled }`)。モックの★ボタンはこれに接続する想定 |
| POST | `/v1/venue/favorite/search` / `/v1/venue/{id}/favorite` | 会場のお気に入り |
| GET | `/v1/country/{id}/flag` | 国旗画像 |

## プレイヤー向け機能を作る場合(player 系・要認証)

| Method | Path | 用途 |
|---|---|---|
| GET/POST | `/v1/player/profile` | プロフィール取得・更新 |
| POST | `/v1/player/evententry/search` | 自分のエントリー一覧(マイページ) |
| POST | `/v1/player/eventresult/search` | 自分の成績履歴 |
| POST | `/v1/player/ticket/search` / PUT `/v1/player/ticket` | 保有チケット(サテライト獲得シート) |
| POST | `/v1/player/ticket/{id}/consume` | チケット使用(=大会申込に相当する可能性大) |

## 画面とAPIの対応(モックとの紐付け)

| モックの画面要素 | API |
|---|---|
| 種別タブ(ウルフ/宴/その他) | `POST /v1/event/search` の `leagueId` または `text`/タグ ※分類方法は運用と要すり合わせ |
| 状況フィルタ(進行中/予定/終了) | 同上 `status` パラメータ |
| カード(大会名・金額・保証) | `VenueEvent.name / subscription.buyin / guaranteedAmount` |
| 大会情報タブ | `GET /v1/event/{id}` |
| ストラクチャータブ | `GET /v1/event/{id}/levels` |
| ライブ状況タブ | `GET /v1/event/{id}`(ポーリング)+ `prizepool` |
| 結果タブ | `POST /v1/event/{id}/players` + `payouts` |
| 申込状況タブ | `GET /v1/event/{id}`(subscription)+ player 系チケット API |

## 未確認事項(ベンダー/運営に確認したい)

1. 公開情報(イベント一覧・結果)の取得に認証・API キーが必要か
2. 「ウルフ / 宴 / その他」の分類をどのフィールドで持たせるか(league / tags / gameType)
3. 申込(エントリー)をサイトから直接行えるか(player API の consume/ticket 経由か、外部フォームか)
4. ライブ状況のリアルタイム配信手段(ポーリング頻度の上限、`/v1/player/listen/{id}` の仕様)
5. 定員(cap)に相当するフィールドの所在
