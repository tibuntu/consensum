import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// Disabled: primary swaps to a neutral surface (a violet button at half opacity
// still reads as enabled); the flat variants just fade. Opacity lives on the
// variants, not the base, so the two treatments never fight over the same property.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm disabled:bg-[var(--state-neutral-bg)] disabled:text-muted disabled:shadow-none",
  secondary: "border border-border bg-surface text-foreground hover:bg-primary-subtle disabled:opacity-50",
  ghost: "text-foreground hover:bg-primary-subtle disabled:opacity-50",
  danger: "bg-danger text-danger-fg hover:bg-[var(--danger-hover)] disabled:opacity-50",
};
const SIZES: Record<Size, string> = { sm: "px-2.5 py-1 text-sm", md: "px-3.5 py-2 text-sm" };

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-app)] font-medium transition-colors disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}
