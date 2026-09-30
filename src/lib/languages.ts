import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

import { DOCKERFILE_NAME } from "@/lib/utils";

const BY_FILENAME: [RegExp, string][] = [
  [DOCKERFILE_NAME, "Dockerfile"],
  [/^\.env(\..+)?$/i, "Properties files"],
  [/^\.(bashrc|bash_profile|bash_aliases|zshrc|zprofile|profile)$/i, "Shell"],
];

export const findLanguage = (fileName: string) => {
  const match = LanguageDescription.matchFilename(languages, fileName);
  if (match) return match;
  const name = BY_FILENAME.find(([pattern]) => pattern.test(fileName))?.[1];
  return languages.find((language) => language.name === name) ?? null;
};
