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

---

# 大会写真(Google Drive)

写真は PokerLens ではなく Google Drive から読む(理由は issue #28 / `docs/architecture.md`)。
Google アカウントがあれば無料。**課金の有効化は不要**(Drive API の読み取りは無料枠で足りる)。

## A. API キーを作る

1. プロジェクトを作る — https://console.cloud.google.com/projectcreate
2. Drive API を有効にする — https://console.cloud.google.com/apis/library/drive.googleapis.com
   (上部で 1 のプロジェクトが選択されていることを確認してから「有効にする」)
3. 「認証情報を作成」→「API キー」— https://console.cloud.google.com/apis/credentials
4. キーに制限をかける:

| 項目 | 設定 | 理由 |
|---|---|---|
| API の制限 | 「キーを制限」→ **Google Drive API のみ** | 万一漏れても Drive の読み取り以外に使えない |
| アプリケーションの制限 | **なし** | Netlify Functions は送信元 IP が固定されず、HTTP リファラー制限もサーバー間通信では効かない |

「なし」でも読めるのは**公開されている Drive ファイルだけ**。非公開のファイルには届かないが、
キーはリポジトリに置かず環境変数で管理し、漏れたら 3 の画面から再発行する。

## B. Drive のフォルダを用意する

```
親フォルダ  ← これだけを「リンクを知っている全員 / 閲覧者」で共有する
├── WOLF                  ← 種別フォルダ。この 1 段で大会写真の種別が決まる(#72)
│   ├── PlayGuide         ← Player's Guide の PDF(写真ではない)
│   ├── 2026-05-27 #1 狼煙 〜NOROSHI〜
│   ├── 2026-05-29 #SP2 白豚 ～HAKUTON～ FROM RE:ALAB / MYSTERY BOUNTY
│   └── 2026-05-30 #18 SINGLE DAY HIGH ROLLER
├── 宴
└── 歌留多
```

- フォルダ名は **`YYYY-MM-DD #番号 大会名`**。開催日を先頭に入れるのは必須
  (大会名だけでは過去 921 大会の 77% が特定できない)
- 番号は運営の管理表記でよい — 通常大会は `#4`、特殊イベントは `#SP2`、サテライトは `#S1`。
  PokerLens の管理画面の No. は数値しか入らないので `#SP2` は API 側の大会名には出てこないが、
  **番号を外した大会名で照合する**ので食い違っていてよい(#82)。番号を書かなくても照合できる
- **フライト表記(`#3/A` や `(1A)`)は書かなくてよい**。Day 1A / Day 2 は大会名自体に
  「DAY 1A」が入っているのでそれで区別できる。**その代わり大会名は省略しない**
  (`#3 MAIN EVENT DAY 1A` の「DAY 1A」を削ると、どの日の写真か決められず出なくなる)
- 大会名は PokerLens の表記と記号やスペースがずれていても照合できる(正規化で吸収する)
- **日付だけは合わせる**。照合は開催日で絞り込むので、日付が 1 日ずれると写真が出ない
- **共有するのは親フォルダだけ**。中の大会フォルダは API が自動で見つける

親フォルダの ID は URL の `/folders/` の後ろ:
`https://drive.google.com/drive/folders/`**`1DlffsS3EOSoPGRdc2KmL9k9tv2EGOcfr`**

## C. 設定

```bash
GOOGLE_API_KEY=AIza...              # A で作ったキー
PHOTO_DRIVE_FOLDER_ID=<親フォルダID>  # B-3 の ID
```

両方が揃っていなければ「写真 0 枚」として動く(サイトは通常どおり表示される)。

## D. 動作確認

```bash
curl -s -G "https://www.googleapis.com/drive/v3/files" \
  --data-urlencode "q='<親フォルダのID>' in parents" \
  --data-urlencode "key=<APIキー>" \
  --data-urlencode "fields=files(id,name,mimeType)"
```

成功すると大会フォルダの一覧が返る(`mimeType` が `application/vnd.google-apps.folder`)。

| 返ってくるもの | 原因 |
|---|---|
| `"files": []`(空) | 親フォルダが「リンクを知っている全員」で共有されていない / フォルダ ID の取り違え |
| `File not found`(404) | 同上。**キーが無効なのではなく、匿名では見えないという意味** |
| `API key not valid`(400) | キーの打ち間違い |
| `Method doesn't allow unregistered callers`(403) | キーが付いていない / Drive API が未有効 |

`netlify dev` を起動していれば BFF 側からも確認できる:

```bash
curl localhost:8888/api/photos            # フォルダ一覧(named:false は命名規約を満たしていない)
curl localhost:8888/api/photos/<大会ID>   # その大会の写真
```
