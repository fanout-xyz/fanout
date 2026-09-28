import { cn } from "@/lib/utils";

type Props = {
  /** Force the cream lockup regardless of theme (e.g. on a dark band in light mode). */
  onDark?: boolean;
  className?: string;
  width?: number;
  height?: number;
};

/**
 * Lockup that swaps with the theme in CSS (no JS, no flash):
 * primary (cobalt mark + ink wordmark) in light, cream in dark.
 */
export function Logo({ onDark = false, className = "h-7 w-auto", width = 136, height = 28 }: Props) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG from the brand kit */}
      <img
        src="/brand/svg/lockup/fanout-lockup-primary.svg"
        alt="Fanout"
        width={width}
        height={height}
        className={cn(className, onDark ? "hidden" : "dark:hidden")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- logo SVG from the brand kit */}
      <img
        src="/brand/svg/lockup/fanout-lockup-cream.svg"
        alt="Fanout"
        width={width}
        height={height}
        className={cn(className, onDark ? "block" : "hidden dark:block")}
      />
    </>
  );
}
