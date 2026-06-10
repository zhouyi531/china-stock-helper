import { useEffect, useRef, useState } from "react";
import type { StockSnapshot } from "../types";
import { isActiveAlert } from "../lib/exit";
import { playAlertSound, primeAudio } from "../lib/sound";

const TP_KEY = "soundTakeProfit";
const SL_KEY = "soundStopLoss";
const LEGACY_MUTE_KEY = "alertSoundMuted";
/** While an alarm stays un-acknowledged, re-ring every N ms. */
const REMIND_EVERY_MS = 30_000;

export interface SoundPrefs {
  takeProfit: boolean;
  stopLoss: boolean;
  toggleTakeProfit: () => void;
  toggleStopLoss: () => void;
}

function readPref(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v === "1";
    // migrate from the old single mute switch; default = on
    return localStorage.getItem(LEGACY_MUTE_KEY) !== "1";
  } catch {
    return true;
  }
}

function usePersistedFlag(key: string): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => readPref(key));
  const toggle = () =>
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  return [on, toggle];
}

/** Independent persisted on/off switches for take-profit / stop-loss alarms. */
export function useSoundPrefs(): SoundPrefs {
  const [takeProfit, toggleTakeProfit] = usePersistedFlag(TP_KEY);
  const [stopLoss, toggleStopLoss] = usePersistedFlag(SL_KEY);
  return { takeProfit, stopLoss, toggleTakeProfit, toggleStopLoss };
}

/**
 * Rings when a stock enters an active (un-dismissed) warning state or its
 * warning kind changes; repeats every REMIND_EVERY_MS until the user
 * acknowledges (解除报警) or the state clears. Take-profit and stop-loss
 * use distinct tones and independent switches.
 */
export function useAlertSound(stocks: StockSnapshot[], prefs: SoundPrefs): void {
  const prevRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    primeAudio();
  }, []);

  // collect currently active alarms by kind
  let hasTp = false;
  let hasSl = false;
  const cur = new Map<string, string>();
  for (const s of stocks) {
    if (!isActiveAlert(s.exit)) continue;
    cur.set(s.symbol, s.exit!.kind);
    if (s.exit!.kind === "take_profit_warn") hasTp = true;
    else if (s.exit!.kind === "stop_loss_warn") hasSl = true;
  }

  // one-shot ring when a new alarm appears (or its kind changes)
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = cur;
    // skip the very first snapshot: the periodic reminder below covers
    // alarms that already existed when the page loaded
    if (prev == null) return;

    let freshTp = false;
    let freshSl = false;
    for (const [symbol, kind] of cur) {
      if (prev.get(symbol) !== kind) {
        if (kind === "take_profit_warn") freshTp = true;
        else if (kind === "stop_loss_warn") freshSl = true;
      }
    }
    // stop-loss first: it is the more urgent of the two
    if (freshSl && prefs.stopLoss) playAlertSound("stop_loss");
    else if (freshTp && prefs.takeProfit) playAlertSound("take_profit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, prefs.stopLoss, prefs.takeProfit]);

  // periodic reminder while any alarm stays un-acknowledged
  useEffect(() => {
    const slOn = hasSl && prefs.stopLoss;
    const tpOn = hasTp && prefs.takeProfit;
    if (!slOn && !tpOn) return;
    const id = window.setInterval(() => {
      playAlertSound(slOn ? "stop_loss" : "take_profit");
    }, REMIND_EVERY_MS);
    return () => window.clearInterval(id);
  }, [hasTp, hasSl, prefs.stopLoss, prefs.takeProfit]);
}
