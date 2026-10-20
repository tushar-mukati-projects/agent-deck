import { useFileVersion } from "@/features/viewer/useFileContent";
import { assetUrl } from "@/lib/tauri/system";
import { basename } from "@/lib/utils";
import type { ViewKind } from "@/lib/view-kind";

export type MediaKind = Exclude<ViewKind, "text" | "markdown">;

type MediaFrameProps = {
  children: React.ReactNode;
};

const MediaFrame = ({ children }: MediaFrameProps) => (
  <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(color-mix(in_srgb,var(--color-fg)_6%,transparent)_1px,transparent_1px)] [background-size:16px_16px] p-6">
    {children}
  </div>
);

type MediaViewProps = {
  path: string;
  kind: MediaKind;
};

export const MediaView = ({ path, kind }: MediaViewProps) => {
  const version = useFileVersion(path);
  const src = version ? `${assetUrl(path)}?v=${version}` : assetUrl(path);
  if (kind === "pdf")
    return <iframe title={basename(path)} src={src} className="h-full w-full border-0 bg-paper" />;
  return (
    <MediaFrame>
      {kind === "image" && (
        <img
          src={src}
          alt={basename(path)}
          className="max-h-full max-w-full rounded shadow-2xl shadow-shadow"
        />
      )}
      {kind === "video" && <video src={src} controls className="max-h-full max-w-full rounded" />}
      {kind === "audio" && <audio src={src} controls />}
    </MediaFrame>
  );
};
