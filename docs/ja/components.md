# コンポーネントガイド

コンポーネントとは、Minecraft サーバーやクライアントに配置される成果物（プラグイン・Mod・データパック・リソースパック・ワールドデータ）のことです。`crtb.properties.yml` の `components` セクションで定義し、`crtb components` サブコマンドで管理します。

## コンポーネントの定義

```yaml
# crtb.properties.yml
components:
  my-plugin:
    type: plugin        # plugin | mod | datapack | resourcepack | world
    source:
      type: git
      url: https://github.com/example/my-plugin.git
      branch: main
    build:
      type: gradle
      task: build
      output: build/libs
    artifact:
      type: jar
```

### ソースタイプ

| type    | 説明                                              |
| ------- | ------------------------------------------------- |
| `local` | ローカルファイルシステムのパスを直接参照する      |
| `git`   | Git リポジトリをクローン／プルして使用する        |
| `http`  | URL からファイルをダウンロードしてキャッシュする  |

### ビルドタイプ

| type     | 説明                                                             |
| -------- | ---------------------------------------------------------------- |
| (なし)   | ビルドなし。ソースをそのままアーティファクトとして扱う           |
| `gradle` | `gradlew` または `gradle` でビルドを実行する                     |
| `custom` | Docker コンテナ内で任意のシェルコマンドを実行する                |

## サブコマンド

### `crtb components list`

`crtb.properties.yml` に登録されているコンポーネントの一覧とソース情報を表示します。

```bash
crtb components list
```

### `crtb components update [names...]`

**ローカルに存在するソースを使って**ビルド・デプロイします。リモートからの取得は行いません。

```bash
crtb components update           # 全コンポーネント
crtb components update my-plugin # 特定のコンポーネントのみ
```

**主な用途：**
- `git` ソースでローカルに変更を加えた後、再ビルドして反映したいとき
- ビルドスクリプトを修正して再試行したいとき

### `crtb components pull [names...]`

**リモートからソースを取得**し、ビルド・デプロイまで一括で行います。

```bash
crtb components pull             # 全コンポーネント（リモートソースのみ）
crtb components pull my-plugin   # 特定のコンポーネントのみ
```

**主な用途：**
- `http` ソースの最新版を取得してデプロイしたいとき
- `git` ソースをリモートの最新コミットに更新してデプロイしたいとき

> **注意：** `pull` は `source.type: local` のコンポーネントをスキップします。
> これは、シングル Gradle ワークスペース構成で複数コンポーネントが同時にビルドされると
> Gradle デーモンやロックファイルが競合する問題を回避するためです。
> ローカルソースのコンポーネントは `crtb components update` で個別にビルドしてください。

### `crtb components import [names...]`

`./components/` ディレクトリに存在するが `crtb.properties.yml` に未登録のコンポーネントを検出し、登録します。

```bash
crtb components import           # インタラクティブに選択
crtb components import my-plugin # 指定して登録
```

## `update` と `pull` の使い分け

| ソースタイプ        | ビルドあり              | ビルドなし（HTTP 直配置など）    |
| ------------------- | ----------------------- | -------------------------------- |
| `local`             | `update` で再ビルド     | `update`（コピーのみ）           |
| `git`               | `pull` で最新化＋ビルド | —                                |
| `http`              | `pull` で取得＋ビルド   | **`pull` のみ使用**（`update` は実質スキップされる） |

### HTTP 直配置コンポーネントについて

ビルドスクリプトを持たない `http` ソースのコンポーネント（例：配布済み jar をそのまま使うプラグイン）は、`update` を実行してもキャッシュヒット時にスキップされるため、デプロイが行われません。

最新版を取得・デプロイするには常に `pull` を使用してください。

```yaml
# ビルドなし HTTP コンポーネントの例
components:
  some-plugin:
    type: plugin
    source:
      type: http
      url: https://example.com/some-plugin-1.0.jar
    # build セクションなし → pull でダウンロード＆デプロイ
```

```bash
# ✅ 正しい使い方
crtb components pull some-plugin

# ⚠️  update はキャッシュがあるとスキップされる
crtb components update some-plugin
```
