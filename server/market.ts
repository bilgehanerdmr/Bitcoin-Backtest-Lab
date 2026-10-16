import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { intervals, type Candle, type Interval } from '../shared/types';
import { HttpError } from './errors';
mkdirSync('data', { recursive: true });
export const db = new DatabaseSync(process.env.DATABASE_PATH || 'data/bitcoin-lab.sqlite');
db.exec(
  'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS candles (interval TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(interval,time)); CREATE TABLE IF NOT EXISTS backtests (id TEXT PRIMARY KEY, created_at TEXT, payload TEXT); CREATE TABLE IF NOT EXISTS candle_gaps (interval TEXT, time INTEGER, PRIMARY KEY(interval,time));',
);
let retryAfter = 0;
export async function binance(path: string, params: Record<string, string> = {}) {
  if (Date.now() < retryAfter)
    throw new HttpError(
      503,
      'Veri sağlayıcının istek sınırına ulaşıldı. Biraz sonra tekrar deneyin.',
    );
  let response: Response;
  try {
    response = await fetch(
      `https://data-api.binance.vision/api/v3/${path}?${new URLSearchParams({ symbol: 'BTCUSDT', ...params })}`,
      { signal: AbortSignal.timeout(12000) },
    );
  } catch {
    throw new HttpError(
      502,
      'Binance bağlantısı kurulamadı. İnternet bağlantınızı kontrol edin veya demo moduna geçin.',
    );
  }
  if (response.status === 429 || response.status === 418) {
    retryAfter =
      Date.now() + Math.max(60, Number(response.headers.get('retry-after')) || 60) * 1000;
    throw new HttpError(503, 'Binance istek sınırı. Lütfen daha sonra tekrar deneyin.');
  }
  if (!response.ok) throw new HttpError(502, `Binance verisi alınamadı (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, 'Binance geçersiz bir yanıt döndürdü.');
  }
}
// A candle the WebSocket stream marked closed (`k.x`); REST serves the same row. Gaps
// before it are still left for getCandles to confirm against REST.
export function storeClosedCandle(interval: Interval, b: Candle) {
  const step = intervals[interval];
  if (
    ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
    b.time % step !== 0 ||
    // Allows for a local clock running slightly behind Binance.
    (b.time + step) * 1000 > Date.now() + 60000 ||
    b.low <= 0 ||
    b.volume < 0 ||
    b.high < Math.max(b.open, b.close) ||
    b.low > Math.min(b.open, b.close)
  )
    throw new HttpError(502, 'Veri sağlayıcı geçersiz mum döndürdü.');
  db.prepare('INSERT OR REPLACE INTO candles VALUES(?,?,?,?,?,?,?)').run(
    interval,
    b.time,
    b.open,
    b.high,
    b.low,
    b.close,
    b.volume,
  );
}
let queue: Promise<unknown> = Promise.resolve();
export function getCandles(interval: Interval, start: number, end: number): Promise<Candle[]> {
  const job = queue.then(() => loadCandles(interval, start, end));
  queue = job.catch(() => {});
  return job;
}
async function loadCandles(interval: Interval, start: number, end: number): Promise<Candle[]> {
  const step = intervals[interval];
  if (!step) throw new Error('Geçersiz zaman dilimi.');
  const from = Math.ceil(start / step) * step,
    to = Math.min(
      Math.floor(end / step) * step,
      Math.floor(Date.now() / 1000 / step) * step - step,
    );
  const count = Math.floor((to - from) / step) + 1;
  if (count <= 0) throw new Error('Bu aralıkta kapanmış mum yok.');
  if (count > 50000) throw new Error('En fazla 50.000 mum indirilebilir.');
  const read = () =>
    db
      .prepare(
        'SELECT time,open,high,low,close,volume FROM candles WHERE interval=? AND time>=? AND time<=? ORDER BY time',
      )
      .all(interval, from, to) as unknown as Candle[];
  // Open times Binance never produced (exchange outages), cached so they are not refetched.
  const covered = (candles: Candle[]) =>
    new Set([
      ...candles.map((b) => b.time),
      ...(
        db
          .prepare('SELECT time FROM candle_gaps WHERE interval=? AND time>=? AND time<=?')
          .all(interval, from, to) as { time: number }[]
      ).map((g) => g.time),
    ]);
  const existing = read();
  const known = covered(existing);
  if (known.size === count) return existing;
  const insert = db.prepare('INSERT OR REPLACE INTO candles VALUES(?,?,?,?,?,?,?)'),
    insertGap = db.prepare('INSERT OR IGNORE INTO candle_gaps VALUES(?,?)');
  let cursor = from;
  while (cursor <= to) {
    if (known.has(cursor)) {
      cursor += step;
      continue;
    }
    // No endTime: a later candle, even one past `to`, is what proves a skipped open time
    // does not exist on Binance. Missing candles with nothing after them stay unproven.
    const rows = (await binance('klines', {
      interval,
      startTime: String(cursor * 1000),
      limit: '1000',
    })) as unknown[][];
    if (!Array.isArray(rows) || !rows.length) break;
    db.exec('BEGIN');
    try {
      let expected = cursor;
      for (const row of rows) {
        const time = Number(row[0]) / 1000;
        if (!Number.isInteger(time) || time % step !== 0 || time < expected)
          throw new HttpError(502, 'Veri sağlayıcı geçersiz mum döndürdü.');
        for (; expected < Math.min(time, to + step); expected += step)
          insertGap.run(interval, expected);
        expected = time + step;
        if (time >= from && time <= to) {
          const values = [
            Number(row[1]),
            Number(row[2]),
            Number(row[3]),
            Number(row[4]),
            Number(row[5]),
          ];
          if (!values.every(Number.isFinite))
            throw new HttpError(502, 'Veri sağlayıcı geçersiz mum döndürdü.');
          insert.run(interval, time, ...values);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const next = Number(rows.at(-1)![0]) / 1000 + step;
    if (next <= cursor) throw new HttpError(502, 'Veri sayfalaması ilerleyemedi.');
    cursor = next;
    if (cursor <= to) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const result = read(),
    unresolved = count - covered(result).size;
  if (unresolved)
    throw new HttpError(
      502,
      `Eksik tarihsel veri: ${count} mumdan ${unresolved} tanesi alınamadı. Binance son mumları henüz yayınlamamış olabilir; biraz sonra tekrar deneyin veya tarih aralığını kontrol edin.`,
    );
  if (!result.length)
    throw new Error(
      'Binance bu aralıkta işlem yapmamış (borsa kesintisi). Tarih aralığını değiştirin.',
    );
  return result;
}
