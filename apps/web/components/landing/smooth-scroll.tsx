"use client";

import "lenis/dist/lenis.css";
import { ReactLenis } from "lenis/react";
import { useEffect, useState, type ReactNode } from "react";

/** Lenis smooth scrolling on mouse/trackpad devices only; off for touch and reduced motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: no-preference) and (pointer: fine)");
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <>
      {enabled && <ReactLenis root options={{ anchors: { offset: -72 }, autoRaf: true }} />}
      {children}
    </>
  );
}
