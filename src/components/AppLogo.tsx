import { SquareTerminal } from "lucide-react";

import { useHideModeStore } from "@/stores/hide-mode-store";
import { useSettingsStore } from "@/stores/settings-store";

type AppLogoProps = {
  className?: string;
};

export const AppLogo = ({ className }: AppLogoProps) => {
  const hidden = useSettingsStore((s) => s.hideMode);
  const warpLogo = useHideModeStore((s) => s.warpLogo);
  const src = hidden ? warpLogo : "/app-icon.svg";
  return src ? (
    <img src={src} alt="" className={className} />
  ) : (
    <SquareTerminal className={className} />
  );
};
