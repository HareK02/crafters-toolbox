# 例

プラグインを作成するとします。
まず、`components/plugins`ディレクトリに、`my_plugin`ディレクトリでプラグインを作成しました。
これを、コマンドラインツールで任意のタイミングで、または Watchサーバーを利用して自動的に、`crtb.properties.yml`に記述することになります。

```yaml
components:
  plugins:
    my_plugin:
      reference:
        type: LocalRef
        path: components/plugins/my_plugin
```

`my_plugin`ディレクトリが Git で管理されているか否かにかかわらず、あなたの操作がない限り`<reference>`は`LocalRef`となっているはずです。
`LocalRef`は、リモートで管理されていないローカルのファイルを参照します。ここでは`components/plugins/my_plugin`を指します。

通常のケースでは、プラグインやデータパックなどのテキストデータが主なプロジェクトは、Gitで管理されます。
Githubなどにブランチを発行したなら、そのURLを用いて`reference`を`GitRef`に変更できます。
`GitRef`は、Gitリポジトリの特定のブランチの特定のコミットを参照します。

```yaml
reference:
  type: GitRef
  ref: git@example.com:my_plugin.git
  branch: master
  commit: first_commit_hash
```

この状態で、あなたが`my_plugin`に新しいコミットをし、`crtb.properties.yml`が更新された場合、`crtb.properties.yml`は以下のようにコミットのハッシュが変わります。

```yaml
components:
  plugins:
    my_plugin:
      reference:
        type: GitRef
        ref: git@example.com:my_plugin.git
        branch: master
        commit: second_commit_hash
```

このように、CRTBはプロジェクト上のすべてのコンポーネントをファイルに保存し、そのファイルからプロジェクトを再現可能にします。
また、この`crtb.properties.yml`は、`crtb.config.yml`(開発サーバーなどの設定ファイル)とあわせてGitで管理することを推奨します。