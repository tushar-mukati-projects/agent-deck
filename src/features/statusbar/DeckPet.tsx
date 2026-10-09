import { useEffect, useState } from "react";

import { focusNextAttention } from "@/actions/workspaces";
import { petLine, petMood, type PetMood } from "@/lib/pet";
import { onAgentIdle } from "@/lib/terminal/activity";

const CELEBRATE_MS = 4000;
const EYE = "var(--color-bg)";
const SPARKS = [
  { x: 2, y: 6, delay: "0s" },
  { x: 20, y: 4, delay: "0.3s" },
  { x: 21, y: 14, delay: "0.6s" },
];

const useCelebration = () => {
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const stop = onAgentIdle((event) => {
      if (event.needsInput) return;
      setCelebrating(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);
  return celebrating;
};

const Eyes = ({ mood }: { mood: PetMood }) => {
  const arc = { stroke: EYE, strokeWidth: 1.3, fill: "none", strokeLinecap: "round" as const };
  if (mood === "sleeping")
    return <path d="M8.6 12.4q1.1 1.1 2.2 0M13.2 12.4q1.1 1.1 2.2 0" {...arc} />;
  if (mood === "celebrating")
    return <path d="M8.6 13q1.1-1.5 2.2 0M13.2 13q1.1-1.5 2.2 0" {...arc} />;
  const r = mood === "waiting" ? 1.6 : 1.25;
  return (
    <g className="pet-look">
      <circle cx="9.7" cy="12" r={r} fill={EYE} />
      <circle cx="14.3" cy="12" r={r} fill={EYE} />
    </g>
  );
};

const Pet = ({ mood }: { mood: PetMood }) => (
  <svg viewBox="0 0 24 24" className="size-[18px] overflow-visible" aria-hidden>
    <g className={`pet-body pet-${mood}`}>
      <path
        d="M5 21V11a7 7 0 0 1 14 0v10l-2.33-1.6-2.33 1.6-2.34-1.6-2.33 1.6-2.34-1.6Z"
        fill="var(--color-accent)"
      />
      <Eyes mood={mood} />
    </g>
    {mood === "sleeping" &&
      ["0s", "1.2s"].map((delay) => (
        <text
          key={delay}
          x="17"
          y="7"
          fontSize="6"
          fontWeight="700"
          fill="var(--color-muted)"
          className="pet-z"
          style={{ animationDelay: delay }}
        >
          z
        </text>
      ))}
    {mood === "waiting" && (
      <text x="19.5" y="7" fontSize="9" fontWeight="800" fill="var(--color-warning)">
        !
      </text>
    )}
    {mood === "celebrating" &&
      SPARKS.map(({ x, y, delay }) => (
        <path
          key={delay}
          d={`M${x} ${y - 2}l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z`}
          fill="var(--color-warning)"
          className="pet-spark"
          style={{ animationDelay: delay }}
        />
      ))}
  </svg>
);

export const DeckPet = ({ busy, waiting }: { busy: number; waiting: number }) => {
  const celebrating = useCelebration();
  const [hops, setHops] = useState(0);
  const mood = petMood(busy, waiting, celebrating);
  const line = petLine(mood, busy, waiting);
  return (
    <button
      type="button"
      title={line}
      aria-label={line}
      onClick={() => (mood === "waiting" ? focusNextAttention() : setHops((n) => n + 1))}
      className="flex h-full items-center px-2 enabled:hover:bg-hover"
    >
      <span key={hops} className={hops ? "pet-hop" : undefined}>
        <Pet mood={mood} />
      </span>
    </button>
  );
};
