const FEMALE =
  /\b(zira|aria|jenny|heera|neerja|hazel|susan|sonia|libby|catherine|linda|eva|michelle|natasha|clara|emma|ava)\b/i;

export interface VoiceLike {
  name: string;
  lang: string;
  default: boolean;
}

const isNatural = (voice: VoiceLike) => /natural/i.test(voice.name);
const isFemale = (voice: VoiceLike) => FEMALE.test(voice.name);

export const pickVoice = <T extends VoiceLike>(voices: T[], wanted: string) => {
  const english = voices.filter((voice) => voice.lang.startsWith("en"));
  return (
    english.find((voice) => voice.name === wanted) ??
    english.find((voice) => isNatural(voice) && isFemale(voice)) ??
    english.find(isFemale) ??
    english.find(isNatural) ??
    english.find((voice) => voice.default) ??
    english[0]
  );
};

export const voiceLabel = (name: string) =>
  name.replace(/^Microsoft\s+/, "").replace(/\s+-\s+/, " · ");

export const englishVoices = () =>
  "speechSynthesis" in window
    ? window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith("en"))
    : [];

export const speak = (text: string, wanted: string) => {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(window.speechSynthesis.getVoices(), wanted);
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
};
