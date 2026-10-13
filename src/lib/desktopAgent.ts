export const DESKTOP_AGENT_OPT_IN_ID = "winpilot-protects-terminals";

const PROTECTED_PREFIX = "winpilot-protected-terminal-";

export const protectedTerminalId = (terminalId: string) =>
  `${PROTECTED_PREFIX}${terminalId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
