"use client";

import { m } from "motion/react";
import type { CSSProperties } from "react";
import { formatCents } from "@/lib/money";
import { stampLook, type PlatformStamp, type StampShape } from "@/lib/payee/passport-stats";
import { cn } from "@/lib/utils";

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Regular polygon around (60, 60). */
function polygon(sides: number, r: number, turn = 0): string {
  return Array.from({ length: sides }, (_, i) => {
    const a = turn + (i * 2 * Math.PI) / sides;
    return `${(60 + r * Math.cos(a)).toFixed(2)},${(60 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** A circle with a scalloped edge, like a wax seal. */
function scallop(r: number, bumps = 22): string {
  const pts = Array.from({ length: bumps }, (_, i) => {
    const a = (i * 2 * Math.PI) / bumps;
    return [60 + r * Math.cos(a), 60 + r * Math.sin(a)];
  });
  const chord = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / 2;
  return `M${pts[0].map((v) => v.toFixed(2)).join(",")} ${pts
    .map((_, i) => {
      const [x, y] = pts[(i + 1) % bumps];
      return `A${chord.toFixed(2)},${chord.toFixed(2)} 0 0 1 ${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ")}Z`;
}

function Outline({ shape, inset, width }: { shape: StampShape; inset: number; width: number }) {
  const r = 55 - inset;
  const common = { fill: "none", stroke: "currentColor", strokeWidth: width, vectorEffect: "non-scaling-stroke" as const };
  switch (shape) {
    case "circle":
      return <circle cx={60} cy={60} r={r} {...common} />;
    case "rounded":
      return <rect x={60 - r * 0.9} y={60 - r * 0.9} width={r * 1.8} height={r * 1.8} rx={14 - inset / 2} {...common} />;
    case "hexagon":
      return <polygon points={polygon(6, r, Math.PI / 6)} strokeLinejoin="round" {...common} />;
    case "octagon":
      return <polygon points={polygon(8, r, Math.PI / 8)} strokeLinejoin="round" {...common} />;
    case "scallop":
      return <path d={scallop(r)} {...common} />;
  }
}

/** The stamp artwork alone: shape, code and first-paid month in the platform's ink. */
export function StampArt({ platform, firstPaidAt, className }: { platform: string; firstPaidAt: number; className?: string }) {
  const look = stampLook(platform);
  return (
    <svg viewBox="0 0 120 120" className={cn("overflow-visible", className)} aria-hidden>
      <Outline shape={look.shape} inset={0} width={3} />
      <Outline shape={look.shape} inset={7} width={1.25} />
      <text x={60} y={44} textAnchor="middle" fontSize={8.5} fontWeight={800} letterSpacing={1.6} fill="currentColor">
        FIRST PAID
      </text>
      <text x={60} y={73} textAnchor="middle" fontSize={30} fill="currentColor" style={{ fontFamily: "var(--font-display)" }}>
        {look.code}
      </text>
      <line x1={36} x2={84} y1={81} y2={81} stroke="currentColor" strokeWidth={1} />
      <text x={60} y={94} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={0.8} fill="currentColor">
        {monthYear.format(firstPaidAt).toUpperCase()}
      </text>
    </svg>
  );
}

type Props = {
  stamp: PlatformStamp;
  /** Play the stamp-in: only the first time this stamp is seen on this device. */
  fresh: boolean;
  /** False holds a fresh stamp above the page until it scrolls into view. */
  play?: boolean;
  delay?: number;
  reduced: boolean;
};

/**
 * One platform's stamp. The first time it appears it lands like a rubber stamp: it drops from
 * slightly above the page, overshoots a touch, settles at its tilt and leaves a ring of ink.
 */
export function Stamp({ stamp, fresh, play = true, delay = 0, reduced }: Props) {
  const look = stampLook(stamp.id);
  const ink = { "--ink": look.ink.light, "--ink-dark": look.ink.dark } as CSSProperties;
  const label = `${look.code}: a platform that first paid you in ${monthYear.format(stamp.firstPaidAt)}. ${stamp.payouts} ${
    stamp.payouts === 1 ? "payout" : "payouts"
  }, ${formatCents(stamp.cents)} in total.`;
  const ring = fresh && play && !reduced;
  const lifted = reduced ? { opacity: 0, rotate: look.tilt } : { opacity: 0, scale: 1.45, rotate: look.tilt - 14 };
  const landed = { opacity: 0.92, scale: 1, rotate: look.tilt };

  return (
    <li className="flex flex-col items-center gap-2" aria-label={label}>
      <div className="relative size-[104px] text-[var(--ink)] dark:text-[var(--ink-dark)]" style={ink}>
        {ring && (
          // The ink ring left behind as the stamp lifts.
          <m.span
            aria-hidden
            className="pointer-events-none absolute inset-1 rounded-full border-2 border-current"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: [0, 0.35, 0], scale: [0.9, 1, 1.22] }}
            transition={{ duration: 0.55, delay: delay + 0.14, ease: [0.23, 1, 0.32, 1] }}
          />
        )}
        <m.div
          className="size-full"
          initial={fresh ? lifted : false}
          animate={fresh && !play ? lifted : landed}
          transition={
            reduced
              ? { duration: 0.2, delay }
              : { type: "spring", stiffness: 520, damping: 24, mass: 0.9, delay, opacity: { duration: 0.12, delay } }
          }
        >
          <StampArt platform={stamp.id} firstPaidAt={stamp.firstPaidAt} className="size-full" />
        </m.div>
      </div>
      <div className="text-center leading-tight">
        <p className="text-sm font-bold tabular-nums">{formatCents(stamp.cents)}</p>
        <p className="text-xs text-muted tabular-nums">
          {stamp.payouts} {stamp.payouts === 1 ? "payout" : "payouts"}
        </p>
      </div>
    </li>
  );
}
