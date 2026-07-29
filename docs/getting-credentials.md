# PokerLens API 認証 — 確定した正しいフロー

## 認証方式(実サイトの通信解析で確定・動作確認済み)

**`/v1/security/authenticate` でトークンを取得し、`access_token` ヘッダで使う。**
OAuth2(`/connect/token`)ではない。生キーを直接 `access_token` に入れるのも誤り
(`invalid_token_exchange` になる)。

```
POST https://api.pokerlens.net/v1/security/authenticate
Content-Type: application/json
{
  "clientID": "net.pokerlens.webapi",          // 任意文字列で可
  "clientSecretID": "<carta_api_key>",          // ★管理コンソールの API キー
  "deviceUID": "carta-website-bff-0001",
  "deviceName": "carta-website",
  "expiration": 1, "expirationType": "days",
  "playerToken": ""                             // 空=匿名(閲覧用)
}
→ 200 { token, domain, webApplication, permissions }

# 以降の API 呼び出し:
POST https://api.pokerlens.net/v1/event/search
access_token: <上で得た token>                  // 不透明・368文字前後
{ "text":"", "includeFlights":true, "orderBy":"date_Desc",
  "pageIndex":1, "pageSize":100 }               // ★pageIndex は 1 始まり(0 は 500)
→ 200 { totalNumberOfRecords, results:[ VenueEvent... ] }   // Carta の実イベント
```

### 重要ポイント
- **アクセス範囲は `clientSecretID`(= カルタの API キー)で決まる。** `clientID` は任意でよい。
- カルタのキーで search すると **venue=Carta の実イベント(約 483 件)** が返る。
- 認可ヘッダは **`access_token`**(`Authorization: Bearer` ではない)。
- **オリジン制限は BFF(サーバー側)には無関係**。Authorized source url を設定しても
  サーバーからの呼び出しは通る(実証済み)。ブラウザ直叩きにする場合のみ関係する。

## 設定(BFF)

`.env`(ローカル)/ Netlify 環境変数:
```bash
POKERLENS_MODE=live
POKERLENS_API_KEY=<carta_api_key>   # = clientSecretID
# 任意(既定値あり):
# POKERLENS_CLIENT_ID=net.pokerlens.webapi
# POKERLENS_TOKEN_EXP=1  POKERLENS_TOKEN_EXP_TYPE=days
```
BFF(`lib/pokerlens.mjs`)がこのフローを実装済み。トークンは自動でキャッシュ・再取得。

## 解明の経緯(参考)
`docs.pokerlens.net` が実は稼働中のプレイヤー向けサイトで、その通信を解析して
`net.pokerlens.player` + 公開 secret での authenticate → token → access_token の流れを確認。
同じ形にカルタのキーを当てて成功した。
