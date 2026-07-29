# PokerLens 様への確認・発行依頼(CARTA POKER SERIES サイト連携)

> そのままメール/チャットに貼れる本文です。宛先・署名は適宜調整してください。

---

お世話になっております。CARTA POKER SERIES の Web サイトから PokerLens API に接続する準備を進めています。
Swagger(`https://api.pokerlens.net/swagger/ui/index`)を拝見し、こちらで下記まで確認できました。

- 公開系(`event/search` 等)も含め、認証なしでは `401` となる(＝閲覧のみでも認証が必要)
- 認可は `access_token` ヘッダにトークンを入れる方式(OAuth は無効)
- `POST /v1/security/authenticate` がトークン取得口

そのうえで、以下の**発行**と**確認**をお願いできますでしょうか。

## 1. Web API Service キーでの OAuth2 認証(最優先)

管理コンソールの Integration「kHold'em Key(Web API Service / venue=Carta)」の **Key** を
`client_secret` として、`https://identity.pokerlens.net/connect/token` に
`grant_type=client_credentials` でアクセストークンを取得する想定です。ここまでは確認できました。
残る不明点をご教示ください。

- このキーに対応する **`client_id`** は何でしょうか(コンソール上に表示が見当たりません)。
- resource(`api.pokerlens.net`)が要求する **`scope`** は何でしょうか(`api` で試すとトークンは
  発行されますが、`event/search` が 401 になります)。
- resource が受理するトークンの **`audience`** の想定値は何でしょうか(現状のトークンは
  `aud=api.read`)。
- resource へのトークン付与は `access_token` ヘッダで合っていますか(それとも
  `Authorization: Bearer`)。

## 2. 参考(こちらで確認済み)

- `event/search` 等 standard 系も認証必須(認証なしは 401)。
- `POST /connect/token` は稼働(IdentityServer)。`client_credentials` でトークン発行可。
- 目的:CARTA の Web サイトでイベント一覧/詳細/ストラクチャー/結果/ライブ状況を**閲覧表示**する。

## 3. 大会種別の分類フィールド

サイトは「**ウルフ / 宴 / その他**」の3種別で大会をタブ分けします。この分類は API のどのフィールドで判定するのが正でしょうか。

- `league`(`leagueId` / 名称)/ `tags` / `gameType` のいずれか
- 各種別に対応する **ID または名称の一覧**をいただけると、そのまま実装に反映できます。

## 4. 制限・ライブ更新

- レート制限(`429`)の上限はありますか。
- ライブ状況は**ポーリング**取得を想定しています。推奨間隔・上限はありますか。
- リアルタイム配信(player 系 `listen/{id}` 等)は利用可能でしょうか。

## 5.(次フェーズ)申込・ログイン機能

サイトから**大会申込・マイページ**を実装する場合、プレイヤー個人の `playerToken` はどのように取得しますか。
既存の会員基盤(PLAYERS+ 等)とのアカウント作成/ログイン連携方法をご教示ください。
※ こちらは次フェーズです。まずは 1〜4 があれば閲覧機能を公開できます。

---

以上、よろしくお願いいたします。
