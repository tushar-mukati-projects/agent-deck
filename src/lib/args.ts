export const parseArgs = (raw: string) =>
  (raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((arg) => arg.replace(/"/g, ""));
