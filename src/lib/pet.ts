import { plural } from "@/lib/utils";

export type PetMood = "sleeping" | "working" | "waiting" | "celebrating";

export const petMood = (busy: number, waiting: number, celebrating: boolean): PetMood =>
  waiting > 0 ? "waiting" : celebrating ? "celebrating" : busy > 0 ? "working" : "sleeping";

export const petLine = (mood: PetMood, busy: number, waiting: number) => {
  switch (mood) {
    case "waiting":
      return `Deckie is waving: ${plural(waiting, "session")} ${waiting === 1 ? "needs" : "need"} you. Click to jump there.`;
    case "celebrating":
      return "Deckie is celebrating: a session just finished!";
    case "working":
      return `Deckie is working with you: ${plural(busy, "session")} busy.`;
    default:
      return "Deckie is napping. Nothing is running right now.";
  }
};
