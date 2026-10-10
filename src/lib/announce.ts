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

export const alertStatus = (agent: string, needsInput: boolean) =>
  needsInput ? `${agent} needs your approval` : `${agent} finished`;

export const announcement = (title: string, agent: string, needsInput: boolean) =>
  `${spokenTitle(title) || "Your session"}. ${alertStatus(agent, needsInput)}.`;

export const newPhoneTopic = (random: (count: number) => Uint8Array) =>
  `deck-${[...random(12)].map((n) => TOPIC_ALPHABET[n % TOPIC_ALPHABET.length]).join("")}`;
