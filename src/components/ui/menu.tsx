import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils";

const contentClass =
  "animate-pop-in z-50 min-w-[210px] overflow-hidden rounded-lg border border-border-strong bg-overlay p-1 text-[12.5px] text-fg shadow-2xl shadow-shadow";

const itemClass =
  "relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-soft [&_svg]:size-3.5 [&_svg]:text-muted";

const destructiveClass = "text-danger data-[highlighted]:bg-danger/15 [&_svg]:text-danger";

interface ItemProps {
  icon?: React.ReactNode;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  children: React.ReactNode;
}

const ItemBody = ({
  icon,
  shortcut,
  children,
}: Pick<ItemProps, "icon" | "shortcut" | "children">) => (
  <>
    {icon}
    <span className="flex-1 truncate">{children}</span>
    {shortcut && <span className="font-mono text-[10.5px] text-faint">{shortcut}</span>}
  </>
);

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = ({ children }: { children: React.ReactNode }) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content className={contentClass}>{children}</ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
);

export const ContextMenuItem = ({ destructive, disabled, onSelect, ...body }: ItemProps) => (
  <ContextMenuPrimitive.Item
    disabled={disabled}
    onSelect={onSelect}
    className={cn(itemClass, destructive && destructiveClass)}
  >
    <ItemBody {...body} />
  </ContextMenuPrimitive.Item>
);

export const ContextMenuSeparator = () => (
  <ContextMenuPrimitive.Separator className="mx-1 my-1 h-px bg-border" />
);

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

interface DropdownContentProps {
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}

export const DropdownMenuContent = ({
  children,
  align = "start",
  className,
}: DropdownContentProps) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content align={align} sideOffset={6} className={cn(contentClass, className)}>
      {children}
    </DropdownPrimitive.Content>
  </DropdownPrimitive.Portal>
);

export const DropdownMenuItem = ({ destructive, disabled, onSelect, ...body }: ItemProps) => (
  <DropdownPrimitive.Item
    disabled={disabled}
    onSelect={onSelect}
    className={cn(itemClass, destructive && destructiveClass)}
  >
    <ItemBody {...body} />
  </DropdownPrimitive.Item>
);

export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator className="mx-1 my-1 h-px bg-border" />
);

export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => (
  <DropdownPrimitive.Label className="px-2 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-wider text-faint uppercase">
    {children}
  </DropdownPrimitive.Label>
);
