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
し、Ctrl+C でデタッチのみ行う | | `ssh up/down` / `ssh` | 協調作業用 SSH
サーバーを起動／停止／状態確認。鍵は `components/.ssh/authorized_keys` に配置 |
| `components list` | `crtb.properties.yml` と `components/`
ディレクトリを突き合わせた一覧表示 | | `components update [selector ...]` |
指定コンポーネントのみ、あるいは全件を取得→ビルド→`server/` に配置 | |
`terminal [game                    | ssh                                                                                                  | monitor]`
| 稼働中コンテナへ安全にアタッチ | | `setup` | `server.jar` をダウンロード | |
`monitor` | 監視コンテナ用の将来機能（現状は未実装のスタブ） |

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

- Windows ホストでは Docker Desktop がファイル共有を root 権限でマウントするため、権限不一致を避ける目的で CRTB は自動的にコンテナを `root` ユーザーで実行します。macOS / Linux ホストでは従来通り UID/GID をホストユーザーに合わせて実行します。
