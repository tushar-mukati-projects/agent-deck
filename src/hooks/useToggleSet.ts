import { useCallback, useState } from "react";

import { toggled } from "@/lib/utils";

export const useToggleSet = <T>(initial: Iterable<T> = []) => {
  const [values, setValues] = useState<ReadonlySet<T>>(() => new Set(initial));
  const toggle = useCallback((value: T) => setValues((current) => toggled(current, value)), []);
  return [values, toggle] as const;
};
