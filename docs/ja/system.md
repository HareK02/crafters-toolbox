# システム

world, datapack, mod, plugin, resourcepack をコンポーネントとして扱います。

components ディレクトリにコンポーネントを配置し、`crtb.properties.yml`に記述します。
システムがcomponent を認識し、ファイルに書き起こし、そのファイルを利用して自動的にzip化やビルドを行い、サーバー上に配置します。

利用フローをイメージした例は[こちら](./usecase.md)です。

## コンポーネントのタイプと機能

world以外のコンポーネントの名前はユニークである必要があります。


### World

ワールドは、Minecraft のワールドを表します。
バージョン管理する必要がない場合は`crtb.properties.yml`に含めないことができます。
ワールドは容量が大きく、Gitによるバージョン管理は推奨されませんが、利用可能です。(クラウドストレージなどを利用することを推奨します)

```yaml
components:
  world:
    reference: <reference>
```

### Datapack

```yaml
components:
  datapacks:
    - <datapack_name>:
        zip: true # boolean
        reference: <reference>
```
### Plugin

```yaml
components:
  plugins:
    - <plugin_name>:
        reference: <reference>
```
### Mod

```yaml
components:
  mods:
    - <mod_name>:
        reference: <reference>
```
### Resourcepack

```yaml
components:
  resourcepack:
    - <resourcepack_name>:
        serve: true # boolean
        reference: <reference>
```
### Server
サーバーは、Minecraft のサーバーを表します。

## Reference

コンポーネントはそのファイルの所在を表す`Reference`を持ちます。
現在利用可能なコンポーネントは以下の通りです。

- GitRef
- LocalRef
- HttpRef

`<filename>` はコンポーネントのファイル名を表します。

### GitRef

GitRef は GitHub のリポジトリを参照します。
GitHub のリポジトリは以下のように指定します。

```yaml
<filename>:
  url: string
  branch: string
  commit: string
```

- `url`: GitHub のリポジトリの URL を指定します。
- `branch`: GitHub のリポジトリのブランチを指定します。
- `commit`: GitHub のリポジトリのコミットを指定します。

### LocalRef

LocalRef はローカルのファイルを参照します。
LocalRef は以下のように指定します。

```yaml
<filename>:
  path: string
```

- `path`: ローカルのファイルのパスを指定します。

### HttpRef

HttpRef は HTTP(S)の URL を参照します。
HttpRef は以下のように指定します。

```yaml
<filename>:
  url: string
```

- `url`: HTTP(S)の URL を指定します。

# エクスポートについて

制作したものをエクスポートすることができます。

任意のコンポーネントをワールドやサーバーとは独立してエクスポートすることができます。
データパックとリソースパックはワールドに同梱できます。
プラグインと MOD はサーバーに同梱できます

- ワールドとしてエクスポート
  ワールドにデータパックやリソースパックを同梱してエクスポートします。
  ```
    export.zip
      └── world
  ```
- サーバーとしてエクスポート
  ワールドに加え、プラグインまたはサーバーサイド MOD を同梱してエクスポートします。
  ```
    export.zip
      └── server
          ├── world
          └── plugins | mods
  ```
- クライアント用ファイルの同梱
  ワールドやサーバーに加え、クライアントサイド MOD を同梱してエクスポートします。
  ```
    export.zip
      ├── server | world
      └── client
          ├── mods
          └── resourcepacks
  ```
