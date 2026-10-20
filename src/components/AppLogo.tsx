import { SquareTerminal } from "lucide-react";

import { useSettingsStore } from "@/stores/settings-store";
import { useWarpLogoStore } from "@/stores/warp-logo-store";

type AppLogoProps = {
  className?: string;
};

export const AppLogo = ({ className }: AppLogoProps) => {
  const hidden = useSettingsStore((s) => s.hideMode);
  const warpLogo = useWarpLogoStore((s) => s.warpLogo);
  const src = hidden ? warpLogo : "/app-icon.svg";
  return src ? (
    <img src={src} alt="" className={className} />
  ) : (
    <SquareTerminal className={className} />
  );
};
