"use client";

import { Check, Copy } from "lucide-react";
import posthog from "posthog-js";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Passport } from "@/lib/payee/passport";
import { badgeAlt, badgeImageUrl, badgeSnippets, type BadgeTheme } from "@/lib/payee/passport-badge";
import type { ShareFields } from "@/lib/payee/passport-share";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};
const KINDS = [
  { key: "html", label: "HTML", hint: "Websites and portfolios" },
  { key: "markdown", label: "Markdown", hint: "Profiles that take Markdown" },
  { key: "link", label: "Link", hint: "Bios and anywhere else" },
] as const;

/**
 * The verified earnings badge for the payee's own pages. It shows what this passport's card
 * shows (never the total), is checked by the server each time it loads, and links to the
 * verify page.
 */
export function BadgeSection({ passport, encoded, fields, link }: { passport: Passport; encoded: string; fields: ShareFields; link: string }) {
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "");
  const [theme, setTheme] = useState<BadgeTheme>("light");
  const [copied, setCopied] = useState<string | null>(null);
  const urls = { light: badgeImageUrl(origin, encoded, fields, "light"), dark: badgeImageUrl(origin, encoded, fields, "dark") };
  const snippets = badgeSnippets(urls[theme], link, badgeAlt(passport, fields));

  async function copy(kind: (typeof KINDS)[number]["key"]) {
    try {
      await navigator.clipboard.writeText(snippets[kind]);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1_600);
      posthog.capture("passport_badge_copied", { kind, theme });
    } catch {
      toast.error("Couldn't copy. Try again.");
    }
  }

  return (
    <section aria-labelledby="badge-title" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div>
        <h3 id="badge-title" className="font-bold">
          Add a badge to your profile
        </h3>
        <p className="mt-0.5 text-sm text-pretty text-muted">
          A small verified badge for your site or bio. It links here and is checked each time it loads.
        </p>
      </div>

      <div role="radiogroup" aria-label="Badge style" className="grid grid-cols-2 gap-2">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            onClick={() => setTheme(t)}
            className={cn(
              "flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border-2 px-2 outline-none",
              "transition-[border-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring",
              t === "light" ? "bg-[#FFF6EA]" : "bg-[#131211]",
              theme === t ? "border-primary" : "border-line",
            )}
          >
            {/* The badge itself, served and checked like it will be on their page. */}
            {origin && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[t]} alt="" height={28} className="h-7 w-auto max-w-full" />
            )}
            <span className={cn("text-xs font-semibold", t === "light" ? "text-[#6B645A]" : "text-[#A8A196]")}>
              {t === "light" ? "Light" : "Dark"}
            </span>
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {KINDS.map(({ key, label, hint }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => void copy(key)}
              className="flex w-full items-center gap-3 rounded-md border border-line bg-background px-4 py-3 text-left outline-none transition-transform duration-150 ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Copy {label}</span>
                <span className="block truncate text-xs text-muted">{hint}</span>
              </span>
              <span className={cn("flex size-8 items-center justify-center rounded-full", copied === key ? "bg-mint-surface text-on-mint" : "text-muted")}>
                {copied === key ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
                <span className="sr-only">{copied === key ? "Copied" : ""}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-pretty text-muted">
        Anyone who sees the badge can open your passport card. It never shows your payments or your total.
      </p>
    </section>
  );
}
