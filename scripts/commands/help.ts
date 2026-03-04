import { Command } from "../command.ts";

const SECTION = (title: string) =>
  `\n\x1b[1;33m${title}\x1b[0m`;

const CMD = (name: string) => `\x1b[1;36m${name}\x1b[0m`;
const DIM = (text: string) => `\x1b[2m${text}\x1b[0m`;

const USAGE_GLOBAL = `\
\x1b[1mCrafter's Toolbox\x1b[0m — Minecraft サーバー/クライアント管理 CLI

${SECTION("使い方")}
  crtb [command] [subcommand] [options]
  crtb                    # 対話型メニューを起動
  crtb --help, -h         # このヘルプを表示
  crtb <command> --help   # コマンド個別のヘルプを表示

${SECTION("コマンド一覧")}
  ${CMD("init")}         [dir] [--no-prompt]
                    プロジェクトを初期化する

  ${CMD("setup")}        [--server]
                    サーバー jar のダウンロードと Docker イメージ確認

  ${CMD("server")}       start | stop | restart
                    ゲームサーバーコンテナを管理する

  ${CMD("client")}       start
                    クライアント環境をセットアップして起動する

  ${CMD("components")}   list | import | update | pull
                    コンポーネントを管理する

  ${CMD("ssh")}          start | stop | keys ...
                    SSH コラボコンテナを管理する

  ${CMD("terminal")}     [game | ssh | monitor]
                    実行中コンテナのコンソールにアタッチする

${SECTION("例")}
  crtb init ./my-server
  crtb setup
  crtb server start
  crtb ssh keys add --file ~/.ssh/id_ed25519.pub
  crtb components update
  crtb terminal game

${DIM("詳細: crtb <command> --help")}
`;

const COMMAND_DETAILS: Record<string, string> = {
  init: `\
${CMD("crtb init")} [dir] [--no-prompt]

${SECTION("説明")}
  新しい Crafter's Toolbox プロジェクトを初期化します。
  対話形式でサーバータイプ・バージョン・メモリ・SSH 設定などを入力できます。

${SECTION("引数")}
  [dir]          初期化先ディレクトリ (省略時: カレントディレクトリ)

${SECTION("オプション")}
  --no-prompt    対話なしでデフォルト設定を使用する

${SECTION("生成ファイル")}
  crtb.properties.yml   サーバー種別・バージョン・コンポーネント定義
  crtb.config.yml       メモリ・SSH 設定
  .gitignore

${SECTION("対応サーバータイプ")}
  vanilla, paper, spigot, forge, fabric, bukkit, neoforge
`,

  setup: `\
${CMD("crtb setup")} [--server]

${SECTION("説明")}
  サーバー jar のダウンロードと Docker イメージの確認を行います。
  crtb.properties.yml を参照します。

${SECTION("オプション")}
  --server       サーバー jar のダウンロードのみ実行 (Docker 確認をスキップ)

${SECTION("備考")}
  jar 自動ダウンロード対応: vanilla / paper / fabric / neoforge
  その他の種別は server.jar を手動で配置してください。
`,

  server: `\
${CMD("crtb server")} [start | stop | restart]

${SECTION("説明")}
  ゲームサーバーコンテナを管理します。
  サブコマンドなし: コンテナの状態を表示します。

${SECTION("サブコマンド")}
  start      コンテナをデタッチモードで起動し、コンソールにアタッチする
  stop       実行中のコンテナを停止する
  restart    コンテナを再起動する
`,

  client: `\
${CMD("crtb client")} start

${SECTION("説明")}
  クライアント環境 (./minecraft) をセットアップして Minecraft を起動します。
  crtb.properties.yml に定義された mod / resourcepack コンポーネントを配置します。

${SECTION("サブコマンド")}
  start      環境を準備してクライアントを起動する

${SECTION("環境変数")}
  CRTB_PLAYER_NAME   プレイヤー名 (省略時: Dev)
  JAVA_HOME          Java パス (省略時: PATH から java を使用)
`,

  components: `\
${CMD("crtb components")} [list | import | update | pull]

${SECTION("説明")}
  コンポーネント (mod, resourcepack, plugin など) を管理します。
  サブコマンドなし: コンポーネント一覧を表示します。

${SECTION("サブコマンド")}
  list              登録済みコンポーネントを一覧表示する
  import [names...]  ./components から未登録コンポーネントを crtb.properties.yml に登録する
  update [names...]  コンポーネントをビルド・配置する
  pull   [names...]  リモートからソースを取得して更新する (ローカル変更は上書き)

${SECTION("備考")}
  names を省略すると全コンポーネントが対象になります。
`,

  ssh: `\
${CMD("crtb ssh")} [start | stop | keys ...]

${SECTION("説明")}
  SSH コラボコンテナを管理します。
  サブコマンドなし: コンテナと認証の状態を表示します。
  crtb.config.yml の ssh.enabled: true が必要です。

${SECTION("サブコマンド")}
  start                     SSH コンテナをデタッチモードで起動する
  stop                      SSH コンテナを停止する
  keys                      authorized_keys の一覧を表示する
  keys list                 authorized_keys の一覧を表示する
  keys add <key>            公開鍵を追加する
  keys add --file <path>    ファイルから公開鍵を追加する
  keys remove <index>       インデックス番号で公開鍵を削除する
  keys path                 authorized_keys のファイルパスを表示する
`,

  terminal: `\
${CMD("crtb terminal")} [game | ssh | monitor]

${SECTION("説明")}
  実行中の Docker コンテナのコンソールにアタッチします。

${SECTION("引数")}
  game      ゲームサーバーコンテナ (デフォルト)
  ssh       SSH コラボコンテナ
  monitor   モニターコンテナ
`,
};

export function showGlobalHelp(): void {
  console.log(USAGE_GLOBAL);
}

export function showCommandHelp(command: Command): void {
  const detail = COMMAND_DETAILS[command.name];
  if (detail) {
    console.log(detail);
    return;
  }

  // フォールバック: コマンド定義から自動生成
  console.log(`\n${CMD(`crtb ${command.name}`)}\n`);
  console.log(`${command.description}\n`);
  if (command.subcommands?.length) {
    console.log(SECTION("サブコマンド"));
    for (const sub of command.subcommands) {
      console.log(`  ${sub.name.padEnd(12)} ${sub.description}`);
    }
    console.log("");
  }
}
