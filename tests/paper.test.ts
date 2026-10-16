import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backtest } from '../shared/engine';
import { demoCandles } from '../shared/demo';
import { patternStrategy } from '../shared/candle-rules';
import { validateBackup } from '../shared/backup';
import { defaultConfig, type Candle, type Config, type Result } from '../shared/types';
import type { PaperView } from '../shared/paper';
import type { PythonSignal } from '../shared/python-strategy';
import { runPython } from '../server/python';
import type { PaperManager, PaperManagerOptions } from '../server/paper';

// Two days back from the real date, so templates and defaults (dated from today) stay valid
// under the fake clock.
const STEP = 60,
  T0 = Math.floor(Date.now() / 86400000) * 86400 - 2 * 86400,
  series = demoCandles('1m', T0, T0 + 299 * STEP),
  at = (i: number) => T0 + i * STEP;
const base: Config = {
  ...defaultConfig,
  interval: '1m',
  mode: 'live',
  start: '2024-01-01',
  end: '2024-01-01',
  capital: 10000,
  allocation: 90,
  fee: 0.1,
  slippage: 0.05,
  stopLoss: 0.4,
  takeProfit: 0.6,
  fast: 3,
  slow: 8,
  rsiPeriod: 5,
  rsiBuy: 40,
  rsiSell: 60,
  lookback: 10,
};
const pythonStrategy = {
  name: 'Parity Python',
  source: `def on_candle(candles, state):
    state["n"] = state.get("n", 0) + 1
    if len(candles) < 6:
        return "hold"
    avg = sum(c["close"] for c in candles[-6:]) / 6
    if candles[-1]["close"] > avg * 1.001:
        return "buy"
    if candles[-1]["close"] < avg * 0.999:
        print("sat", state["n"])
        return "sell"
    return None
`,
};
// Python sessions start a process per candle; leave room for slow CI machines.
vi.setConfig({ testTimeout: 120000 });
let market: typeof import('../server/market'),
  paperModule: typeof import('../server/paper'),
  storage: typeof import('../server/storage'),
  manager: PaperManager | undefined,
  exchange: { candles: Candle[]; lag: number };
async function load() {
  vi.resetModules();
  market = await import('../server/market');
  storage = await import('../server/storage');
  paperModule = await import('../server/paper');
}
beforeEach(async () => {
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.useFakeTimers({ toFake: ['Date'] });
  await load();
  exchange = { candles: series, lag: 0 };
  // Binance REST: candles from startTime that have closed at least `lag` seconds ago.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url).searchParams,
        from = Number(params.get('startTime')) / 1000,
        now = Date.now() / 1000 - exchange.lag;
      const rows = exchange.candles
        .filter((b) => b.time >= from && b.time + STEP <= now)
        .slice(0, Number(params.get('limit')))
        .map((b) => [
          b.time * 1000,
          `${b.open}`,
          `${b.high}`,
          `${b.low}`,
          `${b.close}`,
          `${b.volume}`,
        ]);
      return new Response(JSON.stringify(rows));
    }),
  );
});
afterEach(() => {
  manager?.close();
  manager = undefined;
  market.db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const create = (options: PaperManagerOptions = {}) =>
  (manager = paperModule.createPaperManager({ background: false, ...options }));
// Starts 20 s into candle 100, so candle 101 is the first that may trade.
async function start(config: Config, warmup = 60): Promise<PaperView> {
  vi.setSystemTime((at(100) + 20) * 1000);
  return manager!.start({ config, warmup });
}
// The WebSocket's closed-kline event, one second after the candle closes.
async function close(candle: Candle) {
  vi.setSystemTime((candle.time + STEP + 1) * 1000);
  await manager!.ingest('1m', candle);
}
function backtestOf(
  s: PaperView,
  upTo: number,
  signals?: PythonSignal[],
  finalize = false,
  data = exchange.candles,
): Result {
  const window = data.filter((b) => b.time >= s.warmupStart && b.time <= upTo);
  return backtest(window, s.config, signals?.slice(0, window.length), {
    tradeFrom: s.tradeFrom,
    finalize,
  });
}
const report = (id: string): Result =>
  JSON.parse(
    (market.db.prepare('SELECT payload FROM backtests WHERE id=?').get(id) as { payload: string })
      .payload,
  );
async function pythonSignals(s: PaperView, data = exchange.candles) {
  return s.config.strategy === 'python'
    ? runPython(
        s.config.python!,
        data.filter((b) => b.time >= s.warmupStart),
      )
    : undefined;
}
// Feeds candles one at a time and checks every intermediate state and the final report
// against a backtest of exactly the same candles.
async function parity(config: Config, data: Candle[]) {
  exchange.candles = data;
  create();
  const s = await start(config),
    signals = await pythonSignals(s, data);
  for (const candle of data.filter((b) => b.time > s.lastProcessed!)) {
    await close(candle);
    const live = manager!.detail(s.id);
    expect(live.status).toBe('running');
    expect(live.lastProcessed).toBe(candle.time);
    if (candle.time < s.tradeFrom) continue;
    const expected = backtestOf(s, candle.time, signals);
    expect(live.equity).toEqual(expected.equity);
    expect(live.trades).toEqual(expected.trades);
    expect(live.metrics).toEqual(expected.metrics);
  }
  const stopped = await manager!.stop(s.id),
    final = report(stopped.reportId!),
    expected = backtestOf(s, data.at(-1)!.time, signals, true);
  expect(stopped.status).toBe('stopped');
  expect(final.trades).toEqual(expected.trades);
  expect(final.equity).toEqual(expected.equity);
  expect(final.metrics).toEqual(expected.metrics);
  expect(final.missingCandles).toBe(expected.missingCandles);
  expect(final.paper).toEqual({
    kind: 'session',
    sessionId: s.id,
    startedAt: s.createdAt,
    warmupStart: s.warmupStart,
  });
  expect(final.trades.length).toBeGreaterThan(2);
  return { s, final };
}

describe('Paper trading matches the backtest candle by candle', () => {
  it.each(['sma', 'rsi', 'breakout'] as const)('%s', async (strategy) => {
    const { s, final } = await parity({ ...base, strategy }, series);
    expect(final.start).toBe(s.tradeFrom);
    expect(final.candleCount).toBe(299 - 101 + 1);
  });
  it('custom candle rules', async () => {
    const { final } = await parity(
      { ...base, strategy: 'custom', custom: patternStrategy('three') },
      series,
    );
    expect(final.config.custom).toEqual(patternStrategy('three'));
  });
  it('Python, replayed from the warmup start on every candle', async () => {
    const { s } = await parity(
      { ...base, strategy: 'python', python: pythonStrategy },
      series.slice(0, 170),
    );
    const logs = manager!.detail(s.id).logs;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => /^\[\d{4}-\d\d-\d\d \d\d:\d\d\] sat \d+$/.test(line))).toBe(true);
  });
  it('a series with a Binance outage in warmup and during the session', async () => {
    const gaps = new Set([42, 43, 150, 151, 152]),
      { final } = await parity(
        { ...base, strategy: 'sma' },
        series.filter((_, i) => !gaps.has(i)),
      );
    expect(final.missingCandles).toBe(3);
  });
});

describe('Live data handling', () => {
  it('waits without trading while a gap is unconfirmed, then catches up', async () => {
    create();
    const s = await start({ ...base, strategy: 'sma' });
    await close(series[100]);
    await close(series[101]);
    // The stream misses candle 102 and REST has not published anything recent yet.
    exchange.lag = 3600;
    await close(series[103]);
    let live = manager!.detail(s.id);
    expect(live.status).toBe('waiting');
    expect(live.message).toMatch(/Eksik tarihsel veri/);
    expect(live.lastProcessed).toBe(at(101));
    expect(live.equity).toHaveLength(1);
    exchange.lag = 0;
    vi.setSystemTime((at(104) + 20) * 1000);
    await manager!.tick();
    live = manager!.detail(s.id);
    expect(live.status).toBe('running');
    expect(live.lastProcessed).toBe(at(103));
    expect(live.equity).toEqual(backtestOf(s, at(103)).equity);
  });
  it('fills candles missed while the stream was down on the next tick', async () => {
    create();
    const s = await start({ ...base, strategy: 'rsi' });
    for (const candle of series.slice(100, 121)) await close(candle);
    // No stream events for candles 121..140; the periodic REST check catches up.
    vi.setSystemTime((at(141) + 20) * 1000);
    await manager!.tick();
    const live = manager!.detail(s.id),
      expected = backtestOf(s, at(140));
    expect(live.lastProcessed).toBe(at(140));
    expect(live.equity).toEqual(expected.equity);
    expect(live.trades).toEqual(expected.trades);
  });
  it('continues after a server restart and processes the candles it missed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'paper-restart-'));
    try {
      market.db.close();
      vi.stubEnv('DATABASE_PATH', path.join(dir, 'lab.sqlite'));
      await load();
      create();
      const s = await start({ ...base, strategy: 'python', python: pythonStrategy });
      for (const candle of series.slice(100, 121)) await close(candle);
      manager!.close();
      market.db.close();
      await load();
      create();
      vi.setSystemTime((at(141) + 20) * 1000);
      await manager!.resume();
      const live = manager!.detail(s.id),
        expected = backtestOf(s, at(140), await pythonSignals(s));
      expect(live.status).toBe('running');
      expect(live.lastProcessed).toBe(at(140));
      expect(live.equity).toEqual(expected.equity);
      expect(live.trades).toEqual(expected.trades);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Session lifecycle', () => {
  it('puts only the failing Python session in the error state', async () => {
    create();
    const failing = await start({
        ...base,
        strategy: 'python',
        python: {
          name: 'Hatalı',
          source:
            'def on_candle(candles, state):\n    if len(candles) == 75:\n        raise ValueError("kasıtlı hata")\n    return "hold"\n',
        },
      }),
      healthy = await manager!.start({ config: { ...base, strategy: 'sma' }, warmup: 60 });
    for (const candle of series.slice(100, 118)) await close(candle);
    const broken = manager!.detail(failing.id);
    expect(broken.status).toBe('error');
    expect(broken.message).toMatch(/satır 3.*ValueError: kasıtlı hata/);
    // len(candles) == 75 is candle 115; 114 was the last one processed.
    expect(broken.lastProcessed).toBe(at(114));
    expect(manager!.detail(healthy.id)).toMatchObject({
      status: 'running',
      lastProcessed: at(117),
    });
    const stopped = await manager!.stop(failing.id);
    expect(report(stopped.reportId!).end).toBe(at(114));
  });
  it('rejects a Python strategy that changes signals for candles already processed', async () => {
    create();
    const s = await start({
      ...base,
      strategy: 'python',
      python: {
        name: 'Rastgele',
        source:
          'import random\ndef on_candle(candles, state):\n    return random.choice(["buy", "sell"])\n',
      },
    });
    await close(series[100]);
    expect(manager!.detail(s.id)).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/deterministik/),
    });
  });
  it('keeps its own copy of the strategy when the template is edited or deleted', async () => {
    create();
    const config = { ...base, strategy: 'python' as const, python: pythonStrategy };
    storage.writeWorkspace({ presets: [{ name: 'Şablon', config }], defaults: {} });
    const s = await start(storage.readWorkspace()!.presets[0].config);
    await close(series[100]);
    storage.writeWorkspace({
      presets: [
        {
          name: 'Şablon',
          config: {
            ...config,
            python: { ...pythonStrategy, source: 'def on_candle(c, s):\n  return "buy"\n' },
          },
        },
      ],
      defaults: {},
    });
    await close(series[101]);
    storage.writeWorkspace({ presets: [], defaults: {} });
    for (const candle of series.slice(102, 110)) await close(candle);
    const live = manager!.detail(s.id);
    expect(live.status).toBe('running');
    expect(live.config.python).toEqual(pythonStrategy);
    expect(live.equity).toEqual(backtestOf(s, at(109), await pythonSignals(s)).equity);
  });
  it('runs at most three sessions at a time', async () => {
    create();
    const sessions = [];
    for (let i = 0; i < 3; i++) sessions.push(await start({ ...base, strategy: 'sma' }));
    await expect(start({ ...base, strategy: 'rsi' })).rejects.toMatchObject({ status: 409 });
    await manager!.stop(sessions[0].id);
    await expect(start({ ...base, strategy: 'rsi' })).resolves.toMatchObject({ status: 'running' });
  });
  it('rejects invalid settings as user errors', async () => {
    create();
    await expect(start({ ...base, strategy: 'sma' }, 3)).rejects.toThrow(/Isınma mumu sayısı 10–/);
    await expect(start({ ...base, strategy: 'sma', fast: 30, slow: 10 })).rejects.toThrow(
      /Hızlı ortalama/,
    );
    expect(manager!.list()).toEqual([]);
  });
  it('stops itself at the candle limit and saves the final report', async () => {
    create({ maxCandles: 80 });
    const s = await start({ ...base, strategy: 'sma' });
    for (const candle of series.slice(100, 125)) await close(candle);
    const live = manager!.detail(s.id);
    expect(live.status).toBe('stopped');
    expect(live.stopReason).toMatch(/80 mum sınırına/);
    expect(live.lastProcessed).toBe(at(120));
    expect(report(live.reportId!).equity).toEqual(backtestOf(s, at(120), undefined, true).equity);
  });
  it('runs a labelled fast demo stream offline, paused while the server is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Demo must not use the network'))),
    );
    create();
    vi.setSystemTime(at(1000) * 1000 + 300);
    const s = await manager!.start({
      config: { ...base, mode: 'demo', strategy: 'sma' },
      warmup: 60,
      demoSpeed: 'fast',
    });
    expect(s).toMatchObject({ feed: 'demo', tradeFrom: at(1001), demoSpeed: 'fast' });
    vi.setSystemTime(at(1000) * 1000 + 300 + 5000);
    await manager!.tick();
    const demo = demoCandles('1m', s.warmupStart, at(1005)),
      live = manager!.detail(s.id);
    expect(live.lastProcessed).toBe(at(1005));
    expect(live.equity).toEqual(backtestOf(s, at(1005), undefined, false, demo).equity);
    vi.setSystemTime(at(1000) * 1000 + 300 + 60000);
    await manager!.resume();
    expect(manager!.detail(s.id).lastProcessed).toBe(at(1005));
  });
  it('saves a labelled comparison backtest that matches the live result', async () => {
    create();
    const s = await start({ ...base, strategy: 'python', python: pythonStrategy });
    for (const candle of series.slice(100, 130)) await close(candle);
    const compared = await manager!.compare(s.id),
      saved = report(compared.comparison!.reportId);
    expect(compared.comparison).toMatchObject({
      identical: true,
      differences: [],
      candleCount: 29,
    });
    expect(compared.comparison!.live).toEqual(compared.comparison!.backtest);
    expect(saved.paper).toMatchObject({ kind: 'comparison', sessionId: s.id });
    expect(saved.trades).toEqual(backtestOf(s, at(129), await pythonSignals(s), true).trades);
  });
  it('round-trips sessions through a backup and imports running ones as stopped', async () => {
    create();
    const s = await start({ ...base, strategy: 'sma' });
    for (const candle of series.slice(100, 140)) await close(candle);
    const backup = JSON.parse(JSON.stringify(storage.exportBackup())),
      before = manager!.detail(s.id);
    expect(() => validateBackup(backup)).not.toThrow();
    manager!.close();
    market.db.close();
    await load();
    expect(storage.importBackup(backup)).toMatchObject({ sessionsAdded: 1, sessionsSkipped: 0 });
    expect(storage.importBackup(backup)).toMatchObject({ sessionsAdded: 0, sessionsSkipped: 1 });
    create();
    const restored = manager!.detail(s.id);
    expect(restored.status).toBe('stopped');
    expect(restored.stopReason).toMatch(/Yedekten içe aktarıldı/);
    expect(restored.equity).toEqual(before.equity);
    expect(restored.trades).toEqual(before.trades);
    const legacy = { ...backup };
    delete legacy.paperSessions;
    expect(() => validateBackup(legacy)).not.toThrow();
    backup.paperSessions[0].equity[3].time += 1;
    expect(() => validateBackup(backup)).toThrow(/sermaye eğrisi/);
  });
});
