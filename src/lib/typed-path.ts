import { resolvePath } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";

const QUOTES = /^["'`]+|["'`]+$/g;
const LOCATION_SUFFIX = /(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/;

const clean = (input: string) => {
  let value = input.trim().replace(QUOTES, "").trim();
  if (value.startsWith("@")) value = value.slice(1);
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(value.replace(/^file:\/\/\/?/i, ""));
    } catch {
      return "";
    }
    if (/^[a-zA-Z]:/.test(value) === false && !value.startsWith("/")) value = `/${value}`;
  }
  return value.replace(LOCATION_SUFFIX, "");
};

const looksLikePath = (value: string) =>
  !!value &&
  !/[\r\n]/.test(value) &&
  (/[\\/]/.test(value) || /^[a-zA-Z]:$/.test(value) || /^[^\s]+\.[A-Za-z0-9]{1,10}$/.test(value));

const wslHost = (distro: string, linuxPath: string) =>
  `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, "\\")}`;

const userHome = (linuxPath: string) => /^\/home\/[^/]+/.exec(linuxPath)?.[0] ?? "/root";

export const parseTypedPath = (input: string, cwd: string, windowsHome: string): string | null => {
  const value = clean(input);
  if (!looksLikePath(value)) return null;
  const wsl = parseWslPath(cwd);

  if (/^[a-zA-Z]:([\\/]|$)/.test(value)) return resolvePath(value.slice(0, 2), value.slice(2));
  if (value.startsWith("\\\\")) return resolvePath(value, "");
  if (value.startsWith("~")) {
    const rest = value.slice(1);
    if (wsl) return wslHost(wsl.distro, `${userHome(wsl.linuxPath)}${rest.replace(/\\/g, "/")}`);
    return resolvePath(windowsHome, rest);
  }
  if (value.startsWith("/")) {
    if (wsl) return wslHost(wsl.distro, value.replace(/\/+$/, "") || "/");
    const drive = /^\/([a-zA-Z])(\/.*|$)/.exec(value);
    return drive ? resolvePath(`${drive[1].toUpperCase()}:`, drive[2]) : null;
  }
  return resolvePath(cwd, value);
};
