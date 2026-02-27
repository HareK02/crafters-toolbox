/**
 * コンポーネント処理のステータス表示管理
 */
import logUpdate from "log-update";
import cliSpinners from "cli-spinners";

const STREAM_COMPONENT_LOGS = !(
  Deno.env.get("CRTB_COMPONENTS_STREAM_LOGS") === "0"
);
export const IS_TTY = !STREAM_COMPONENT_LOGS && Deno.stdout.isTerminal();

let currentStatusManager: ReturnType<typeof createStatusManager> | undefined;

export const getCurrentStatusManager = () => currentStatusManager;
export const setCurrentStatusManager = (
  manager: ReturnType<typeof createStatusManager> | undefined,
) => {
  currentStatusManager = manager;
};

export const safeLog = (message: string, isError = false) => {
  logUpdate.clear();
  (isError ? console.error : console.log)(message);
  currentStatusManager?.render();
};

export const warn = (message: string) => safeLog(message, true);
export const info = (message: string) => safeLog(message, false);

type SpinnerState = {
  phase: string;
  message?: string;
  state: "running" | "succeed" | "fail";
  frame: number;
};

export const createStatusManager = (totalCount: number) => {
  const spinner = cliSpinners.dots;
  const states = new Map<string, SpinnerState>();
  const order: string[] = [];
  let timer: number | undefined;
  let lastRender: string | undefined;

  const render = () => {
    if (!IS_TTY) return;
    const names = order;
    const maxName = names.reduce((m, name) => Math.max(m, name.length), 0);
    const completed = names.filter((name) => {
      const state = states.get(name);
      return state?.state === "succeed";
    }).length;

    const lines: string[] = [`Processing... [${completed}/${totalCount}]`];
    names.forEach((name) => {
      const state = states.get(name);
      if (!state) return;
      const icon = state.state === "running"
        ? spinner.frames[state.frame % spinner.frames.length]
        : state.state === "succeed"
        ? "✓"
        : "✗";
      const label = `${name.padEnd(maxName)} [${
        state.phase.padEnd(
          10,
        )
      } ${icon}]`;
      lines.push(`  ${label}`);
    });

    const output = lines.join("\n");
    if (output === lastRender) return;
    lastRender = output;
    logUpdate(output);
  };

  const tick = () => {
    for (const state of states.values()) {
      if (state.state === "running") state.frame += 1;
    }
    render();
  };

  const ensureTimer = () => {
    if (timer === undefined) {
      timer = setInterval(tick, spinner.interval) as unknown as number;
    }
  };

  const stopTimerIfDone = () => {
    if ([...states.values()].every((s) => s.state !== "running")) {
      if (timer !== undefined) {
        clearInterval(timer as number);
        timer = undefined;
      }
      render();
      if (IS_TTY) logUpdate.done();
    }
  };

  return {
    start: (name: string, phase: string, message?: string) => {
      states.set(name, { phase, message, state: "running", frame: 0 });
      if (!order.includes(name)) order.push(name);
      if (!IS_TTY) {
        console.log(`${name} [${phase}] ${message ?? ""}`);
        return;
      }
      ensureTimer();
      tick();
    },
    update: (name: string, phase: string, message?: string) => {
      const s = states.get(name) ?? { phase, state: "running", frame: 0 };
      s.phase = phase;
      s.message = message;
      s.state = "running";
      states.set(name, s);
      if (!IS_TTY) {
        console.log(`${name} [${phase}] ${message ?? ""}`);
        return;
      }
      tick();
    },
    succeed: (name: string, message?: string) => {
      if (!IS_TTY) {
        console.log(`${name} [done] ${message ?? ""}`);
        return;
      }
      const s = states.get(name);
      if (s) {
        s.state = "succeed";
        s.message = message;
      }
      tick();
      stopTimerIfDone();
    },
    fail: (name: string, message?: string) => {
      if (!IS_TTY) {
        console.error(`${name} [fail] ${message ?? ""}`);
        return;
      }
      const s = states.get(name);
      if (s) {
        s.state = "fail";
        s.message = message;
      }
      tick();
      stopTimerIfDone();
    },
    render,
    stop: () => {
      if (!IS_TTY) return;
      if (timer !== undefined) clearInterval(timer as number);
      timer = undefined;
      render();
      lastRender = undefined;
      logUpdate.done();
    },
  };
};

export type StatusManager = ReturnType<typeof createStatusManager>;
