export const parseArgs = (raw: string) => {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
    } else if (quote === '"') {
      if (char === "\\" && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quote = null;
      else current += char;
    } else if (char === "\\" && (next === '"' || next === "'")) {
      current += next;
      started = true;
      i += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
};
