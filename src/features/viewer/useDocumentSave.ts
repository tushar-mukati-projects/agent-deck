import { useCallback, useRef } from "react";

import { saveFile, type Reload, type TextContent } from "@/actions/files";

export const useDocumentSave = (path: string, content: TextContent | null, reload: Reload) => {
  const contentRef = useRef(content);
  contentRef.current = content;
  return useCallback(() => {
    const base = contentRef.current;
    if (base) void saveFile(path, base, reload);
  }, [path, reload]);
};
