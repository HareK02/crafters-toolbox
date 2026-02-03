# Crafter's Toolbox

CRTB は Minecraft: Java Edition の制作物（サーバー、プラグイン、データパック等）を一括で管理するためのツールチェーンです。Deno 製 CLI と Docker コンテナを組み合わせ、ワンコマンドでビルド／デプロイ／SSH 共有を行えます。

## 特徴

- `crtb.properties.yml` で定義した制作物を自動ビルド・配置
- ゲームサーバー、SSH サーバー、監視（WIP）の 3 コンテナ構成
- コマンドライン／インタラクティブ UI どちらでも操作可能
- ホスト UID/GID をコンテナに反映し、ファイルパーミッションを安全に維持
- ローカル／リモート両対応の柔軟なインストーラー

## インストール

以下のコマンドを実行してインストールしてください：

```bash
curl -fsSL https://raw.githubusercontent.com/HareK02/crafters-toolbox/main/install.sh | bash
```

## クイックスタート

1. 依存ツールを用意
   - [Deno 1.41+](https://deno.land/) / [Docker](https://www.docker.com/) /
     [Git](https://git-scm.com/)
2. プロジェクトを作成・設定する
   ```bash
   crtb init my-server
   cd my-server
   # 2つの設定ファイルを編集
   $EDITOR crtb.properties.yml  # サーバー種別、バージョン、コンポーネント
   $EDITOR crtb.config.yml      # ランタイム設定（メモリ、SSH など）
   crtb setup                   # server.jar を取得
   ```
3. サーバーを起動
   ```bash
   crtb                         # インタラクティブメニュー
   # または
   crtb server start --build
   ```

## 主なコマンド

| コマンド                           | 説明                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `server start/stop/restart`        | Minecraft サーバー用コンテナを制御。`start` 後は自動で `docker attach` し、Ctrl+C でデタッチのみ行う |
| `ssh start` / `ssh`                | 協調作業用 SSH サーバーを起動。`ssh start --build` で SSH イメージを再ビルド                         |
| `ssh keys`                         | `.ssh/authorized_keys` を操作（add/list/remove）                                                     |
| `components list`                  | `crtb.properties.yml` で定義されたコンポーネントの一覧表示                                           |
| `components update [selector ...]` | 指定コンポーネントのみ、あるいは全件を取得→ビルド→`server/` に配置                                   |
| `terminal [game/ssh/monitor]`      | 稼働中コンテナへ安全にアタッチ                                                                       |
| `setup`                            | `server.jar` をダウンロード                                                                          |
| `monitor`                          | 監視コンテナ用の将来機能（現状は未実装のスタブ）                                                     |

### SSH 設定

`crtb.config.yml` の `ssh`
セクションでコンテナの有効/無効や認証方式を制御できます。

```yaml
ssh:
  enabled: true # false にすると `crtb ssh` での起動をブロック
  auth:
    keys:
      enabled: true # 公開鍵認証の ON/OFF
    password:
      enabled: false # パスワード認証の ON/OFF
      value: "" # 利用するログインパスワード（必須・空不可）
```

`ssh.auth.password.enabled` を `true` にした場合は
`value`（平文パスワード）を必ず設定してください。空のままだと SSH
コンテナ起動時にエラーで停止します。公開鍵認証を使う場合は
`ssh keys add/list/remove` で `.ssh/authorized_keys` を編集できます。

## 設定

### crtb.properties.yml

サーバータイプとコンポーネントを定義します：

```yaml
server:
  type: paper          # サーバータイプ: vanilla, paper, spigot, forge, fabric, neoforge
  version: latest      # Minecraft バージョン
  build: latest        # サーバービルドバージョン

components:
  my-plugin:
    type: plugin
    source:
      type: local
      path: ./my-plugin
    build:
      command: ./gradlew build
    artifact:
      path: ./build/libs/my-plugin.jar
```

コンポーネントタイプ: `plugin`, `mod`, `datapack`, `resourcepack`, `world`

### crtb.config.yml

ランタイム設定を行います：

```yaml
game_server:
  max_memory: 8G
  min_memory: 2G
  port: 25565

ssh:
  enabled: true
  port: 2222
  auth:
    keys:
      enabled: true
    password:
      enabled: false

runner:
  java_base_image: eclipse-temurin:21-jdk
```

詳細な使い方は下記ドキュメントを参照してください。

## ディレクトリ構成（抜粋）

```
├── server/                # 稼働中サーバーデータ
├── scripts/               # Deno CLI コマンド群
├── docker/                # 共通 Docker イメージとエントリーポイント
├── crtb.properties.yml    # サーバー種別とコンポーネント定義
├── crtb.config.yml        # ランタイム設定（メモリ、SSH など）
└── docs/ja/               # 日本語ドキュメント
```

## 依存ソフトウェア

- [Git](https://git-scm.com/)
- [Deno](https://deno.land/)
- [Docker](https://www.docker.com/)

## プラットフォーム注意事項

- Windows ホストでは Docker Desktop がファイル共有を root 権限でマウントするため、CRTB はデフォルトで WSL の既定ディストリビューションに問い合わせて UID/GID/ユーザー名を取得し、そのユーザーとしてコンテナを実行します。
  これにより Linux 環境 (例: WSL で開いている作業ディレクトリ) と同じ所有者でファイルが作成され、追加の手順は不要です。WSL が使えない、もしくは別のユーザーを使いたい場合は `CRTB_HOST_UID` / `CRTB_HOST_GID` / `CRTB_HOST_USER` を設定すると任意の ID を優先できます。macOS / Linux ホストでは従来通り UID/GID を自動検出して実行します。
