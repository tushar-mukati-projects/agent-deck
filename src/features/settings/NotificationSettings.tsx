import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { showError } from "@/components/ui/feedback";
import { Input, selectClass } from "@/components/ui/input";
import { Field, OnOffToggle, Toggle } from "@/features/settings/fields";
import { announcement, newPhoneTopic } from "@/lib/announce";
import { playChime } from "@/lib/chime";
import { englishVoices, pickVoice, speak, voiceLabel } from "@/lib/speech";
import { api } from "@/lib/tauri/commands";
import { useSettingsStore } from "@/stores/settings-store";

const PhonePing = () => {
  const enabled = useSettingsStore((s) => s.phonePing);
  const topic = useSettingsStore((s) => s.phoneTopic);
  const [testing, setTesting] = useState(false);
  const turn = (on: boolean) =>
    useSettingsStore.getState().set(
      on
        ? {
            phonePing: true,
            phoneTopic: topic || newPhoneTopic((n) => crypto.getRandomValues(new Uint8Array(n))),
          }
        : { phonePing: false },
    );
  const sendTest = async () => {
    setTesting(true);
    try {
      await api.phonePing(topic, "Test ping", "Phone pings are working.", false);
      toast.success("Test ping sent");
    } catch (error) {
      showError(error);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      <OnOffToggle value={enabled} onChange={turn} />
      {enabled && (
        <div className="flex items-center gap-2">
          <Input
            aria-label="ntfy topic"
            value={topic}
            spellCheck={false}
            onChange={(event) =>
              useSettingsStore.getState().set({ phoneTopic: event.target.value.trim() })
            }
            className="max-w-[280px] font-mono"
          />
          <Button size="sm" disabled={testing || !topic} onClick={() => void sendTest()}>
            Send test
          </Button>
        </div>
      )}
    </div>
  );
};

const VoicePicker = () => {
  const voice = useSettingsStore((s) => s.voice);
  const [voices, setVoices] = useState(englishVoices);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () => setVoices(englishVoices());
    window.speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  const automatic = pickVoice(voices, "");
  return (
    <select
      aria-label="Voice"
      value={voices.some((v) => v.name === voice) ? voice : ""}
      onChange={(event) => useSettingsStore.getState().set({ voice: event.target.value })}
      className={selectClass}
    >
      <option value="">Automatic{automatic ? ` (${voiceLabel(automatic.name)})` : ""}</option>
      {voices.map((v) => (
        <option key={v.name} value={v.name}>
          {voiceLabel(v.name)}
        </option>
      ))}
    </select>
  );
};

export const NotificationsSection = () => (
  <>
    <Field
      label="Desktop notifications"
      hint="Shown when an agent finishes or needs approval in a session you're not looking at."
    >
      <Toggle field="notifications" />
    </Field>
    <Field label="Sound" hint="A short chime whenever an agent finishes a turn.">
      <div className="flex items-center gap-2">
        <Toggle field="sound" off="Silent" />
        <Button size="sm" variant="ghost" onClick={() => void playChime("done")}>
          Play sample
        </Button>
      </div>
    </Field>
    <Field
      label="Spoken announcements"
      hint="Says the session's name out loud when it finishes or needs your approval and you're not looking at it. Automatic picks a female voice when one is installed. For more voices, add them in Windows Settings › Time & language › Speech, for example English (India) with Heera."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Toggle field="speech" />
        <VoicePicker />
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            speak(announcement("Your session", "Claude", false), useSettingsStore.getState().voice)
          }
        >
          Try it
        </Button>
      </div>
    </Field>
    <Field
      label="Phone ping"
      hint="Pings your phone when a session finishes or needs approval while Deck isn't focused, in hide mode too. Install the free ntfy app, tap +, and subscribe to the topic below. Pings go through ntfy.sh, so anyone who knows the topic can read them; keep it hard to guess."
    >
      <PhonePing />
    </Field>
  </>
);
