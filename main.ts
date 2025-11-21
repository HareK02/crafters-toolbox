const VERSION = "0.0.1";

import { intro, isCancel, log, outro, select } from "npm:@clack/prompts";

import { Command, COMMANDS } from "./scripts/command.ts";

const EXIT_OPTION = "__exit";
const BACK_OPTION = "__back";

const renderBanner = () => {
  console.log(
    [
      "   ____            __ _            _       _____           _ _                \n",
      "  / ___|_ __ __ _ / _| |_ ___ _ __( )___  |_   _|__   ___ | | |__   _____  __ \n",
      " | |   | '__/ _` | |_| __/ _ [ '__|// __|   | |/ _ [ / _ [| | '_ [ / _ [ / /  \n",
      " | |___| | | (_| |  _| ||  __/ |    [__ [   | | (_) | (_) | | |_) | (_) >  <  \n",
      "  [____|_|  [__,_|_|  [__[___|_|    |___/   |_|[___/ [___/|_|_.__/ [___/_/[_[ ",
    ]
      .join("")
      .replace(/\[/g, "\\"),
  );

  console.log(
    `                      [ Version: ${VERSION} | Author: Hare ]\n` +
      "-------------------------------------------------------------------------------",
  );
};

const runCommand = async (command: Command, args: string[]) => {
  const subName = command.subcommands?.find((cmd) => cmd.name === args[0]);
  if (subName) {
    await runCommand(subName, args.slice(1));
    return;
  }
  await command.handler(args);
};

const promptForSubcommand = async (command: Command) => {
  if (!command.subcommands || command.subcommands.length === 0) return null;
  const choice = await select({
    message: `${command.name} のサブコマンドを選択`,
    options: [
      ...command.subcommands.map((sub) => ({
        value: sub.name,
        label: sub.name,
        hint: sub.description,
      })),
      { value: BACK_OPTION, label: "戻る", hint: "前のメニューに戻ります" },
    ],
  });
  if (isCancel(choice) || choice === BACK_OPTION) return null;
  const subcommand = command.subcommands.find((sub) => sub.name === choice);
  if (!subcommand) {
    log.error(`サブコマンド "${choice}" は存在しません。`);
    return null;
  }
  return subcommand;
};

const runInteractiveMenu = async () => {
  renderBanner();
  let exitRequested = false;
  while (!exitRequested) {
    const commandChoice = await select({
      message: "実行するコマンドを選択してください",
      options: [
        ...COMMANDS.map((cmd) => ({
          value: cmd.name,
          label: cmd.name,
          hint: cmd.description,
        })),
        { value: EXIT_OPTION, label: "終了", hint: "CLI を終了します" },
      ],
    });

    if (isCancel(commandChoice) || commandChoice === EXIT_OPTION) {
      exitRequested = true;
      break;
    }

    const command = COMMANDS.find((cmd) => cmd.name === commandChoice);
    if (!command) {
      log.error(`Command "${commandChoice}" not found.`);
      continue;
    }

    log.info(`${command.name}: ${command.description}`);

    const chosenCommand = (await promptForSubcommand(command)) ?? command;
    if (chosenCommand === command && command.subcommands?.length) {
      // user backed out of subcommand selection
      if (command.subcommands.length) continue;
    }

    try {
      await chosenCommand.handler([]);
      log.success(`"${chosenCommand.name}" を実行しました。`);
    } catch (error) {
      log.error(
        `"${chosenCommand.name}" の実行中にエラーが発生しました: ${error}`,
      );
    }
    exitRequested = true;
  }

  outro("Crafter's Toolbox を終了します。");
};

const args = Deno.args;

if (!args[0]) {
  await runInteractiveMenu();
} else {
  const commandName = args[0];
  const command = COMMANDS.find((cmd) => cmd.name === commandName);
  if (command) {
    await runCommand(command, args.slice(1));
  } else {
    console.log(`Command "${commandName}" not found.`);
  }
}
