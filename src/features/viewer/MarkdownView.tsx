import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { assetUrl, openExternal } from "@/lib/tauri/system";
import { splitFrontmatter } from "@/lib/frontmatter";
import { cn, resolvePath } from "@/lib/utils";

interface MarkdownViewProps {
  source: string;
  baseDir?: string;
  onOpenPath?: (path: string) => void;
  className?: string;
  compact?: boolean;
}

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
    p: [...(defaultSchema.attributes?.p ?? []), "align"],
    div: [...(defaultSchema.attributes?.div ?? []), "align"],
  },
};

const isExternal = (href: string) => /^(https?:|mailto:)/i.test(href);
const isAbsoluteLocal = (href: string) => /^[a-zA-Z]:[\\/]/.test(href) || href.startsWith("\\\\");

const buildComponents = (baseDir?: string, onOpenPath?: (path: string) => void): Components => ({
  a: ({ href = "", children, ...props }) => {
    const handleClick = (event: React.MouseEvent) => {
      event.preventDefault();
      if (!href || href.startsWith("#")) return;
      if (isExternal(href)) {
        void openExternal(href);
        return;
      }
      const target = decodeURIComponent(href.split("#")[0]);
      const resolved = isAbsoluteLocal(target) || !baseDir ? target : resolvePath(baseDir, target);
      onOpenPath?.(resolved);
    };
    return (
      <a {...props} href={href} onClick={handleClick} title={href}>
        {children}
      </a>
    );
  },
  img: ({ src = "", alt, ...props }) => {
    const source = typeof src === "string" ? src : "";
    const resolved =
      !source || /^(https?:|data:)/i.test(source)
        ? source
        : assetUrl(
            isAbsoluteLocal(source) || !baseDir
              ? source
              : resolvePath(baseDir, decodeURIComponent(source)),
          );
    return (
      <img {...props} src={resolved} alt={alt ?? ""} loading="lazy" className="inline rounded-md" />
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
});

const Frontmatter = ({ fields }: { fields: [string, string][] }) => (
  <dl className="not-prose mb-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-panel px-3.5 py-2.5 text-[12px]">
    {fields.map(([key, value]) => (
      <div key={key} className="contents">
        <dt className="font-mono text-[11px] text-faint">{key}</dt>
        <dd className="min-w-0 break-words text-fg/85">{value}</dd>
      </div>
    ))}
  </dl>
);

export const MarkdownView = memo(
  ({ source, baseDir, onOpenPath, className, compact }: MarkdownViewProps) => {
    const components = useMemo(() => buildComponents(baseDir, onOpenPath), [baseDir, onOpenPath]);
    const { fields, body } = useMemo(() => splitFrontmatter(source), [source]);
    return (
      <div
        className={cn(
          "markdown-body prose prose-invert max-w-none",
          "prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-info prose-a:no-underline hover:prose-a:underline",
          "prose-pre:rounded-lg prose-pre:text-[12px] prose-code:text-[0.86em]",
          "prose-blockquote:border-l-accent/60 prose-blockquote:text-muted prose-hr:border-border",
          "prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5",
          "prose-img:my-2",
          compact
            ? "prose-sm text-[12.5px] leading-[1.65] prose-p:my-1.5 prose-pre:my-2 prose-pre:text-[11.5px] prose-li:my-0.5 prose-ol:my-1.5 prose-ul:my-1.5"
            : "text-[13px] leading-[1.7]",
          className,
        )}
      >
        {fields.length > 0 && <Frontmatter fields={fields} />}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, schema],
            [rehypeHighlight, { detect: false }],
          ]}
          components={components}
        >
          {body}
        </ReactMarkdown>
      </div>
    );
  },
);
MarkdownView.displayName = "MarkdownView";
