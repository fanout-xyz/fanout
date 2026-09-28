"use client";

import { animate, useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { FEE_AT, WIRE_FEES } from "./fees";

const WIRE_S = 4;
const FANOUT_S = 0.6;

export type Race = {
  wire: MotionValue<number>;
  fanout: MotionValue<number>;
  feesApplied: number;
  wireDone: boolean;
  fanoutDone: boolean;
  finished: boolean;
  replay: () => void;
};

/** Plays both lanes once when `start` turns true. `reduced` shows the end state. */
export function useRace(start: boolean, reduced: boolean): Race {
  const wire = useMotionValue(reduced ? 1 : 0);
  const fanout = useMotionValue(reduced ? 1 : 0);
  const [feesApplied, setFeesApplied] = useState(reduced ? WIRE_FEES.length : 0);
  const [wireDone, setWireDone] = useState(reduced);
  const [fanoutDone, setFanoutDone] = useState(reduced);
  const [run, setRun] = useState(0);

  useMotionValueEvent(wire, "change", (p) => {
    const applied = FEE_AT.filter((at) => p >= at).length;
    setFeesApplied((prev) => (prev === applied ? prev : applied));
  });

  useEffect(() => {
    if (!start || reduced) return;
    wire.set(0);
    fanout.set(0);
    const a = animate(wire, 1, { duration: WIRE_S, ease: "linear", onComplete: () => setWireDone(true) });
    const b = animate(fanout, 1, { duration: FANOUT_S, ease: [0.2, 0.8, 0.2, 1], onComplete: () => setFanoutDone(true) });
    return () => {
      a.stop();
      b.stop();
    };
  }, [start, reduced, run, wire, fanout]);

  const replay = useCallback(() => {
    setWireDone(false);
    setFanoutDone(false);
    setFeesApplied(0);
    setRun((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!reduced) return;
    wire.set(1);
    fanout.set(1);
  }, [reduced, wire, fanout]);

  if (reduced) {
    return { wire, fanout, feesApplied: WIRE_FEES.length, wireDone: true, fanoutDone: true, finished: true, replay };
  }
  return { wire, fanout, feesApplied, wireDone, fanoutDone, finished: wireDone && fanoutDone, replay };
}
