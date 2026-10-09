const MAX_WORDS = 8;
const MAX_CHARS = 60;
const TOPIC_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export const spokenTitle = (title: string) => {
  const words = title
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const short = words.slice(0, MAX_WORDS).join(" ");
  return short.length > MAX_CHARS ? short.slice(0, MAX_CHARS).replace(/\s+\S*$/, "") : short;
};

export const announcement = (title: string, needsInput: boolean) => {
  const subject = spokenTitle(title) || "Your session";
  return needsInput ? `${subject} needs your approval.` : `${subject} is done.`;
};

export const newPhoneTopic = (random: (count: number) => Uint8Array) =>
  `deck-${[...random(12)].map((n) => TOPIC_ALPHABET[n % TOPIC_ALPHABET.length]).join("")}`;
