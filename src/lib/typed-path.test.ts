import { describe, expect, it } from "vitest";

import { parseTypedPath } from "@/lib/typed-path";

const win = String.raw`C:\Users\me\my-files\site`;
const home = String.raw`C:\Users\me`;
const wsl = String.raw`\\wsl.localhost\Debian\home\me\work\app`;

describe("parseTypedPath", () => {
  it.each([
    [String.raw`C:\Users\me\notes.md`, win, String.raw`C:\Users\me\notes.md`],
    ["C:/Users/me/notes.md", win, String.raw`C:\Users\me\notes.md`],
    [String.raw`"C:\Users\me\my file.md"`, win, String.raw`C:\Users\me\my file.md`],
    ["src/App.tsx:12:4", win, String.raw`C:\Users\me\my-files\site\src\App.tsx`],
    ["./README.md", win, String.raw`C:\Users\me\my-files\site\README.md`],
    ["../dev/x.ts", win, String.raw`C:\Users\me\my-files\dev\x.ts`],
    ["README.md", win, String.raw`C:\Users\me\my-files\site\README.md`],
    ["@src/main.tsx", win, String.raw`C:\Users\me\my-files\site\src\main.tsx`],
    ["/c/Users/me/a.txt", win, String.raw`C:\Users\me\a.txt`],
    ["~/x/y.md", win, String.raw`C:\Users\me\x\y.md`],
    ["file:///C:/Users/me/a%20b.md", win, String.raw`C:\Users\me\a b.md`],
    [
      "/home/me/work/app/src/app.py",
      wsl,
      String.raw`\\wsl.localhost\Debian\home\me\work\app\src\app.py`,
    ],
    ["~/.bashrc", wsl, String.raw`\\wsl.localhost\Debian\home\me\.bashrc`],
    [
      "src/app.py#L10-L20",
      wsl,
      String.raw`\\wsl.localhost\Debian\home\me\work\app\src\app.py`,
    ],
    [
      String.raw`\\wsl.localhost\Debian\etc\hosts`,
      win,
      String.raw`\\wsl.localhost\Debian\etc\hosts`,
    ],
  ])("%s → %s", (input, cwd, expected) => expect(parseTypedPath(input, cwd, home)).toBe(expected));

  it.each(["hello world", "fix the bug", "", "   ", "sessions"])("ignores %j", (input) =>
    expect(parseTypedPath(input, win, home)).toBeNull(),
  );
});
