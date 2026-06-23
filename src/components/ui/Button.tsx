import { Link } from "react-router-dom";
import type { MouseEvent, ReactNode } from "react";

// =====================================================================
// Standard button primitive.
//
// Wraps the global .btn-* CSS classes so every action button in the
// app picks identical sizing, gap, and corner-radius. Use `variant`
// for the color treatment and `size` for the dimensional preset.
// Pass `to` to render as a react-router Link (drop-in replacement
// for <Link className="btn-...">) or `onClick` to render a real
// <button>. Either path produces visually identical output.
//
// Why this exists: prior call sites mixed "btn-outline text-xs",
// "btn-outline text-[11px] !px-2.5 !py-1", and plain "btn-outline",
// so the same View button rendered three different sizes across
// surfaces (Assets card vs. Policies card vs. row actions). Routing
// every consumer through Button enforces one source of truth for
// each (variant, size) pair.
// =====================================================================

export type ButtonVariant = "primary" | "gold" | "outline" | "ghost";
export type ButtonSize = "xs" | "sm" | "md";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Optional left/right icon slot. Sized + spaced by the wrapper so
  // call sites don't need to add their own margin classes.
  icon?: ReactNode;
  iconAfter?: ReactNode;
  className?: string;
  children?: ReactNode;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  // Lets callers paint the button red for destructive actions
  // without forking variants. Reads the existing rose-600 token so
  // it matches the rest of the destructive UI.
  tone?: "default" | "danger";
  // Stretches the button across its container — useful inside a
  // narrow card or column.
  fullWidth?: boolean;
}

interface ButtonAsLink extends CommonProps {
  to: string;
  type?: never;
  onClick?: never;
  target?: string;
  rel?: string;
}

interface ButtonAsAnchor extends CommonProps {
  href: string;
  to?: never;
  type?: never;
  onClick?: never;
  target?: string;
  rel?: string;
}

interface ButtonAsButton extends CommonProps {
  to?: never;
  href?: never;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export type ButtonProps = ButtonAsLink | ButtonAsAnchor | ButtonAsButton;

// Centralized size table. Tailwind-arbitrary classes (text-[11px])
// stay here, so call sites never need to know about them.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "!text-[11px] !px-2.5 !py-1 !gap-1.5",
  sm: "!text-xs !px-3 !py-1.5 !gap-1.5",
  md: "", // .btn already sets px-4 py-2 text-sm gap-2
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  gold: "btn-gold",
  outline: "btn-outline",
  ghost: "btn-ghost",
};

function classesFor(
  variant: ButtonVariant,
  size: ButtonSize,
  tone: "default" | "danger",
  fullWidth: boolean,
  extra?: string
): string {
  const dangerClass = tone === "danger" ? "!text-rose-600" : "";
  const widthClass = fullWidth ? "w-full" : "";
  return [
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    dangerClass,
    widthClass,
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
}

function protectedRel(rel: string | undefined, target: string | undefined): string | undefined {
  if (target !== "_blank") return rel;
  const tokens = new Set((rel ?? "").split(/\s+/).filter(Boolean));
  tokens.add("noopener");
  tokens.add("noreferrer");
  return Array.from(tokens).join(" ");
}

export function Button(props: ButtonProps) {
  const {
    variant = "outline",
    size = "md",
    icon,
    iconAfter,
    className,
    children,
    title,
    ariaLabel,
    disabled,
    tone = "default",
    fullWidth = false,
  } = props;
  const cls = classesFor(variant, size, tone, fullWidth, className);

  const content = (
    <>
      {icon}
      {children}
      {iconAfter}
    </>
  );

  if ("to" in props && props.to !== undefined) {
    return (
      <Link
        to={props.to}
        className={cls}
        title={title}
        target={props.target}
        rel={props.rel}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
      >
        {content}
      </Link>
    );
  }
  if ("href" in props && props.href !== undefined) {
    const target = props.target ?? (isExternalHref(props.href) ? "_blank" : undefined);
    return (
      <a
        href={disabled ? undefined : props.href}
        className={cls}
        title={title}
        target={target}
        rel={protectedRel(props.rel, target)}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        onClick={disabled ? (e) => e.preventDefault() : undefined}
      >
        {content}
      </a>
    );
  }
  const btnProps = props as ButtonAsButton;
  return (
    <button
      type={btnProps.type ?? "button"}
      className={cls}
      onClick={btnProps.onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}
