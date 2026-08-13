# システム構成 — CARTA POKER SERIES × PokerLens API

本番実装の全体像。フロントは静的サイトのまま、**Netlify Functions を BFF(Backend-for-Frontend)**
として挟み、PokerLens API に接続する。

## 前提(調査で確定した事実)

1. **公開系エンドポイントも全て認証必須。** `POST /v1/event/search` は認証なしだと `401`
   (`Authorization has been denied`)。→ 一覧表示だけでもトークンが要る。
   認証は「申込機能だけの話」ではなく**全ページの前提**。
2. **認証は 1 本のエンドポイントで 2 階層。** `POST /v1/security/authenticate`:
   - `clientID` + `clientSecretID`(uuid)+ `domainID`(uuid)= **アプリ級の秘密鍵**(ブラウザに置けない)
   - `playerToken`(任意)を付けると**個人ログイン付きトークン**、空なら**匿名の閲覧用トークン**
   - レスポンスの `token` を以降の `Authorization` に付与。`expiration` / `expirationType`
     (none|minutes|hours|days)で TTL をこちらから指定できる。

→ 結論:**秘密鍵を保持し、認証を代行し、トークンをキャッシュするサーバー層が必須。**
ブラウザ直叩きは秘密鍵漏洩 + CORS で不可能。

## 全体図

```
┌─────────────────────────────────────────────────────────────┐
│ ブラウザ (静的 HTML/CSS/JS)                                    │
│   js/app.js  … 表示ロジック(既存・ほぼ無改修)                │
│   js/api.js  … 【新規】/api/* を取得し、app.js のデータ契約     │
│                (window.MOCK_EVENTS / window.CALENDAR)に流し込む │
└───────────────┬─────────────────────────────────────────────┘
                │ fetch('/api/events')  同一オリジン・秘密情報ゼロ
                ▼
┌─────────────────────────────────────────────────────────────┐
│ Netlify Functions (BFF / プロキシ層)  ← netlify/functions/    │
│  lib/pokerlens.mjs : 認証 + トークン TTL キャッシュ + 401再認証 │
│  lib/adapter.mjs   : VenueEvent → app.js データ契約 変換        │
│  lib/config.mjs    : 環境変数集約 / mock・live 切替             │
│  lib/fixtures.mjs  : mock モードのサンプル VenueEvent           │
│  lib/drive.mjs     : Google Drive(大会写真)+ フォルダ名照合   │
│  events.mjs  GET /api/events            → POST /v1/event/search │
│  event.mjs   GET /api/events/:id        → GET  /v1/event/{id}   │
│              GET /api/events/:id/:part  → levels|players|…      │
│  photos.mjs  GET /api/photos/:id        → Drive files.list      │
│              GET /api/photos            → フォルダ一覧(運用確認)│
│  秘密鍵は Netlify 環境変数(POKERLENS_* / GOOGLE_API_KEY)       │
└───────────────┬───────────────────────┬─────────────────────┘
                │ access_token          │ key=<API キー>
                ▼                       ▼
        PokerLens API            Google Drive API
      (api.pokerlens.net)     (www.googleapis.com/drive/v3)
```

## 大会写真(Google Drive)

PokerLens に大会写真を持たせる仕組みは無い(告知用の 1 枚だけで、実データでは過去 921 大会すべてで空)。
そのため写真だけ外部ストレージに置く。詳細な経緯と運用は issue #28 / `netlify/functions/lib/drive.mjs` 冒頭。

```
Drive 親フォルダ(「リンクを知っている全員が閲覧可」で共有 = PHOTO_DRIVE_FOLDER_ID)
  └ 「YYYY-MM-DD 大会名」のサブフォルダ  ← この名前で大会と突き合わせる
       └ 写真
```

- 共有するのは**親フォルダだけ**。大会ごとのフォルダは API で自動的に見つけるので、
  運営は新しい大会のフォルダを作って写真を入れるだけでよく、台帳(スプレッドシート)が要らない。
- **開催日が無いと大会を特定できない**。過去 921 大会でユニークな大会名は 274 種類しかなく、
  77% が同名(`FREEROLL` 147 件など)。`YYYY-MM-DD 大会名` なら 917/921 件が一意になる。
- 大会名の記号は 3 か所で字形が違う(チルダが U+301C / U+FF5E / U+007E)。
  NFKC は U+301C を変換しないため、`drive.mjs` の `normalizeTitle()` で明示的に統一している。
- 画像は `lh3.googleusercontent.com/d/<fileId>=w<幅>` をブラウザが直接読む(BFF を通らない)。
- フォルダ/ファイル一覧は Netlify Blobs に 10 分キャッシュ。Drive が落ちたら前回の内容を返し、
  それも無ければ空配列 — 写真タブが出ないだけでサイトは通常どおり動く。

## 2 階層トークン

- **匿名トークン**(app 認証のみ、playerToken 無し):一覧・詳細・結果・ライブ等、閲覧系すべて。
  Function のモジュールスコープに TTL キャッシュ(warm インスタンス間で再利用、コールドスタートで
  再認証)。将来 Netlify Blobs で跨インスタンス共有も可能(TODO)。
- **プレイヤートークン**(Phase 2):ログイン後、`playerToken` 付きで認証 → 得た `token` を
  HttpOnly セッション Cookie 側でサーバー保管。PokerLens のトークンはブラウザに出さない。

## フロントの差し替え口(シーム)

`app.js` はグローバル `window.MOCK_EVENTS`(配列)と `window.CALENDAR`(オブジェクト)を読むだけ。
`js/api.js` がこの 2 つを API から組み立てて設定 → `app.js` を起動する。API 取得に失敗した場合は
`js/data.js`(モック)にフォールバックするので、バックエンド未接続でも静的サイトとして動く。

データ契約の詳細(各フィールドの読み出し箇所)は本ドキュメント末尾の変換表を参照。

## 変換表(PokerLens VenueEvent → app.js)

| app.js フィールド | PokerLens ソース |
|---|---|
| `id` | `VenueEvent.id` |
| `category`(wolf/utage/other) | `behaviour.league.name` を部分一致判定(config 化・要ベンダー確認) |
| `status`(running/future/past) | `status.code`: running→running / closed→past / opened等→future |
| `name` | `name`(無ければ `dailyDetails.name`) |
| `year` / `month` / `day` / `dateLabel` | `dailyDetails.startDate`(ローカル時刻の ISO)を分解・整形 |
| `venue` | `venue.name` |
| `buyin` / `fee` | `subscription.buyin.buyin` / `.fee` |
| `guarantee` | `subscription.guaranteedAmount`(or `stats.guaranteedAmount`) |
| `startingStack` | `subscription.buyin.chips` |
| `levelMinutes` | `GET /v1/event/{id}/levels` の Lv.1(最初の `type=1`)の `minutes`。無ければ `dailyDetails.levelMinutes` → `status.levelMinutes` |
| `lateReg` | `subscription.lateRegistrationLevel` → `"Late Reg until Lv.N"` |
| `reentry` | `description.multipleEntries` / `behaviour.code` |
| `gameType` | `behaviour.gameType.name` |
| `structure[]` | `GET /v1/event/{id}/levels`(EventLevel[]) |
| `payouts[]` | `GET /v1/event/{id}/payouts`。`position` / `percentage` / `payoutAmount` / `description`(現物賞品の表記 "4 Tickets" 等。現金のみなら空) |
| `stats{}` | `stats.total*` / `averageChipsCount` 等 |
| `live{}`(running) | `status.levelIndex` + 現在レベルのブラインド + `stats.totalTables` |
| `registration{}`(future) | `subscription.buyins` + `stats.totalReservations` + `dailyDetails.playerAllowed` |
| `results[]`(past) | `POST /v1/event/{id}/players`(EventPlayer[]) |

金額・チップは**生の数値**で渡し、整形はビュー側(`yen()` / `num()`)が行う。

## フェーズ

| | 内容 | ブロッカー |
|---|---|---|
| **Phase 1** | BFF + 匿名認証 + 読み取り全機能 + フロントのアダプタ差し替え | `clientID/Secret/domainID` の発行のみ。届くまでは mock モードで開発継続 |
| **Phase 2** | ログイン・申込・マイページ・お気に入り永続化 | `playerToken` の入手/会員基盤(PLAYERS+ 等)連携 = ベンダー要確認 |

## 環境変数(`.env.example` 参照)

| 変数 | 用途 |
|---|---|
| `POKERLENS_MODE` | `mock`(fixtures)/ `live`(実 API) |
| `POKERLENS_BASE_URL` | 既定 `https://api.pokerlens.net` |
| `POKERLENS_CLIENT_ID` / `_CLIENT_SECRET` / `_DOMAIN_ID` | アプリ級クレデンシャル(live 必須) |
| `POKERLENS_DEVICE_UID` | 認証時のデバイス識別子(サーバー固定値) |
| `POKERLENS_TOKEN_TTL_TYPE` / `_VALUE` | セッショントークン TTL |
| `POKERLENS_AUTH_SCHEME` | `bearer` / `raw`(Authorization ヘッダ形式・要ベンダー確認) |
| `POKERLENS_CATEGORY_WOLF` / `_UTAGE` | league 名の分類キーワード |

## ベンダー(PokerLens)確認事項

1. `clientID` / `clientSecretID` / `domainID` の発行(読み取りだけでも必須)+ device 系フィールドの要否
2. app 認証(playerToken 無し)のトークンで standard 系を読めるか(想定 Yes)
3. ~~各リクエストの認可ヘッダ形式~~ → **解決**。Swagger UI 設定より `access_token`
   ヘッダに `authenticate` の `token` を生で入れる(OAuth 無効)。
4. `playerToken` の入手・会員基盤連携(= Phase 2)
5. wolf / 宴 / other の分類フィールド(league / tags / gameType)
6. レート制限(`429` あり)とライブのポーリング上限

## ローカル開発

```bash
# 依存インストール不要(Node v18+ の native fetch を使用)
netlify dev            # 静的サイト + /api/* を 8888 で配信(mock がデフォルト)
curl localhost:8888/api/events
```

live で試すには `.env` に `POKERLENS_MODE=live` と認証情報を設定する。
