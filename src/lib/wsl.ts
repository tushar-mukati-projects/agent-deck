const WSL_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"];

interface WslLocation {
  distro: string;
  linuxPath: string;
}

export const parseWslPath = (path: string): WslLocation | null => {
  const lower = path.toLowerCase();
  const prefix = WSL_PREFIXES.find((p) => lower.startsWith(p));
  if (!prefix) return null;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("\\");
  const distro = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? "" : rest.slice(slash + 1);
  return { distro, linuxPath: `/${tail.replace(/\\/g, "/")}`.replace(/\/+$/, "") || "/" };
};

export const shellQuote = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'"'"'`)}'`;

export const wslDisplayPath = (location: WslLocation) =>
  `${location.distro}: ${location.linuxPath.replace(/^\/home\/[^/]+(?=\/|$)/, "~")}`;
