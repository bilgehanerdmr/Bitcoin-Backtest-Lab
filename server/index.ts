import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { binance, db, getCandles } from './market';
import { backtest, validateConfig, validateLiveRange } from '../shared/engine';
import { demoCandles } from '../shared/demo';
import { intervals, type Config, type Interval, type Result } from '../shared/types';
import { runPython } from './python';
import { localAccess } from './local-access';
import { errorHandler } from './errors';
import { createPaperManager } from './paper';
import {
  deleteReports,
  exportBackup,
  importBackup,
  readWorkspace,
  saveReport,
  writeWorkspace,
} from './storage';
const app = express();
app.use('/api', localAccess);
// Larger parsers are scoped to portable backups and the local strategy library.
app.post('/api/backup/import', express.json({ limit: '100mb' }), (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(importBackup(req.body));
  } catch (e) {
    next(e);
  }
});
app.put('/api/workspace', express.json({ limit: '10mb' }), (req, res, next) => {
  try {
    writeWorkspace(req.body);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.use(express.json({ limit: '512kb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', service: 'Bitcoin Lab', time: new Date().toISOString() }),
);
let tickerCache: { time: number; data: unknown } | null = null;
app.get('/api/ticker', async (_req, res, next) => {
  try {
    if (!tickerCache || Date.now() - tickerCache.time > 5000)
      tickerCache = { time: Date.now(), data: await binance('ticker/24hr') };
    res.json(tickerCache.data);
  } catch (e) {
    next(e);
  }
});
app.get('/api/candles', async (req, res, next) => {
  try {
    const interval = String(req.query.interval || '1h') as Interval;
    if (!Object.hasOwn(intervals, interval)) throw new Error('Geçersiz zaman dilimi.');
    const end = Math.floor(Date.now() / 1000),
      start = end - intervals[interval] * 500;
    res.json({ candles: await getCandles(interval, start, end), source: 'Binance Spot' });
  } catch (e) {
    next(e);
  }
});
app.get('/api/datasets', (_req, res) =>
  res.json(
    db
      .prepare(
        'SELECT interval, COUNT(*) AS count, MIN(time) AS start, MAX(time) AS end FROM candles GROUP BY interval ORDER BY start',
      )
      .all(),
  ),
);
app.get('/api/workspace', (_req, res) => res.json(readWorkspace()));
app.get('/api/backup', (_req, res) => res.json(exportBackup()));
app.post('/api/backtests/delete', (req, res, next) => {
  try {
    const ids = deleteReports(req.body?.ids);
    res.json({ ids, deleted: ids.length });
  } catch (e) {
    next(e);
  }
});
app.get('/api/backtests', (req, res) => {
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ error: 'Geçersiz sayfa.' });
    return;
  }
  const rows = db
    .prepare('SELECT payload FROM backtests ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?')
    .all(offset) as { payload: string }[];
  res.json(
    rows.map((row) => {
      const { equity, trades, ...rest } = JSON.parse(row.payload) as Result;
      return { ...rest, tradeCount: trades.length };
    }),
  );
});
app.get('/api/backtests/:id', (req, res) => {
  const row = db.prepare('SELECT payload FROM backtests WHERE id=?').get(req.params.id) as
    { payload: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Rapor bulunamadı.' });
    return;
  }
  res.type('json').send(row.payload);
});
let running = false;
app.post('/api/python/validate', async (req, res, next) => {
  if (running) {
    res.status(409).json({ error: 'Bir test veya kod kontrolü zaten çalışıyor.' });
    return;
  }
  running = true;
  try {
    await runPython(req.body, null);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  } finally {
    running = false;
  }
});
app.post('/api/backtests', async (req, res, next) => {
  if (running) {
    res.status(409).json({ error: 'Bir test zaten çalışıyor. Tamamlanmasını bekleyin.' });
    return;
  }
  running = true;
  try {
    const config = req.body as Config;
    validateConfig(config);
    validateLiveRange(config);
    const start = Date.parse(config.start + 'T00:00:00Z') / 1000,
      end = Math.min(
        Date.parse(config.end + 'T23:59:59Z') / 1000,
        Math.floor(Date.now() / 1000 / intervals[config.interval]) * intervals[config.interval] -
          intervals[config.interval],
      );
    const candles =
      config.mode === 'demo'
        ? demoCandles(config.interval, start, end)
        : await getCandles(config.interval, start, end);
    const signals =
      config.strategy === 'python' ? await runPython(config.python!, candles) : undefined;
    const result = backtest(candles, config, signals);
    saveReport(result);
    res.json(result);
  } catch (e) {
    next(e);
  } finally {
    running = false;
  }
});
// Paper sessions run here, on the server, independent of any open browser tab.
const paper = createPaperManager();
app.get('/api/paper', (_req, res) => res.json(paper.list()));
app.get('/api/paper/:id', (req, res, next) => {
  try {
    res.json(paper.detail(req.params.id));
  } catch (e) {
    next(e);
  }
});
app.post('/api/paper', async (req, res, next) => {
  try {
    res.json(await paper.start(req.body));
  } catch (e) {
    next(e);
  }
});
for (const action of ['stop', 'retry', 'compare'] as const)
  app.post(`/api/paper/:id/${action}`, async (req, res, next) => {
    try {
      res.json(await paper[action](req.params.id));
    } catch (e) {
      next(e);
    }
  });
app.use('/api', (_req, res) => res.status(404).json({ error: 'API uç noktası bulunamadı.' }));
if (existsSync('dist/index.html')) {
  app.use(express.static('dist'));
  app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
}
app.use(errorHandler);
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  console.log(`Bitcoin Lab API: http://127.0.0.1:${port}`);
  // Sessions that were running before a restart continue and process missed candles.
  paper.resume().catch((e) => console.error(e));
});
