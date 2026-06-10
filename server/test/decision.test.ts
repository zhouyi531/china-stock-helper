import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDecision, type DecisionInput } from "../src/decision/engine.js";
import type {
  ExitState,
  Layer1Metrics,
  MarketClock,
  Position,
  Quote,
  Regime,
  StockSectorInfo,
} from "../src/types.js";

function mkQuote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "sh600000",
    code: "600000",
    name: "测试股份",
    market: "sh",
    price: 10.5,
    prevClose: 10,
    open: 10.1,
    high: 10.6,
    low: 10.05,
    volume: 500000,
    amount: 5e8,
    avgPrice: 10.3,
    turnoverRate: 5,
    amplitude: 5.5,
    volumeRatio: 2,
    limitUp: 11,
    limitDown: 9,
    pe: 20,
    pb: 2,
    bids: [{ price: 10.49, volume: 500 }],
    asks: [{ price: 10.5, volume: 300 }],
    ts: Date.now(),
    stale: false,
    ...over,
  };
}

function mkLayer1(over: Partial<Layer1Metrics> = {}): Layer1Metrics {
  return {
    price: 10.5,
    pctChange: 5,
    gapPct: 1,
    vwap: 10.3,
    priceVsVwap: 1.9,
    ma5: 10.2,
    ma10: 10.0,
    ma20: 9.8,
    ma60: 9.5,
    intradayMomentum: 0.5,
    intradayMomentum15: 1.0,
    relativeVolume: 2,
    turnoverRate: 5,
    amplitude: 5.5,
    volatility: 2.5,
    distanceToLimitUp: 4.76,
    distanceToLimitDown: 14.3,
    bidAskSpread: 0.095,
    orderBookImbalance: 0.25,
    dayRangePos: 82,
    macdDif: 0.08,
    macdDea: 0.05,
    macdHist: 0.06,
    macdHistPrev: 0.04,
    rsi14: 62,
    kdjK: 75,
    kdjD: 68,
    kdjJ: 89,
    atrPct: 2.5,
    ret5d: 4,
    ret20d: 9,
    pos60d: 78,
    distToHigh20: 0.5,
    volTrend: 1.4,
    ma20Slope: 1.2,
    intradayScore: 72,
    dailyScore: 70,
    trendScore: 71,
    trendTag: "bull",
    ...over,
  };
}

function mkSector(score = 65): StockSectorInfo {
  return {
    industry: {
      code: "BK0001",
      name: "测试行业",
      type: "industry",
      pctChange: 2.5,
      rank: 5,
      total: 86,
      amount: 100e8,
      amountChangePct: null,
      upRatio: 0.8,
      limitUpCount: 4,
      maxLimitStreak: 3,
      leaderStrength: 9,
      score,
      available: true,
    },
    concepts: [],
    sectorScore: score,
    conceptScore: null,
    available: true,
  };
}

function mkRegime(over: Partial<Regime> = {}): Regime {
  return {
    kind: "strong_trend",
    label: "强趋势市",
    score: 45,
    indices: [],
    breadth: {
      advancers: 3500,
      decliners: 1500,
      unchanged: 0,
      limitUp: 45,
      limitDown: 3,
      maxLimitStreak: 4,
      totalAmount: 1.5e12,
      amountChangePct: 8,
      available: true,
    },
    reasons: [],
    ts: Date.now(),
    ...over,
  };
}

const OPEN_CLOCK: MarketClock = {
  open: true,
  session: "afternoon",
  serverTime: Date.now(),
  label: "下午交易中",
};

function mkInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    quote: mkQuote(),
    layer1: mkLayer1(),
    sector: mkSector(),
    regime: mkRegime(),
    position: null,
    exit: null,
    clock: OPEN_CLOCK,
    ...over,
  };
}

test("textbook setup -> buy-side signal with passing checklist", () => {
  const d = computeDecision(mkInput());
  assert.ok(d.action === "buy" || d.action === "strong_buy", `got ${d.action}`);
  assert.ok(d.score >= 65, `score ${d.score}`);
  const corePass = d.checklist.slice(0, 5).filter((c) => c.pass === true).length;
  assert.ok(corePass >= 4, `core checklist passes: ${corePass}`);
  assert.ok(d.suggestedStopPrice != null && d.suggestedStopPrice < 10.5);
  // 1.8 × 2.5% ATR = 4.5% stop
  assert.ok(Math.abs((d.suggestedStopPct ?? 0) - 0.045) < 1e-9);
});

test("panic regime caps any buy to watch", () => {
  const d = computeDecision(
    mkInput({ regime: mkRegime({ kind: "panic", label: "恐慌杀跌市", score: -70 }) })
  );
  assert.ok(d.action === "watch" || d.action === "avoid", `got ${d.action}`);
  assert.ok(d.warnings.some((w) => w.includes("恐慌")));
});

test("falling knife (-6%+) is a fatal avoid", () => {
  const d = computeDecision(
    mkInput({
      layer1: mkLayer1({ pctChange: -6.5, priceVsVwap: -2, intradayScore: 25, trendTag: "bear" }),
    })
  );
  assert.equal(d.action, "avoid");
});

test("bearish daily structure below MA20 is avoided", () => {
  const d = computeDecision(
    mkInput({
      layer1: mkLayer1({ dailyScore: 30, ma20: 11, price: 10.5, pctChange: 2 }),
    })
  );
  assert.equal(d.action, "avoid");
  assert.ok(d.warnings.some((w) => w.includes("空头")));
});

test("near limit-up gets capped to watch with a chase warning", () => {
  const d = computeDecision(
    mkInput({ layer1: mkLayer1({ distanceToLimitUp: 0.5 }) })
  );
  assert.ok(d.action === "watch" || d.action === "avoid", `got ${d.action}`);
  assert.ok(d.warnings.some((w) => w.includes("涨停")));
});

test("weak regime requires very high score for buy", () => {
  const d = computeDecision(
    mkInput({
      regime: mkRegime({ kind: "weak", label: "弱势市", score: -35 }),
      layer1: mkLayer1({ intradayScore: 63, dailyScore: 60 }),
    })
  );
  assert.ok(d.action === "watch" || d.action === "avoid", `weak regime got ${d.action}`);
});

const POS: Position = {
  symbol: "sh600000",
  entryPrice: 10,
  shares: 10,
  trailPct: null,
  stopLossPct: null,
  createdAt: Date.now(),
};

function mkExit(over: Partial<ExitState> = {}): ExitState {
  return {
    symbol: "sh600000",
    kind: "watching",
    entryPrice: 10,
    peak: 10.5,
    targetPrice: 10.29,
    stopLossPrice: 9.7,
    pnlPct: 5,
    trailPct: 0.02,
    stopLossPct: 0.03,
    trailMode: "atr",
    acknowledged: false,
    message: null,
    updatedAt: Date.now(),
    ...over,
  };
}

test("holder: stop-loss warning forces exit decision", () => {
  const d = computeDecision(
    mkInput({
      position: POS,
      exit: mkExit({ kind: "stop_loss_warn", pnlPct: -3.2 }),
      layer1: mkLayer1({ pctChange: -3.2 }),
    })
  );
  assert.equal(d.action, "exit");
});

test("holder: take-profit warn with weak intraday -> exit, strong intraday -> reduce", () => {
  const weak = computeDecision(
    mkInput({
      position: POS,
      exit: mkExit({ kind: "take_profit_warn" }),
      layer1: mkLayer1({ intradayScore: 35, trendTag: "neutral" }),
    })
  );
  assert.equal(weak.action, "exit");

  const strong = computeDecision(
    mkInput({
      position: POS,
      exit: mkExit({ kind: "take_profit_warn" }),
      layer1: mkLayer1({ intradayScore: 65 }),
    })
  );
  assert.equal(strong.action, "reduce");
});

test("holder: healthy uptrend position holds", () => {
  const d = computeDecision(mkInput({ position: POS, exit: mkExit() }));
  assert.equal(d.action, "hold");
});

test("holder: multi-signal deterioration suggests reduce", () => {
  const d = computeDecision(
    mkInput({
      position: POS,
      exit: mkExit(),
      sector: mkSector(30),
      layer1: mkLayer1({
        intradayScore: 35,
        priceVsVwap: -1.5,
        intradayMomentum15: -2,
        dailyScore: 60,
      }),
    })
  );
  assert.equal(d.action, "reduce");
});

test("missing sector/regime degrade confidence but still decide", () => {
  const d = computeDecision(mkInput({ sector: null, regime: null }));
  assert.ok(d.confidence < 80, `confidence ${d.confidence}`);
  assert.ok(d.action != null);
});
