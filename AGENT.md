# 開発環境

crafters-toolbox上で開発を行っています。
crafters-toolboxはMinecraft用開発環境構築・自動化ツールです。

# Git

プロジェクトのcomponents配下は、Gitによって管理されていません。
各componentsは独立したプロジェクトで、ビルドツールの関係から、ディレクトリ内に閉じた依存関係に限定されます。

# 注意事項

ビルドを行う際は、必ず作業ディレクトを移動し、ターゲットのプロジェクトルートでビルドコマンドを利用してください。
サーバーに配置する際は、`deno run crtb components update <type>:<name>`を実行してビルドしてデプロイを行ってください。
