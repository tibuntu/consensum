"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/**
 * Copy a value to the clipboard with transient "Copied" feedback. Used for
 * one-time secrets (API tokens, webhook signing secrets) that can't be
 * re-retrieved after the reveal card is dismissed (F49/F48).
 *
 * The button's accessible name stays "{label}" even while the visible text flips
 * to "Copied", so the control always describes its action; the confirmation is
 * announced through a separate sr-only status region (announcing via a focused
 * control's own name is unreliable across screen readers).
 */
export function CopyButton({
  value,
  label = "Copy",
  className = "",
  size = "sm",
  variant = "secondary",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  variant?: Variant;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={copy} className={className} aria-label={label}>
        {copied ? "Copied" : label}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
