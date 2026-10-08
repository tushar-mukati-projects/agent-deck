import { SquareTerminal } from "lucide-react";

import { useWarpLogo } from "@/actions/hide-mode";
import { useSettingsStore } from "@/stores/settings-store";

export const AppLogo = ({ className }: { className?: string }) => {
  const hidden = useSettingsStore((s) => s.hideMode);
  const warpLogo = useWarpLogo((s) => s.src);
  const src = hidden ? warpLogo : "/app-icon.svg";
  return src ? (
    <img src={src} alt="" className={className} />
  ) : (
    <SquareTerminal className={className} />
  );
};
