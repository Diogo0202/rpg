import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useNexus } from "@/lib/nexus/store";

export const btn = cva(
  "tap inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        gold: "bg-primary text-primary-foreground hover:bg-primary/90",
        forest: "bg-secondary text-secondary-foreground border border-border hover:bg-accent",
        ink: "bg-ink text-card hover:bg-ink/90",
        outline: "border border-ink/30 text-ink bg-transparent hover:bg-parchment-deep",
        ghost: "text-ink hover:bg-parchment-deep",
        danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: { md: "", sm: "px-3 text-sm", icon: "px-0" },
    },
    defaultVariants: { variant: "gold", size: "md" },
  },
);

export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof btn>>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(btn({ variant, size }), className)} {...props} />
  ),
);
Btn.displayName = "Btn";

export function Panel({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("parchment p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ink">
      {children}
      {hint && <span className="ml-1 font-normal text-ink-muted">{hint}</span>}
    </label>
  );
}

export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "gold" | "warn" | "forest" }) {
  const tones = {
    ink: "bg-parchment-deep text-ink",
    gold: "bg-primary text-primary-foreground",
    warn: "bg-warning text-warning-foreground",
    forest: "bg-secondary text-secondary-foreground",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="parchment-inset p-4 text-sm text-ink-muted">{children}</p>;
}

export function LocalGate({ children }: { children: ReactNode }) {
  const { ready, error } = useNexus();
  if (error) return <Panel title="Armazenamento local indisponível"><p className="text-sm text-ink">{error}</p></Panel>;
  if (!ready) return <div className="parchment p-6 text-center text-ink-muted" role="status">Abrindo o cofre local…</div>;
  return <>{children}</>;
}

