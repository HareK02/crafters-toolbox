# 開発環境

crafters-toolbox上で開発を行っています。
crafters-toolboxはMinecraft用開発環境構築・自動化ツールです。

# プロジェクト構成

Plugin開発：プラグインとして配置するためにcomponents/plugins配下に置きつつ、他のプラグインの依存関係として利用するためにgradleプロジェクトの中にgit経由でsubmoduleとして配置し、依存することが有ります。 dockerでビルドする為、親ディレクトを経由しての依存はできません。

# 注意事項

ビルドを行う際は、必ず作業ディレクトを移動し、ターゲットのプロジェクトルートでビルドコマンドを利用してください。
サーバーに配置する際は、`deno run crtb components update <type>:<name>`を実行してビルドしてデプロイを行ってください。
