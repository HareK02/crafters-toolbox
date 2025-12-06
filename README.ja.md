# Crafter's Toolbox

CRTB は Minecraft: Java Edition
の制作物（サーバー、プラグイン、データパック等）を一括で管理するためのツールチェーンです。Deno
製 CLI と Docker コンテナを組み合わせ、ワンコマンドでビルド／デプロイ／SSH
共有を行えます。

## 特徴

- `components/` に置いた制作物を `crtb.properties.yml`
  の定義に従って自動ビルド・配置
- ゲームサーバー、SSH サーバー、監視（WIP）の 3 コンテナ構成
- コマンドライン／インタラクティブ UI どちらでも操作可能
- ホスト UID/GID をコンテナに反映し、ファイルパーミッションを安全に維持

## クイックスタート

1. 依存ツールを用意
   - [Deno 1.41+](https://deno.land/) / [Docker](https://www.docker.com/) /
     [Git](https://git-scm.com/)
2. リポジトリを取得し設定する
   ```bash
   git clone <repo>
   cd crafters-toolbox
   $EDITOR crtb.properties.yml  # サーバー種別やコンポーネントを調整
   deno run -A main.ts setup     # server.jar を取得
   ```
3. CLI を起動
   ```bash
   deno run -A main.ts           # インタラクティブメニュー
   # または
   deno run -A main.ts server start --build
   ```

## 主なコマンド

## | コマンド | 説明 | | ---------------------------------- |

| --------- | ------------------------------ | | `server start/stop/restart` |
Minecraft サーバー用コンテナを制御。`start` 後は自動で `docker attach`
し、Ctrl+C でデタッチのみ行う | | `ssh start/stop/keys` / `ssh` | 協調作業用 SSH
サーバーを起動／停止／状態確認。`ssh start --build` で SSH イメージを再ビルドし、`ssh keys` で `.ssh/authorized_keys` を操作 |
| `components list` | `crtb.properties.yml` と `components/`
ディレクトリを突き合わせた一覧表示 | | `components update [selector ...]` |
指定コンポーネントのみ、あるいは全件を取得→ビルド→`server/` に配置 | |
`terminal [game                    | ssh                                                                                                  | monitor]`
| 稼働中コンテナへ安全にアタッチ | | `setup` | `server.jar` をダウンロード | |
`monitor` | 監視コンテナ用の将来機能（現状は未実装のスタブ） |

### SSH 設定

`crtb.config.yml` の `ssh` セクションでコンテナの有効/無効や認証方式を制御できます。

```yaml
ssh:
  enabled: true              # false にすると `crtb ssh` での起動をブロック
  auth:
    keys:
      enabled: true          # 公開鍵認証の ON/OFF
    password:
      enabled: false         # パスワード認証の ON/OFF
      value: ""              # 利用するログインパスワード（必須・空不可）
```

`ssh.auth.password.enabled` を `true` にした場合は `value`（平文パスワード）を必ず設定してください。空のままだと SSH コンテナ起動時にエラーで停止します。公開鍵認証を使う場合は `ssh keys add/list/remove` で `.ssh/authorized_keys` を編集できます。

詳細な使い方は下記ドキュメントを参照してください。

## ドキュメント

- [利用ガイド (docs/ja/usage.md)](docs/ja/usage.md)
- [開発者向けドキュメント (docs/ja/development.md)](docs/ja/development.md)

## ディレクトリ構成（抜粋）

```
├── server/                # 稼働中サーバーデータ
├── components/            # ソース (datapacks/plugins/mods/resourcepacks)
├── scripts/               # Deno CLI コマンド群
├── docker/                # 共通 Docker イメージとエントリーポイント
├── crtb.properties.yml    # プロジェクト固有設定
├── crtb.config.yml        # ランタイム既定値
└── docs/ja/               # 日本語ドキュメント
```

## 依存ソフトウェア

- [Git](https://git-scm.com/)
- [Deno](https://deno.land/)
- [Docker](https://www.docker.com/)

## プラットフォーム注意事項

- Windows ホストでは Docker Desktop がファイル共有を root 権限でマウントするため、CRTB はデフォルトで WSL の既定ディストリビューションに問い合わせて UID/GID/ユーザー名を取得し、そのユーザーとしてコンテナを実行します。これにより Linux 環境 (例: WSL で開いている作業ディレクトリ) と同じ所有者でファイルが作成され、追加の手順は不要です。WSL が使えない、もしくは別のユーザーを使いたい場合は `CRTB_HOST_UID` / `CRTB_HOST_GID` / `CRTB_HOST_USER` を設定すると任意の ID を優先できます。macOS / Linux ホストでは従来通り UID/GID を自動検出して実行します。
