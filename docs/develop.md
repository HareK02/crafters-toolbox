# ビルドとアーティファクトの指定（簡易）

`crtb.properties.yml` では、コンポーネントごとに以下を指定できます。

```yaml
components:
  plugins:
    my_plugin:
      source:                # 取得方法
        type: git | http | local
        url: git@github.com:you/repo.git   # git/http の場合
        path: ./components/plugins/my_plugin # local の場合
        branch: main         # git 任意
        commit: <hash>       # git 任意
      build:                 # 取得後にビルドする場合（省略可）
        type: gradle | custom | none
        task: shadowJar      # gradle の場合
        command: "./build.sh" # custom の場合
        workdir: sub/dir     # custom の場合の実行パス（任意）
        output: build/libs   # 成果物パス（workdir からの相対も可）
      artifact:              # 配置対象となる成果物の形
        type: jar | dir | zip | raw
        path: build/libs     # 成果物までのパス（build.output があれば省略可）
```

- `source` … 取得方法。`git` は `url/branch/commit` を指定できます。
- `build` … `type` を `gradle` または `custom` にすると runner イメージ上でビルドします。runner イメージは `crtb.config.yml` の `runner.java_base_image` で指定（デフォルト `eclipse-temurin:21-jdk`）。
- `artifact` … ビルド後にどのファイル/ディレクトリを配置するかを指定します。`type` を省略した場合、plugin/mod は `jar`、datapack/resourcepack/world は `dir` を仮定します。
