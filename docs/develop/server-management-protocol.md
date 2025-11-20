# Minecraft サーバー管理プロトコル（1.21.9）技術解説ドキュメント

## 1. 概要

Minecraft Java Edition 1.21.9 より、専用サーバー向けに公式の **サーバー管理プロトコル（Server Management Protocol）** が実装された。これは WebSocket による JSON-RPC 2.0 ベースの管理 API であり、従来の RCON や非公式ツールでは実現が難しかった、統一化された外部管理を可能にする。

本ドキュメントでは、仕様、設定方法、API 構造、セキュリティ、運用事例までを体系的に整理する。

---

## 2. プロトコルの特徴

### 2.1 JSON-RPC 2.0 に準拠

本プロトコルは JSON-RPC 2.0 を基盤とし、以下を提供する：

- メソッド呼び出し（Request）
- レスポンス（Response）
- 通知（Notification）

各メソッドは名前空間（namespace）で分類され、例えば `minecraft:players/list` のような形式でアクセスする。

### 2.2 WebSocket 通信

サーバーは WebSocket により管理接続を受け付ける。

- 接続例： `ws://<host>:<port>/`
- TLS の有効・無効は設定で切り替え可能。

### 2.3 双方向性

- 管理ツール → サーバー：操作要求（例：許可リスト追加、ゲームルール変更）
- サーバー → 管理ツール：通知（例：プレイヤー参加・退出、設定変更）

---

## 3. 有効化と設定

### 3.1 `server.properties` による構成項目

以下の設定を追加・変更することで管理プロトコルが有効化される。

| 設定項目                                  | 内容                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `management-server-enabled`               | プロトコルの有効化。`true` で起動時に管理サーバー開始。 |
| `management-server-host`                  | バインド先ホスト。`localhost` でローカル限定が可能。    |
| `management-server-port`                  | WebSocket ポート。`0` で自動割り当て。                  |
| `management-server-secret`                | Bearer 認証トークン。未指定時は起動時生成。             |
| `management-server-tls-enabled`           | TLS 有効化。セキュリティ確保に推奨。                    |
| `management-server-tls-keystore`          | 証明書 keystore のパス。                                |
| `management-server-tls-keystore-password` | keystore のパスワード。                                 |
| `status-heartbeat-interval`               | 定期ステータス通知間隔（秒）。`0` で無効。              |

### 3.2 最小構成例

```
management-server-enabled=true
management-server-host=0.0.0.0
management-server-port=25585
management-server-secret=YOUR_SECRET_TOKEN
management-server-tls-enabled=false
status-heartbeat-interval=60
```

---

## 4. 接続と認証

### 4.1 WebSocket 接続

クライアントは WebSocket で指定ポートに接続する。

例：

```
ws://192.168.1.10:25585/
```

### 4.2 Bearer 認証

接続時ヘッダー：

```
Authorization: Bearer <管理トークン>
```

権限が無い場合は 401 応答となる。

---

## 5. API の構造

### 5.1 名前空間

API は複数の名前空間で構成される。例：

- `minecraft:players` — プレイヤー情報取得
- `minecraft:allowlist` — 許可リスト操作
- `minecraft:operators` — OP 権限管理
- `minecraft:server` — サーバー制御（停止・保存など）
- `minecraft:game_rules` — ゲームルール操作

### 5.2 スキーマの取得

API スキーマは `rpc.discover` により取得できる。

```
{ "id":1, "method":"rpc.discover", "params":[] }
```

これにより、利用可能なメソッド・通知一覧が返される。

### 5.3 リクエスト例

#### 許可リストにプレイヤーを追加

```
{
  "id":1,
  "method":"minecraft:allowlist/add",
  "params": [
    [ { "name": "jeb_" } ]
  ]
}
```

### 5.4 通知例（プレイヤー参加）

```
{
  "jsonrpc": "2.0",
  "method": "minecraft:notification/players/joined",
  "params": [
    { "id": "UUID", "name": "jeb_" }
  ]
}
```

---

## 6. セキュリティ設計

### 6.1 トークン管理

`management-server-secret` は管理権限を直接制御するため漏洩は重大なリスクとなる。強力なランダム値を使用すること。

### 6.2 TLS 利用

インターネット越しの運用では TLS を必須とする。ローカルネットワーク運用であっても推奨される。

### 6.3 接続制限

`management-server-host=localhost` とすることで外部からの接続を遮断可能。

---

## 7. 運用・利用シナリオ

### 7.1 自動化システムとの連携

- プレイヤー参加通知 → Discord/Slack 通知
- 外部スクリプトからバックアップ自動化
- サーバー状態監視ダッシュボード作成

### 7.2 Web 管理パネルの構築

管理プロトコルはフロントエンドから直接操作可能であるため、Web UI による管理パネルが容易に構築できる。

### 7.3 プラグインによる拡張

カスタム名前空間を追加し、独自 API を提供することが可能。

---

## 8. トラブルシューティング

| 問題                 | 原因                             | 対策                               |
| -------------------- | -------------------------------- | ---------------------------------- |
| 接続できない         | ポート未開放、TLS 設定不一致     | ファイアウォールや TLS 設定を確認  |
| 401 Unauthorized     | 認証トークン不正                 | 正しいトークンを設定・更新         |
| メソッドが存在しない | バージョン不一致／スキーマ未確認 | `rpc.discover` を実行して確認      |
| 通知が届かない       | heartbeat 無効化／通知未対応     | `status-heartbeat-interval` を設定 |

---

## 9. まとめ

本プロトコルは、Minecraft サーバー管理を外部から安全かつ柔軟に制御できる公式手段として導入された。JSON-RPC と WebSocket による高い拡張性を備え、運用自動化や管理 UI 構築を容易にする。

今後のエコシステム拡大が期待される技術であり、専用サーバー運用者は導入を検討する価値がある。
