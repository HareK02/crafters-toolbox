type TerminalLike = {
  isTerminal?: () => boolean;
};

export function isTerminal(stream: unknown): boolean {
  const candidate = stream as TerminalLike | undefined | null;
  if (!candidate) return false;
  return typeof candidate.isTerminal === "function" && candidate.isTerminal();
}
