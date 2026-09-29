"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ORDER = ["light", "dark", "system"] as const;
type ThemeChoice = (typeof ORDER)[number];
const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

const subscribeNoop = () => () => {};

/** 36px round button cycling Light -> Dark -> System (light is the default). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known on the client; render a neutral icon until then.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const current: ThemeChoice = mounted && ORDER.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "light";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  function cycle() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    if (!reduce) {
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 200);
    }
    setTheme(next);
  }

  const label = `Theme: ${LABEL[current]}. Switch to ${LABEL[next]}.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={cycle}
          aria-label={label}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-current outline-none transition-colors duration-150 hover:bg-card-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
        >
          {current === "light" ? <SunIcon /> : current === "dark" ? <MoonIcon /> : <SystemIcon />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  className: "size-[18px]",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

/** Half sun, half moon: "follows your device". */
function SystemIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}
