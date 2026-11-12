import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Einheitlicher leerer Zustand: Symbol, Erklärung und eine klare Aktion. */
export function EmptyState({ icon, title, text, action, onAction, className, compact }: {
  icon?: ReactNode; title: string; text?: string; action?: string; onAction?: () => void; className?: string; compact?: boolean;
}) {
  return (
    <div data-testid="empty-state" className={cn("flex flex-col items-center justify-center gap-2 text-center text-muted-foreground", compact ? "p-3" : "p-8", className)}>
      {icon && <div className="[&_svg]:size-10 opacity-70">{icon}</div>}
      <p className="font-medium text-foreground">{title}</p>
      {text && <p className="max-w-sm text-sm">{text}</p>}
      {action && onAction && <Button className="mt-1" onClick={onAction}>{action}</Button>}
    </div>
  );
}
