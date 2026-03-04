const VERSION = "0.0.1";

import { isCancel, log, select } from "@clack/prompts";

import { Command, COMMANDS } from "./scripts/command.ts";
import { showCommandHelp, showGlobalHelp } from "./scripts/commands/help.ts";

const EXIT_OPTION = "__exit";
const BACK_OPTION = "__back";
const OTHERS_OPTION = "__others";

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
  if (!command.subcommands || command.subcommands.length === 0) {
    return undefined;
  }
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

const runInteractiveCommand = async (command: Command) => {
  const subcommand = await promptForSubcommand(command);
  if (subcommand === null) return;
  const chosen = subcommand ?? command;
  try {
    if (chosen.interactiveHandler) {
      await chosen.interactiveHandler();
    } else {
      await chosen.handler([]);
    }
  } catch (error) {
    log.error(`"${chosen.name}" の実行中にエラーが発生しました: ${error}`);
  }
};

const runInteractiveMenu = async () => {
  renderBanner();

  const mainCommands = COMMANDS.filter((cmd) => !cmd.hidden);
  const hiddenCommands = COMMANDS.filter((cmd) => cmd.hidden);
  const hasOthers = hiddenCommands.length > 0;

  let exitRequested = false;
  while (!exitRequested) {
    const commandChoice = await select({
      message: "実行するコマンドを選択してください",
      options: [
        ...mainCommands.map((cmd) => ({
          value: cmd.name,
          label: cmd.name,
          hint: cmd.description,
        })),
        ...(hasOthers
          ? [{
            value: OTHERS_OPTION,
            label: "others...",
            hint: hiddenCommands.map((c) => c.name).join(", "),
          }]
          : []),
        { value: EXIT_OPTION, label: "終了", hint: "CLI を終了します" },
      ],
    });

    if (isCancel(commandChoice) || commandChoice === EXIT_OPTION) {
      exitRequested = true;
      break;
    }

    if (commandChoice === OTHERS_OPTION) {
      const otherChoice = await select({
        message: "others",
        options: [
          ...hiddenCommands.map((cmd) => ({
            value: cmd.name,
            label: cmd.name,
            hint: cmd.description,
          })),
          { value: BACK_OPTION, label: "戻る", hint: "メインメニューに戻ります" },
        ],
      });
      if (isCancel(otherChoice) || otherChoice === BACK_OPTION) continue;
      const command = hiddenCommands.find((cmd) => cmd.name === otherChoice);
      if (command) await runInteractiveCommand(command);
      continue;
    }

    const command = mainCommands.find((cmd) => cmd.name === commandChoice);
    if (!command) {
      log.error(`Command "${commandChoice}" not found.`);
      continue;
    }
    await runInteractiveCommand(command);
  }
};

const args = Deno.args;

if (!args[0]) {
  await runInteractiveMenu();
} else if (args[0] === "--help" || args[0] === "-h") {
  showGlobalHelp();
} else {
  const commandName = args[0];
  const command = COMMANDS.find((cmd) => cmd.name === commandName);
  if (command) {
    const restArgs = args.slice(1);
    if (restArgs.includes("--help") || restArgs.includes("-h")) {
      showCommandHelp(command);
    } else {
      await runCommand(command, restArgs);
    }
  } else {
    console.log(`Command "${commandName}" not found. Run 'crtb --help' for usage.`);
  }
}
