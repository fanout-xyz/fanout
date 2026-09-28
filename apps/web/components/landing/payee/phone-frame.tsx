import type { ReactNode } from "react";

/** 300×600 phone, 44px radius, 10px ink bezel. Shrinks to fit narrow screens. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-[1/2] w-[min(300px,100%)] overflow-hidden rounded-[44px] border-[10px] border-bezel bg-bezel">
      <div className="absolute top-2 left-1/2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-bezel" aria-hidden />
      {/* Screen: page background in light, card in dark. --petal-cut tells the mark what it sits on. */}
      <div className="size-full overflow-hidden rounded-[34px] bg-background pt-6 [--petal-cut:var(--bg)] dark:bg-surface dark:[--petal-cut:var(--card)]">
        {children}
      </div>
    </div>
  );
}
