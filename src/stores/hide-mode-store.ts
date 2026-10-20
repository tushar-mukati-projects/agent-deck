import { create } from "zustand";

type HideModeState = {
  warpLogo: string | null;
};

export const useHideModeStore = create<HideModeState>(() => ({ warpLogo: null }));
