import { db, binance } from './market';
import { SYMBOL_PATTERN } from '../shared/types';
import type { PairInfo } from '../shared/pairs';

db.exec(
  'CREATE TABLE IF NOT EXISTS pairs (symbol TEXT PRIMARY KEY, base TEXT NOT NULL, tick_size TEXT NOT NULL, step_size TEXT NOT NULL, listed INTEGER); CREATE TABLE IF NOT EXISTS pairs_meta (id INTEGER PRIMARY KEY CHECK(id=1), fetched_at INTEGER NOT NULL);',
);
const DAY_MS = 86400000;
type Row = {
  symbol: string;
  base: string;
  tick_size: string;
  step_size: string;
  listed: number | null;
};
const toPair = (r: Row): PairInfo => ({
  symbol: r.symbol,
  base: r.base,
  tickSize: r.tick_size,
  stepSize: r.step_size,
  listed: r.listed,
});
const stored = () => (db.prepare('SELECT * FROM pairs ORDER BY base').all() as Row[]).map(toPair);
interface ExchangeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed?: boolean;
  filters: { filterType: string; tickSize?: string; stepSize?: string }[];
}
// Binance's full exchange info is several megabytes, so the USDT spot pairs are kept in
// SQLite and refreshed once a day. A failed refresh keeps serving the last good list.
let refreshing: Promise<PairInfo[]> | null = null;
export async function listPairs(): Promise<PairInfo[]> {
  const meta = db.prepare('SELECT fetched_at FROM pairs_meta WHERE id=1').get() as
    { fetched_at: number } | undefined;
  if (meta && Date.now() - meta.fetched_at < DAY_MS) return stored();
  refreshing ??= refresh().finally(() => (refreshing = null));
  try {
    return await refreshing;
  } catch (e) {
    if (meta) return stored();
    throw e;
  }
}
async function refresh(): Promise<PairInfo[]> {
  const info = (await binance('exchangeInfo', {
    permissions: 'SPOT',
    symbolStatus: 'TRADING',
  })) as { symbols?: ExchangeSymbol[] };
  const filter = (s: ExchangeSymbol, type: string, key: 'tickSize' | 'stepSize') =>
    s.filters.find((f) => f.filterType === type)?.[key];
  const pairs = (info.symbols ?? []).filter(
    (s) =>
      s.quoteAsset === 'USDT' &&
      s.status === 'TRADING' &&
      s.isSpotTradingAllowed !== false &&
      // Symbols the stream names and URLs cannot carry (e.g. non-Latin letters) are left out.
      SYMBOL_PATTERN.test(s.symbol) &&
      filter(s, 'PRICE_FILTER', 'tickSize') &&
      filter(s, 'LOT_SIZE', 'stepSize'),
  );
  if (!pairs.length) throw new Error('Binance işlem çifti listesi boş döndü.');
  const upsert = db.prepare(
    'INSERT INTO pairs (symbol,base,tick_size,step_size) VALUES (?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET base=excluded.base, tick_size=excluded.tick_size, step_size=excluded.step_size',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    // Listing dates are kept for pairs that stay; delisted pairs drop out of the list.
    db.prepare(`DELETE FROM pairs WHERE symbol NOT IN (${pairs.map(() => '?').join(',')})`).run(
      ...pairs.map((s) => s.symbol),
    );
    for (const s of pairs)
      upsert.run(
        s.symbol,
        s.baseAsset,
        filter(s, 'PRICE_FILTER', 'tickSize')!,
        filter(s, 'LOT_SIZE', 'stepSize')!,
      );
    db.prepare(
      'INSERT INTO pairs_meta (id,fetched_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at',
    ).run(Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return stored();
}
// The open time of the pair's first daily candle on Binance, looked up once and kept.
export async function pairInfo(symbol: string): Promise<PairInfo | null> {
  const pair = (await listPairs()).find((p) => p.symbol === symbol);
  if (!pair) return null;
  if (pair.listed !== null) return pair;
  const [first] = (await binance('klines', {
    symbol,
    interval: '1d',
    startTime: '0',
    limit: '1',
  })) as unknown[][];
  if (!first) return pair;
  const listed = Number(first[0]) / 1000;
  db.prepare('UPDATE pairs SET listed=? WHERE symbol=?').run(listed, symbol);
  return { ...pair, listed };
}
