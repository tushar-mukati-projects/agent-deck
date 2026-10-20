import { create } from "zustand";

type WarpLogoState = {
  warpLogo: string | null;
};

export const useWarpLogoStore = create<WarpLogoState>(() => ({ warpLogo: null }));
