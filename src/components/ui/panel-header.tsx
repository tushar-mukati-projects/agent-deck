type PanelHeaderProps = {
  title: string;
  children?: React.ReactNode;
};

export const PanelHeader = ({ title, children }: PanelHeaderProps) => (
  <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3.5">
    <span
      title={title}
      className="min-w-0 truncate text-[11px] font-semibold tracking-wider text-muted uppercase"
    >
      {title}
    </span>
    <div className="flex items-center gap-0.5">{children}</div>
  </div>
);
