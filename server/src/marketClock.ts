import type { MarketClock } from "./types.js";

interface ShParts {
  minuteOfDay: number;
  weekend: boolean;
}

function shanghaiParts(now: Date): ShParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  let hour = 0;
  let minute = 0;
  let weekday = "Mon";
  for (const p of fmt.formatToParts(now)) {
    if (p.type === "hour") hour = parseInt(p.value, 10) % 24;
    else if (p.type === "minute") minute = parseInt(p.value, 10);
    else if (p.type === "weekday") weekday = p.value;
  }
  return { minuteOfDay: hour * 60 + minute, weekend: weekday === "Sat" || weekday === "Sun" };
}

const MORNING_OPEN = 9 * 60 + 30; // 570
const MORNING_CLOSE = 11 * 60 + 30; // 690
const AFTERNOON_OPEN = 13 * 60; // 780
const AFTERNOON_CLOSE = 15 * 60; // 900
const AUCTION_OPEN = 9 * 60 + 15; // 555

export function getMarketClock(now = new Date()): MarketClock {
  const { minuteOfDay: m, weekend } = shanghaiParts(now);
  let session: MarketClock["session"] = "closed";
  let label = "已收盘";

  if (weekend) {
    session = "closed";
    label = "休市 (周末)";
  } else if (m >= AUCTION_OPEN && m < MORNING_OPEN) {
    session = "pre";
    label = "盘前集合竞价";
  } else if (m >= MORNING_OPEN && m < MORNING_CLOSE) {
    session = "morning";
    label = "上午交易中";
  } else if (m >= MORNING_CLOSE && m < AFTERNOON_OPEN) {
    session = "lunch";
    label = "午间休市";
  } else if (m >= AFTERNOON_OPEN && m < AFTERNOON_CLOSE) {
    session = "afternoon";
    label = "下午交易中";
  }

  const open = session === "morning" || session === "afternoon";
  return { open, session, serverTime: now.getTime(), label };
}

/** Fraction (0..1) of the 240-minute trading day elapsed (for relative volume). */
export function sessionElapsedFraction(now = new Date()): number {
  const { minuteOfDay: m } = shanghaiParts(now);
  const TOTAL = 240;
  let elapsed: number;
  if (m < MORNING_OPEN) elapsed = 0;
  else if (m < MORNING_CLOSE) elapsed = m - MORNING_OPEN;
  else if (m < AFTERNOON_OPEN) elapsed = 120;
  else if (m < AFTERNOON_CLOSE) elapsed = 120 + (m - AFTERNOON_OPEN);
  else elapsed = TOTAL;
  return Math.max(0.001, Math.min(1, elapsed / TOTAL));
}

/**
 * Typical cumulative share of the FULL DAY's volume/amount traded by a given
 * trading-minute, modelling the A-share U-shaped intraday profile (heavy
 * open, quiet midday, pickup into the close). Anchors are piecewise-linear
 * approximations of the average curve; far more accurate than a linear
 * projection when extrapolating "today's volume vs. previous days" early in
 * the session (a linear model overestimates relative volume ~3x at 09:45).
 */
const VOLUME_CURVE: [number, number][] = [
  // [elapsed trading minutes, cumulative fraction]
  [0, 0],
  [5, 0.055],
  [15, 0.12],
  [30, 0.19],
  [60, 0.30],
  [90, 0.385],
  [120, 0.46], // 11:30 morning close
  [150, 0.55],
  [180, 0.66], // 14:00
  [210, 0.78], // 14:30
  [230, 0.90],
  [240, 1.0],
];

/** Cumulative expected volume fraction (0..1) using the U-shaped curve. */
export function sessionVolumeFraction(now = new Date()): number {
  const { minuteOfDay: m } = shanghaiParts(now);
  let elapsed: number;
  if (m < MORNING_OPEN) return 0.001;
  else if (m < MORNING_CLOSE) elapsed = m - MORNING_OPEN;
  else if (m < AFTERNOON_OPEN) elapsed = 120;
  else if (m < AFTERNOON_CLOSE) elapsed = 120 + (m - AFTERNOON_OPEN);
  else return 1;

  for (let i = 1; i < VOLUME_CURVE.length; i++) {
    const [m1, f1] = VOLUME_CURVE[i];
    if (elapsed <= m1) {
      const [m0, f0] = VOLUME_CURVE[i - 1];
      const t = m1 > m0 ? (elapsed - m0) / (m1 - m0) : 1;
      return Math.max(0.001, f0 + (f1 - f0) * t);
    }
  }
  return 1;
}
