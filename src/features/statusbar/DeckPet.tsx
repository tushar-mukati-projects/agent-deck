import { useEffect, useState } from "react";

import { focusNextAttention } from "@/actions/workspaces";
import { petLine, petMood, type PetMood } from "@/lib/pet";
import { onAgentIdle } from "@/lib/terminal/activity";
import { cn } from "@/lib/utils";

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

const Layer = ({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) => (
  <span className={cn("absolute inset-0", className)} style={style}>
    <svg viewBox="0 0 24 24" className="size-full overflow-visible">
      {children}
    </svg>
  </span>
);

const ClosedEyes = ({ mood }: { mood: PetMood }) => (
  <path
    d={
      mood === "sleeping"
        ? "M8.6 12.4q1.1 1.1 2.2 0M13.2 12.4q1.1 1.1 2.2 0"
        : "M8.6 13q1.1-1.5 2.2 0M13.2 13q1.1-1.5 2.2 0"
    }
    stroke={EYE}
    strokeWidth={1.3}
    fill="none"
    strokeLinecap="round"
  />
);

const Pet = ({ mood }: { mood: PetMood }) => {
  const open = mood === "working" || mood === "waiting";
  const r = mood === "waiting" ? 1.6 : 1.25;
  return (
    <span className="relative block size-[18px]" aria-hidden>
      <span className={`pet-body pet-${mood} absolute inset-0`}>
        <Layer>
          <path
            d="M5 21V11a7 7 0 0 1 14 0v10l-2.33-1.6-2.33 1.6-2.34-1.6-2.33 1.6-2.34-1.6Z"
            fill="var(--color-accent)"
          />
          {!open && <ClosedEyes mood={mood} />}
        </Layer>
        {open && (
          <Layer className="pet-look">
            <circle cx="9.7" cy="12" r={r} fill={EYE} />
            <circle cx="14.3" cy="12" r={r} fill={EYE} />
          </Layer>
        )}
      </span>
      {mood === "sleeping" &&
        ["0s", "1.2s"].map((delay) => (
          <Layer key={delay} className="pet-z" style={{ animationDelay: delay }}>
            <text x="17" y="7" fontSize="6" fontWeight="700" fill="var(--color-muted)">
              z
            </text>
          </Layer>
        ))}
      {mood === "waiting" && (
        <Layer>
          <text x="19.5" y="7" fontSize="9" fontWeight="800" fill="var(--color-warning)">
            !
          </text>
        </Layer>
      )}
      {mood === "celebrating" &&
        SPARKS.map(({ x, y, delay }) => (
          <Layer
            key={delay}
            className="pet-spark"
            style={{
              animationDelay: delay,
              transformOrigin: `${(x / 24) * 100}% ${(y / 24) * 100}%`,
            }}
          >
            <path
              d={`M${x} ${y - 2}l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z`}
              fill="var(--color-warning)"
            />
          </Layer>
        ))}
    </span>
  );
};

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
