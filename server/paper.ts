import { randomUUID } from 'node:crypto';
import {
  intervals,
  symbolOf,
  type Candle,
  type Interval,
  type Result,
  type Trade,
} from '../shared/types';
import { backtest, simulate, strategySignals, strategyWarmup } from '../shared/engine';
import {
  MAX_ACTIVE_SESSIONS,
  PAPER_MAX_CANDLES,
  utcDate,
  validatePaperStart,
  type PaperDetail,
  type PaperSession,
  type PaperStart,
  type PaperView,
} from '../shared/paper';
import type { PythonSignal } from '../shared/python-strategy';
import { HttpError } from './errors';
import { getCandles, storeClosedCandle } from './market';
import { createBinanceFeed, type SocketFactory } from './paper-feed';
import * as store from './paper-store';
import { replayPython, runPython } from './python';
import { saveReport } from './storage';

export interface PaperManagerOptions {
  // Background ticking and the Binance stream. Tests turn it off and call tick()/ingest().
  background?: boolean;
  openSocket?: SocketFactory;
  maxCandles?: number;
}
// Seconds after a close before Binance REST is expected to serve the candle.
const SETTLE = 15;
const WAIT_RETRY_MS = 10000;
const MAX_LOG_LINES = 200;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const stamp = (time: number) => new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ');
const describe = (t?: Trade) =>
  t
    ? `${stamp(t.entryTime)} giriş @ ${t.entry.toFixed(2)}, ${stamp(t.exitTime)} çıkış (${t.reason})`
    : 'yok';
function diffReports(live: Result, test: Result): string[] {
  const out: string[] = [];
  if (live.trades.length !== test.trades.length)
    out.push(`İşlem sayısı farklı: canlı ${live.trades.length}, backtest ${test.trades.length}.`);
  for (let i = 0; i < Math.max(live.trades.length, test.trades.length) && out.length < 10; i++)
    if (JSON.stringify(live.trades[i]) !== JSON.stringify(test.trades[i]))
      out.push(
        `İşlem #${i + 1}: canlı ${describe(live.trades[i])}; backtest ${describe(test.trades[i])}.`,
      );
  const k = live.equity.findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(test.equity[i]));
  if (k >= 0 || live.equity.length !== test.equity.length)
    out.push(
      `Sermaye eğrisi ${stamp((live.equity[k] ?? test.equity[live.equity.length] ?? live.equity.at(-1))!.time)} UTC mumunda ayrışıyor.`,
    );
  return out;
}

export type PaperManager = ReturnType<typeof createPaperManager>;
// Runs paper sessions on the server. Every closed candle replays the session through the
// backtest engine's own functions (and the Python strategy from its warmup start), so the
// live result is by construction the backtest of the same candles.
export function createPaperManager(options: PaperManagerOptions = {}) {
  const background = options.background ?? true,
    maxCandles = options.maxCandles ?? PAPER_MAX_CANDLES,
    queues = new Map<string, Promise<unknown>>(),
    pending = new Map<string, number>(),
    retryAt = new Map<string, number>();
  let pythonQueue: Promise<unknown> = Promise.resolve(),
    starting = 0;
  const feed = background ? createBinanceFeed(ingest, () => void tick(), options.openSocket) : null;
  const timer = background ? setInterval(() => void tick(), 1000) : null;

  // One job at a time per session, so candles are processed in order.
  function serial<T>(id: string, job: () => Promise<T>): Promise<T> {
    pending.set(id, (pending.get(id) ?? 0) + 1);
    const next = (queues.get(id) ?? Promise.resolve()).then(job).finally(() => {
      pending.set(id, pending.get(id)! - 1);
    });
    queues.set(
      id,
      next.catch(() => {}),
    );
    return next;
  }
  // Python runs one at a time to bound CPU use across sessions.
  function pythonJob<T>(job: () => Promise<T>): Promise<T> {
    const next = pythonQueue.then(job);
    pythonQueue = next.catch(() => {});
    return next;
  }
  const active = () => store.listSessions().filter((s) => s.status !== 'stopped');
  function syncFeed() {
    feed?.watch(active().map((s) => ({ symbol: symbolOf(s.config), interval: s.config.interval })));
  }
  // Open time of the newest candle that has closed for this session.
  function closedUntil(s: PaperSession, settle = 0): number {
    const step = intervals[s.config.interval];
    return Math.floor((Date.now() / 1000 - settle) / step) * step - step;
  }
  function load(s: PaperSession, end: number): Promise<Candle[]> {
    return getCandles(symbolOf(s.config), s.config.interval, s.warmupStart, end);
  }
  // A session ends where a backtest of it would stop being valid: maxCandles in one
  // simulation, and whole report days within 50,000 candles.
  function fits(s: PaperSession, end: number): boolean {
    const step = intervals[s.config.interval],
      days =
        (Date.parse(utcDate(end) + 'T23:59:59Z') -
          Date.parse(utcDate(s.tradeFrom) + 'T00:00:00Z')) /
        1000;
    return (end - s.warmupStart) / step + 1 <= maxCandles && days <= PAPER_MAX_CANDLES * step;
  }
  // Replays the session over all of its candles and records what the new ones added.
  async function process(s: PaperSession, candles: Candle[], end: number) {
    const prev = s.lastProcessed ?? -Infinity,
      firstNew = candles.findIndex((b) => b.time > prev),
      fresh = firstNew < 0 ? [] : candles.slice(firstNew),
      done = candles.length - fresh.length;
    let signals: PythonSignal[];
    if (s.config.strategy === 'python') {
      // Warmup output is not shown; logs start with the first candle closed after start.
      const replay = await pythonJob(() =>
        replayPython(s.config.python!, candles, s.lastProcessed === null ? candles.length : done),
      );
      const committed = store.readSignals(s.id);
      // State is rebuilt on every replay, so candles already acted on must get the same
      // signals again; anything else would silently rewrite the session's history.
      if (
        committed.length !== done ||
        committed.some((r, i) => r.time !== candles[i].time || r.signal !== replay.signals[i])
      )
        throw new Error(
          'Python stratejisi daha önce işlenen mumlar için farklı sinyal üretti. Strateji deterministik olmalı: rastgelelik, saat veya dış veri kullanmayın.',
        );
      signals = replay.signals;
      const lines = replay.logs.split('\n').filter((line) => line.trim());
      if (lines.length)
        s.logs = [...s.logs, ...lines.map((line) => `[${stamp(end)}] ${line}`)].slice(
          -MAX_LOG_LINES,
        );
    } else
      signals = strategySignals(candles, s.config).map((x) =>
        x.sell ? 'sell' : x.buy ? 'buy' : 'hold',
      );
    const rows: store.SessionRows = {
      signals: fresh.map((b, i) => ({ time: b.time, signal: signals[done + i] })),
    };
    const trading = candles.some((b) => b.time >= s.tradeFrom);
    if (trading && candles.length >= strategyWarmup(s.config) + 3) {
      const { result, portfolio } = simulate(
        candles,
        s.config,
        s.config.strategy === 'python' ? signals : undefined,
        { tradeFrom: s.tradeFrom, finalize: false },
      );
      const p = portfolio.position,
        close = candles.at(-1)!.close;
      rows.equity = result.equity.slice(s.tradingCandles);
      rows.trades = result.trades.slice(store.countTrades(s.id));
      s.position = p
        ? {
            entry: p.entry,
            quantity: p.quantity,
            time: p.time,
            cost: p.cost,
            value: p.quantity * close,
          }
        : null;
      s.metrics = result.metrics;
      s.tradingCandles = result.candleCount;
      s.missingCandles = result.missingCandles ?? 0;
    }
    s.lastProcessed = end;
    s.candleCount = candles.length;
    if (fresh.length) s.lastSignal = { time: fresh.at(-1)!.time, signal: signals.at(-1)! };
    s.status = 'running';
    s.message = trading
      ? ''
      : `Isınma mumları yüklendi. İşlemler ${stamp(s.tradeFrom)} UTC açılışında başlayan mumla başlar.`;
    store.saveSession(s, rows);
  }
  async function advance(id: string, upTo: number) {
    const s = store.readSession(id);
    if (!s || s.status === 'stopped' || s.status === 'error' || s.lastProcessed === null) return;
    const step = intervals[s.config.interval];
    let end = Math.min(upTo, closedUntil(s));
    while (end > s.lastProcessed && !fits(s, end)) end -= step;
    if (end > s.lastProcessed) {
      let candles: Candle[];
      try {
        candles = await load(s, end);
        retryAt.delete(id);
      } catch (e) {
        // Missing data is never invented: wait until Binance serves the candles or proves
        // the gap with a later one.
        s.status = 'waiting';
        s.message = errorText(e);
        retryAt.set(id, Date.now() + WAIT_RETRY_MS);
        store.saveSession(s);
        return;
      }
      try {
        await process(s, candles, end);
      } catch (e) {
        const failed = store.readSession(id)!;
        failed.status = 'error';
        failed.message = `${stamp(end)} UTC mumu işlenemedi. ${errorText(e)}`;
        store.saveSession(failed);
        return;
      }
    }
    if (!fits(s, s.lastProcessed + step))
      await finish(
        s,
        `Oturum ${maxCandles.toLocaleString('tr-TR')} mum sınırına ulaştı ve kendiliğinden durdu.`,
      );
  }
  // The report a backtest over the session's candles gives: warmup before `tradeFrom` and the
  // end-of-test close at the last processed candle. 'session' uses the signals recorded live;
  // 'comparison' runs the Python strategy again in one pass, as a backtest would.
  async function report(s: PaperSession, kind: 'session' | 'comparison'): Promise<Result> {
    const end = s.lastProcessed!,
      candles = await load(s, end);
    let signals: PythonSignal[] | undefined;
    if (s.config.strategy === 'python') {
      if (kind === 'session') {
        const recorded = new Map(store.readSignals(s.id).map((r) => [r.time, r.signal]));
        signals = candles.map((b) => recorded.get(b.time)!);
        if (signals.some((x) => !x)) throw new Error('Kayıtlı Python sinyalleri eksik.');
      } else signals = await pythonJob(() => runPython(s.config.python!, candles));
    }
    const result = backtest(
      candles,
      { ...s.config, start: utcDate(s.tradeFrom), end: utcDate(end) },
      signals,
      { tradeFrom: s.tradeFrom },
    );
    result.paper = { kind, sessionId: s.id, startedAt: s.createdAt, warmupStart: s.warmupStart };
    return result;
  }
  async function finish(s: PaperSession, reason: string): Promise<PaperSession> {
    s.status = 'stopped';
    s.stoppedAt = new Date().toISOString();
    s.stopReason = reason;
    if (s.lastProcessed !== null && s.tradingCandles >= 3) {
      try {
        const final = await report(s, 'session');
        saveReport(final);
        s.reportId = final.id;
        s.message = '';
      } catch (e) {
        s.message = 'Nihai rapor oluşturulamadı: ' + errorText(e);
      }
    } else s.message = "Rapor için en az 3 işlem mumu gerekir; Test Geçmişi'ne rapor kaydedilmedi.";
    store.saveSession(s);
    retryAt.delete(s.id);
    syncFeed();
    return s;
  }
  function find(id: string): PaperSession {
    const s = store.readSession(id);
    if (!s) throw new HttpError(404, 'Canlı test oturumu bulunamadı.');
    return s;
  }
  function view(s: PaperSession): PaperView {
    return {
      ...s,
      feed: s.status === 'stopped' ? null : (feed?.status() ?? 'connecting'),
      tradeCount: store.countTrades(s.id),
    };
  }
  function tick(): Promise<void> {
    const now = Date.now(),
      jobs: Promise<void>[] = [];
    for (const s of active()) {
      if (s.status === 'error' || pending.get(s.id) || (retryAt.get(s.id) ?? 0) > now) continue;
      const end = closedUntil(s, SETTLE);
      jobs.push(serial(s.id, () => advance(s.id, end)));
    }
    return Promise.all(jobs).then(() => {});
  }
  // A candle the WebSocket marked closed: cache it, then let matching sessions catch up.
  function ingest(symbol: string, interval: Interval, candle: Candle): Promise<void> {
    try {
      storeClosedCandle(symbol, interval, candle);
    } catch {
      return Promise.resolve();
    }
    return Promise.all(
      active()
        .filter((s) => symbolOf(s.config) === symbol && s.config.interval === interval)
        .map((s) => serial(s.id, () => advance(s.id, candle.time))),
    ).then(() => {});
  }
  async function start(input: unknown): Promise<PaperView> {
    const raw = (input ?? {}) as Partial<PaperStart>,
      now = Date.now() / 1000,
      today = utcDate(now),
      request = { ...raw, config: { ...raw.config, start: today, end: today } } as PaperStart;
    validatePaperStart(request);
    if (active().length + starting >= MAX_ACTIVE_SESSIONS)
      throw new HttpError(
        409,
        `Aynı anda en fazla ${MAX_ACTIVE_SESSIONS} canlı test çalışabilir. Önce birini durdurun.`,
      );
    const config = structuredClone(request.config),
      step = intervals[config.interval],
      tradeFrom = Math.ceil(now / step) * step;
    const s: PaperSession = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      config,
      warmup: request.warmup,
      demoSpeed: null,
      status: 'running',
      message: '',
      warmupStart: tradeFrom - request.warmup * step,
      tradeFrom,
      lastProcessed: null,
      candleCount: 0,
      tradingCandles: 0,
      missingCandles: 0,
      lastSignal: null,
      position: null,
      metrics: null,
      logs: [],
      stoppedAt: null,
      stopReason: null,
      reportId: null,
      comparison: null,
      clock: null,
    };
    starting++;
    try {
      // History is loaded and the strategy run over it before the session is stored, so an
      // unreachable data source or a broken strategy is reported to the user right away.
      const end = closedUntil(s, SETTLE);
      await process(s, await load(s, end), end);
    } finally {
      starting--;
    }
    syncFeed();
    return view(s);
  }
  return {
    start,
    tick,
    ingest,
    list: () => store.listSessions().map(view),
    detail(id: string): PaperDetail {
      return { ...view(find(id)), trades: store.readTrades(id), equity: store.readEquity(id) };
    },
    stop(id: string): Promise<PaperView> {
      return serial(id, async () => {
        const s = find(id);
        if (s.status === 'stopped') throw new Error('Oturum zaten durdurulmuş.');
        return view(await finish(s, 'Kullanıcı tarafından durduruldu.'));
      });
    },
    retry(id: string): Promise<PaperView> {
      return serial(id, async () => {
        const s = find(id);
        if (s.status === 'stopped') throw new Error('Durdurulmuş oturum yeniden başlatılamaz.');
        s.status = 'running';
        s.message = '';
        retryAt.delete(id);
        store.saveSession(s);
        await advance(id, closedUntil(s, SETTLE));
        return view(find(id));
      });
    },
    compare(id: string): Promise<PaperView> {
      return serial(id, async () => {
        const s = find(id);
        if (s.lastProcessed === null || s.tradingCandles < 3)
          throw new Error('Karşılaştırma için en az 3 işlem mumu gerekir.');
        const live = await report(s, 'session'),
          test = await report(s, 'comparison'),
          differences = diffReports(live, test);
        saveReport(test);
        s.comparison = {
          reportId: test.id,
          at: new Date().toISOString(),
          lastCandle: s.lastProcessed,
          candleCount: test.candleCount,
          identical: !differences.length,
          differences,
          live: { ...live.metrics, trades: live.trades.length },
          backtest: { ...test.metrics, trades: test.trades.length },
        };
        store.saveSession(s);
        return view(s);
      });
    },
    // After a restart the next tick fetches every candle that closed while the server was
    // down. Sessions left running in the removed demo mode cannot continue; they stop, and
    // what they recorded stays viewable.
    resume(): Promise<void> {
      for (const s of active())
        if (s.config.mode === 'demo') {
          s.status = 'stopped';
          s.stoppedAt = new Date().toISOString();
          s.stopReason =
            'Demo modu kaldırıldığı için oturum durduruldu. Kaydedilen sonuçlar görüntülenebilir.';
          s.message = '';
          s.clock = null;
          store.saveSession(s);
        }
      syncFeed();
      return tick();
    },
    close() {
      if (timer) clearInterval(timer);
      feed?.close();
    },
  };
}
