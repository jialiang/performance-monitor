import { getElapsed, roundToMicroseconds } from "./util";

// A stall is when the event loop couldn't run callbacks
// because code was busy or the platform froze the process.
// Timing stamped in callbacks can be late by up to the stall before it.
// The monitor is a timer that fires every `resolution` ms.
// Any gap between ticks over `resolution` is a stall.
const resolution = 5;

// at: when tick recorded
// gap: time elapsed since last tick
type Tick = { at: number; gap: number };

export const startStallMonitor = (startMark: number) => {
  const ticks: Tick[] = [];
  let lastTickAt = getElapsed(startMark);

  const recordTick = () => {
    const now = getElapsed(startMark);
    ticks.push({ at: now, gap: now - lastTickAt });
    lastTickAt = now;
  };

  const timer = setInterval(recordTick, resolution);
  timer.unref();

  const stop = () => {
    clearInterval(timer);
    recordTick();
  };

  const getMaxStallBetween = (start?: number, end?: number) => {
    if (start == null || end == null) return undefined;

    const stalls = ticks
      // get all ticks inside the start/end time
      .filter((tick) => tick.at >= start && tick.at - tick.gap <= end)
      // find how much they all stalled
      .map((tick) => tick.gap - resolution);

    return roundToMicroseconds(Math.max(0, ...stalls));
  };

  return { stop, getMaxStallBetween };
};
