"use client";

import { Globe } from "lucide-react";
import { useId } from "react";
import { LANGUAGES, type Lang } from "@/lib/i18n/languages";

/** A small language picker for payee pages. Language names are shown in their own language. */
export function LanguageSwitcher({ value, label, onChange }: { value: Lang; label: string; onChange: (lang: Lang) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-center gap-2 text-sm text-muted">
      <Globe aria-hidden className="size-4" />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as Lang)}
        className="h-9 rounded-sm border border-line bg-surface px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </div>
  );
}
