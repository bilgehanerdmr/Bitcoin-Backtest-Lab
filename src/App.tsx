import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bitcoin,
  Coins,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FlaskConical,
  History,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  Menu,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Trash2,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import {
  defaultConfig,
  intervals,
  LIVE_DATA_START,
  marketIntervals,
  strategyNames,
  strategyLabel,
  symbolOf,
  type Candle,
  type Config,
  type Interval,
  type Result,
  type Strategy,
} from '../shared/types';
import { api, date, download, money, pct } from './api';
import { useMarket } from './useMarket';
import { PriceChart, EquityChart } from './components/Chart';
import { validateConfig, validateDataSource, validateLiveRange } from '../shared/engine';
import { patternStrategy, ruleText } from '../shared/candle-rules';
import { CustomStrategyEditor } from './components/CustomStrategyEditor';
import { PythonStrategyEditor } from './components/PythonStrategyEditor';
import { examplePython } from '../shared/python-strategy';
import { BackupPanel } from './components/BackupPanel';
import { PaperTrading } from './components/PaperTrading';
import { UploadPanel } from './components/UploadPanel';
import { PairPicker } from './components/PairPicker';
import { baseOf, pairLabel, priceDecimals, stepDecimals, type PairInfo } from '../shared/pairs';
import type { UploadMeta } from '../shared/upload';
import { utcDate } from '../shared/paper';
import { TradeTable, tradesCsv } from './components/TradeTable';
import {
  emptyWorkspace,
  mergeWorkspace,
  validateWorkspace,
  type Preferences,
  type Workspace,
} from '../shared/workspace';

type Page = 'dashboard' | 'backtest' | 'paper' | 'strategies' | 'history' | 'data';
type Summary = Omit<Result, 'trades' | 'equity'> & { tradeCount: number };
type Dataset = { symbol: string; interval: Interval; count: number; start: number; end: number };
// A pair listed after the chosen start date moves the start to its listing day.
function fromListing(c: Config, symbol: string, first: string | undefined): Config {
  return first && !c.dataset && symbolOf(c) === symbol && c.start < first
    ? { ...c, start: first, end: c.end < first ? first : c.end }
    : c;
}
const navigation = [
  { id: 'dashboard', label: 'Genel Bakış', icon: LayoutDashboard },
  { id: 'backtest', label: 'Backtest Terminali', icon: FlaskConical },
  { id: 'paper', label: 'Canlı Test', icon: Radio },
  { id: 'strategies', label: 'Stratejiler', icon: Layers3 },
  { id: 'history', label: 'Test Geçmişi', icon: History },
  { id: 'data', label: 'Veri Merkezi', icon: Database },
] as const;
function readSaved<T>(key: string, fallback: T): T {
  try {
    const item = JSON.parse(localStorage.getItem(key) || 'null');
    return item ?? fallback;
  } catch {
    return fallback;
  }
}
const descriptions: Record<Strategy, string> = {
  sma: 'Kısa ve uzun vadeli ortalamaların kesişimiyle trendi takip edin.',
  rsi: 'Aşırı satım bölgelerinde giriş, aşırı alım bölgelerinde çıkış yapın.',
  breakout: 'Önceki mumların fiyat kanalını aşan hareketleri yakalayın.',
  custom: 'Gövde, fitil, fiyat ve hacim ilişkileriyle kendi mum formasyonunuzu tanımlayın.',
  python: 'Python dosyanı yükle, kendi sinyallerini üret ve mevcut risk ayarlarıyla test et.',
};
function App() {
  const [page, setPage] = useState<Page>('dashboard'),
    [interval, setInterval] = useState<Interval>('1h'),
    [config, setConfig] = useState<Config>(() => ({
      ...defaultConfig,
      ...readSaved('btc-defaults', {}),
    })),
    [indicators, setIndicators] = useState(true),
    [result, setResult] = useState<Result | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [history, setHistory] = useState<Summary[]>([]),
    [datasets, setDatasets] = useState<Dataset[]>([]),
    [uploads, setUploads] = useState<UploadMeta[]>([]),
    [uploadCandles, setUploadCandles] = useState<Candle[]>([]),
    [pairs, setPairs] = useState<PairInfo[]>([]),
    [listings, setListings] = useState<Record<string, number | null>>({}),
    [tab, setTab] = useState<'equity' | 'drawdown' | 'trades'>('equity'),
    [modal, setModal] = useState<'settings' | 'help' | 'save' | null>(null),
    [customEditor, setCustomEditor] = useState(false),
    [pythonEditor, setPythonEditor] = useState(false),
    [preferences, setPreferences] = useState<Preferences>({}),
    [workspaceReady, setWorkspaceReady] = useState(false),
    [workspaceSaving, setWorkspaceSaving] = useState(false),
    [deleteIds, setDeleteIds] = useState<string[]>([]),
    [presetDelete, setPresetDelete] = useState<number | null>(null),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(''),
    [hasMoreReports, setHasMoreReports] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [mobile, setMobile] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [tradePage, setTradePage] = useState(0),
    [presets, setPresets] = useState<{ name: string; config: Config }[]>(() =>
      readSaved('btc-presets', []),
    ),
    [presetName, setPresetName] = useState(''),
    [compare, setCompare] = useState<string[]>([]);
  const market = useMarket(symbolOf(config), interval),
    ticker = market.ticker,
    price = ticker ? +ticker.lastPrice : null,
    change = ticker ? +ticker.priceChangePercent : 0;
  // An uploaded dataset replaces Binance as the terminal's data: chart, prices and backtests.
  const upload = config.dataset ? (uploads.find((u) => u.id === config.dataset) ?? null) : null,
    chartCandles = upload ? uploadCandles : market.candles,
    symbol = symbolOf(config),
    base = baseOf(symbol);
  // Price decimals follow the pair's Binance tick size (8 for SHIBUSDT); uploaded data has
  // none, so its own prices decide.
  const digitsFor = (s: string) => {
      const pair = pairs.find((p) => p.symbol === s);
      return pair ? Math.max(2, stepDecimals(pair.tickSize)) : 2;
    },
    digits = upload ? priceDecimals(chartCandles.at(-1)?.close ?? 0) : digitsFor(symbol),
    // BTCUSDT's listing is known locally; other pairs report theirs once looked up.
    listingDate = (s: string) =>
      s === 'BTCUSDT' ? LIVE_DATA_START : listings[s] ? utcDate(listings[s]!) : undefined;
  useEffect(() => {
    api<PairInfo[]>('/pairs')
      .then(setPairs)
      .catch(() => {
        /* The picker says the list could not be loaded; BTCUSDT keeps working. */
      });
  }, []);
  useEffect(() => {
    if (symbol === 'BTCUSDT' || symbol in listings) return;
    let active = true;
    api<PairInfo>('/pairs/' + symbol)
      .then((p) => {
        if (!active) return;
        setListings((old) => ({ ...old, [symbol]: p.listed }));
        if (p.listed !== null) setConfig((c) => fromListing(c, symbol, utcDate(p.listed!)));
      })
      .catch(() => {
        /* Without a listing date, Binance itself proves where the data starts. */
      });
    return () => {
      active = false;
    };
  }, [symbol, listings]);
  useEffect(() => {
    if (!config.dataset) {
      setUploadCandles([]);
      return;
    }
    let active = true;
    api<Candle[]>(`/uploads/${config.dataset}/candles?last=1000`)
      .then((c) => active && setUploadCandles(c))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [config.dataset]);
  function selectSource(id: string) {
    const u = uploads.find((x) => x.id === id);
    setConfig((c) => {
      if (!u)
        return {
          ...c,
          dataset: undefined,
          interval: (marketIntervals as readonly string[]).includes(c.interval) ? c.interval : '1h',
        };
      // Whole UTC days, kept within the 50,000-candle limit of one test.
      const days = Math.floor((50000 * intervals[u.interval] + 1) / 86400),
        last = Math.floor(u.end / 86400) * 86400,
        first = Math.max(Math.floor(u.start / 86400) * 86400, last - (days - 1) * 86400);
      return {
        ...c,
        dataset: u.id,
        interval: u.interval,
        start: utcDate(first),
        end: utcDate(last),
      };
    });
  }
  const refreshLists = async () => {
    try {
      const [h, d, u] = await Promise.all([
        api<Summary[]>('/backtests'),
        api<Dataset[]>('/datasets'),
        api<UploadMeta[]>('/uploads'),
      ]);
      setUploads(u);
      setHistory(h);
      setCompare((old) => old.filter((id) => h.some((r) => r.id === id)));
      setHasMoreReports(h.length === 100);
      setDatasets(d);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refreshLists();
    let active = true;
    void (async () => {
      try {
        const remote = await api<Workspace | null>('/workspace');
        if (!active) return;
        const legacyDefaults = readSaved<Preferences>('btc-defaults', {});
        const legacy: Workspace = {
          presets: readSaved('btc-presets', []),
          defaults: { ...legacyDefaults, ...remote?.defaults },
        };
        const merged = mergeWorkspace(remote ?? emptyWorkspace(), legacy);
        if (!remote || legacy.presets.length || Object.keys(legacyDefaults).length)
          await api('/workspace', { method: 'PUT', body: JSON.stringify(merged) });
        if (!active) return;
        setPresets(merged.presets);
        setPreferences(merged.defaults);
        setConfig((c) => ({ ...c, ...merged.defaults }));
        setWorkspaceReady(true);
        // Complete the migration only after the SQLite write succeeds.
        try {
          localStorage.removeItem('btc-presets');
          localStorage.removeItem('btc-defaults');
        } catch {
          /* SQLite remains available when browser storage is disabled. */
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
    };
    // Initial load and one-time localStorage migration only.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }
  function go(next: Page) {
    setPage(next);
    setMobile(false);
  }
  function editCustom() {
    if ((marketIntervals as readonly string[]).includes(config.interval))
      setInterval(config.interval);
    setCustomEditor(true);
  }
  async function saveWorkspace(next: Workspace) {
    validateWorkspace(next);
    setWorkspaceSaving(true);
    try {
      await api('/workspace', { method: 'PUT', body: JSON.stringify(next) });
      setPresets(next.presets);
      setPreferences(next.defaults);
    } finally {
      setWorkspaceSaving(false);
    }
  }
  async function loadMoreReports() {
    setLoadingMore(true);
    try {
      const more = await api<Summary[]>('/backtests?offset=' + history.length);
      setHistory((old) => [...old, ...more.filter((r) => !old.some((h) => h.id === r.id))]);
      setHasMoreReports(more.length === 100);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  function confirmDelete(ids: string[]) {
    setDeleteError('');
    setDeleteIds(ids);
  }
  async function removeReports() {
    setDeleting(true);
    setDeleteError('');
    try {
      const deleted = await api<{ ids: string[]; deleted: number }>('/backtests/delete', {
        method: 'POST',
        body: JSON.stringify({ ids: deleteIds }),
      });
      const ids = new Set(deleted.ids);
      const remaining = history.filter((r) => !ids.has(r.id));
      setHistory(remaining);
      if (!remaining.length && hasMoreReports) void refreshLists();
      setCompare((old) => old.filter((id) => !ids.has(id)));
      setResult((old) => (old && ids.has(old.id) ? null : old));
      setDeleteIds([]);
      setToast(
        `${deleted.deleted} test raporu silindi. Mum verileri ve strateji şablonları korunuyor.`,
      );
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  async function removePreset(index: number) {
    setDeleteError('');
    try {
      await saveWorkspace({
        presets: presets.filter((_, i) => i !== index),
        defaults: preferences,
      });
      setPresetDelete(null);
      setToast('Şablon silindi. Raporlar ve mum verileri korunuyor.');
    } catch (e) {
      setDeleteError((e as Error).message);
    }
  }
  async function run() {
    if (running) return;
    setError('');
    const actual: Config = { ...config, mode: 'live' };
    try {
      validateConfig(actual);
      validateDataSource(actual);
      validateLiveRange(actual, listingDate(symbolOf(actual)));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setRunning(true);
    try {
      const data = await api<Result>('/backtests', {
        method: 'POST',
        body: JSON.stringify(actual),
      });
      setResult(data);
      setTradePage(0);
      setTab('equity');
      setPage('backtest');
      void refreshLists();
      setToast('Backtest tamamlandı ve rapor kaydedildi.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  async function openResult(id: string) {
    try {
      const data = await api<Result>('/backtests/' + id);
      setResult(data);
      setConfig(data.config);
      setPage('backtest');
      setTradePage(0);
      setToast('Kaydedilmiş rapor açıldı.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function exportTrades() {
    if (!result) return;
    download(`bitcoin-lab-${result.id.slice(0, 8)}.csv`, tradesCsv(result.trades));
    setToast('İşlem dökümü indirildi.');
  }
  function exportCandles() {
    download(
      upload ? `${upload.name}-${upload.interval}.csv` : `${symbolOf(config)}-${interval}.csv`,
      [
        'time,open,high,low,close,volume',
        ...chartCandles.map((b) =>
          [new Date(b.time * 1000).toISOString(), b.open, b.high, b.low, b.close, b.volume].join(
            ',',
          ),
        ),
      ].join('\n'),
    );
  }
  const last = chartCandles.at(-1),
    statusLabel =
      market.status === 'live'
        ? 'CANLI BAĞLANTI'
        : market.status === 'polling'
          ? 'REST · 30 SN'
          : market.status === 'connecting'
            ? 'BAĞLANIYOR'
            : 'BAĞLANTI YOK';
  const numberField = (
    label: string,
    key: keyof Config,
    suffix?: string,
    min = 0,
    max = 1000000,
    step = 'any',
  ) => (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type="number"
          value={config[key] as number}
          min={min}
          max={max}
          step={step}
          onChange={(e) => update(key, Number(e.target.value))}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </label>
  );
  // Shared by the backtest terminal and paper trading. Only the terminal has dates and can use
  // uploaded data; paper trading always runs on Binance.
  const strategyFields = (terminal: boolean) => (
    <>
      {terminal && (
        <label className="field">
          <span>Veri kaynağı</span>
          <select value={config.dataset ?? ''} onChange={(e) => selectSource(e.target.value)}>
            <option value="">Binance · {pairLabel(symbolOf(config))} (canlı veri)</option>
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.interval} (yüklenen)
              </option>
            ))}
            {config.dataset && !upload && (
              <option value={config.dataset}>Silinmiş veri seti</option>
            )}
          </select>
        </label>
      )}
      <label className="field">
        <span>Strateji</span>
        <div className="select-wrap">
          <Layers3 size={15} />
          <select
            value={config.strategy}
            onChange={(e) => {
              const strategy = e.target.value as Strategy;
              setConfig((c) => ({
                ...c,
                strategy,
                ...(strategy === 'custom'
                  ? { custom: c.custom ?? patternStrategy('engulfing') }
                  : {}),
                ...(strategy === 'python' ? { python: c.python ?? { ...examplePython } } : {}),
              }));
            }}
          >
            {Object.entries(strategyNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </label>
      <div className="strategy-description">{descriptions[config.strategy]}</div>
      <div className="form-grid">
        <div className="field">
          <span>{terminal && upload ? 'Veri' : 'İşlem çifti'}</span>
          {terminal && upload ? (
            <div className="static-input">
              {upload.name} <span className="muted">Yüklenen</span>
            </div>
          ) : (
            <PairPicker
              value={symbol}
              pairs={pairs}
              onChange={(next) => {
                setConfig((c) => fromListing({ ...c, symbol: next }, next, listingDate(next)));
              }}
            />
          )}
        </div>
        <label className="field">
          <span>Zaman dilimi</span>
          <select
            value={config.interval}
            disabled={terminal && !!upload}
            title={terminal && upload ? 'Zaman dilimi veri setinden gelir.' : undefined}
            onChange={(e) => update('interval', e.target.value as Interval)}
          >
            {(terminal && upload
              ? [upload.interval]
              : [
                  ...marketIntervals,
                  ...((marketIntervals as readonly string[]).includes(config.interval)
                    ? []
                    : [config.interval]),
                ]
            ).map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
      </div>
      {terminal && (
        <div className="form-grid">
          <label className="field">
            <span>Başlangıç · UTC</span>
            <input
              type="date"
              value={config.start}
              min={upload ? utcDate(upload.start) : listingDate(symbol)}
              max={config.end}
              onChange={(e) => update('start', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Bitiş · UTC</span>
            <input
              type="date"
              value={config.end}
              min={config.start}
              max={upload ? utcDate(upload.end) : new Date().toISOString().slice(0, 10)}
              onChange={(e) => update('end', e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="section-label">STRATEJİ PARAMETRELERİ</div>
      <div className={'form-grid' + (config.strategy === 'custom' ? ' custom-parameter-grid' : '')}>
        {config.strategy === 'python' ? (
          <div className="custom-strategy-summary">
            <span className="tiny-badge amber">PYTHON</span>
            <strong>{config.python?.name ?? 'Python Stratejisi'}</strong>
            <button className="secondary" onClick={() => setPythonEditor(true)}>
              Python kodunu yükle / düzenle <ArrowRight size={14} />
            </button>
            <p className="python-notice">
              Backtest kodu bilgisayarında çalıştırır. Yalnızca güvendiğin Python kodlarını kullan.
            </p>
          </div>
        ) : config.strategy === 'custom' ? (
          <div className="custom-strategy-summary">
            <span className="tiny-badge amber">MUM KURALLARI</span>
            <strong>{config.custom?.name ?? 'Özel Mum Stratejisi'}</strong>
            <p>
              {config.custom?.entry.rules.length ?? 0} giriş ·{' '}
              {config.custom?.exit.rules.length ?? 0} çıkış koşulu
            </p>
            <button className="secondary" onClick={editCustom}>
              <SlidersHorizontal size={14} />
              Mum kurallarını düzenle
              <ArrowRight size={14} />
            </button>
          </div>
        ) : config.strategy === 'sma' ? (
          <>
            {numberField('Hızlı ortalama', 'fast', 'mum', 2, 500, '1')}
            {numberField('Yavaş ortalama', 'slow', 'mum', 3, 1000, '1')}
          </>
        ) : config.strategy === 'rsi' ? (
          <>
            {numberField('RSI periyodu', 'rsiPeriod', 'mum', 2, 200, '1')}
            {numberField('Alım eşiği', 'rsiBuy', undefined, 1, 49)}
            {numberField('Satım eşiği', 'rsiSell', undefined, 51, 99)}
          </>
        ) : (
          numberField('Kanal periyodu', 'lookback', 'mum', 2, 500, '1')
        )}
      </div>
      <div className="section-label">SERMAYE VE RİSK</div>
      <div className="form-grid">
        {numberField('Başlangıç sermayesi', 'capital', 'USDT', 10, 1e9)}
        {numberField('Pozisyon büyüklüğü', 'allocation', '%', 1, 100)}
        {numberField('Komisyon / yön', 'fee', '%', 0, 5)}
        {numberField('Fiyat kayması / yön', 'slippage', '%', 0, 5)}
        {numberField('Stop-loss', 'stopLoss', '%', 0, 90)}
        {numberField('Take-profit', 'takeProfit', '%', 0, 1000)}
      </div>
    </>
  );
  const strategyForm = (
    <aside className="panel strategy-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <SlidersHorizontal size={16} />
          <h2>Strateji Yapılandırması</h2>
        </div>
        <span className="tiny-badge">SPOT</span>
      </div>
      <div className="form-body">
        {strategyFields(true)}
        <div className="execution-note">
          <ShieldCheck size={14} />
          <span>Sonraki mumda işlem · Kaldıraçsız long</span>
        </div>
        <button className="primary run-button" disabled={running} onClick={run}>
          {running ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {running ? 'Veriler işleniyor…' : 'Backtest Başlat'}
          <ArrowRight size={17} />
        </button>
        <button
          className="save-preset"
          disabled={!workspaceReady || workspaceSaving}
          onClick={() => {
            setPresetName('');
            setModal('save');
          }}
        >
          <Save size={14} /> Stratejiyi şablon olarak kaydet
        </button>
      </div>
    </aside>
  );
  const resultPanel = (
    <section className="panel results-panel">
      <div className="panel-heading">
        <div className="heading-icon">
          <TrendingUp size={16} />
          <h2>Performans Analizi</h2>
          {result && (
            <span className={'tiny-badge ' + (result.config.mode === 'demo' ? 'amber' : '')}>
              {result.config.dataset
                ? 'YÜKLENEN VERİ'
                : result.config.mode === 'demo'
                  ? 'DEMO'
                  : 'BINANCE'}
            </span>
          )}
          {result?.paper && <PaperBadge kind={result.paper.kind} />}
        </div>
        <button
          className="icon-button"
          disabled={!result}
          onClick={exportTrades}
          aria-label="İşlemleri CSV indir"
        >
          <Download size={16} />
        </button>
      </div>
      <div className="result-tabs">
        <button className={tab === 'equity' ? 'active' : ''} onClick={() => setTab('equity')}>
          Sermaye Eğrisi
        </button>
        <button className={tab === 'drawdown' ? 'active' : ''} onClick={() => setTab('drawdown')}>
          Maksimum Düşüş
        </button>
        <button className={tab === 'trades' ? 'active' : ''} onClick={() => setTab('trades')}>
          İşlemler {result && <span>{result.trades.length}</span>}
        </button>
        {result && (
          <div className="chart-legend">
            <i className="green-dot" /> Strateji <i className="gray-dot" /> Al & Tut
          </div>
        )}
      </div>
      {result ? (
        <>
          {tab === 'trades' ? (
            <TradeTable
              trades={result.trades}
              page={tradePage}
              setPage={setTradePage}
              digits={
                result.config.dataset
                  ? priceDecimals(result.trades[0]?.entry ?? 0)
                  : digitsFor(symbolOf(result.config))
              }
            />
          ) : (
            <EquityChart points={result.equity} drawdown={tab === 'drawdown'} />
          )}
          <div className="result-footnote">
            {strategyLabel(result.config)} ·{' '}
            {result.config.dataset ? '' : pairLabel(symbolOf(result.config)) + ' · '}
            {result.config.interval} · {result.candleCount.toLocaleString('tr-TR')} kapanmış mum ·{' '}
            {result.config.start} → {result.config.end} (UTC)
            {!!result.missingCandles &&
              (result.config.dataset
                ? ` · Veri dosyasında bulunmayan ${result.missingCandles.toLocaleString('tr-TR')} mum (doğrulanamayan boşluk) atlandı`
                : ` · Binance'te bulunmayan ${result.missingCandles.toLocaleString('tr-TR')} mum (borsa kesintisi) atlandı`)}
            {result.config.dataset && ` · Kaynak: ${result.source}`}
            {result.paper &&
              ` · Canlı test mumları: ısınma ${date(result.paper.warmupStart)} UTC'den, işlemler ${date(result.start)} UTC açılışından itibaren. Aynı tarihlerle terminalden yapılan backtest ısınmayı aralığın içinde yapar; sonuç farklı olabilir.`}
          </div>
          {result.config.strategy === 'custom' && result.config.custom && (
            <details className="report-rules">
              <summary>Test edilen mum kuralları</summary>
              {(['entry', 'exit'] as const).map((side) => (
                <div key={side}>
                  <strong>
                    {side === 'entry' ? 'Giriş' : 'Çıkış'} ·{' '}
                    {result.config.custom![side].mode === 'all' ? 'Tümü (VE)' : 'En az biri (VEYA)'}
                  </strong>
                  {result.config.custom![side].rules.length ? (
                    <ul>
                      {result.config.custom![side].rules.map((r, i) => (
                        <li key={i}>
                          {ruleText(
                            r,
                            result.config.dataset ? 'birim' : baseOf(symbolOf(result.config)),
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Yalnızca risk kuralları ve test sonu çıkışı.</p>
                  )}
                </div>
              ))}
            </details>
          )}
          {result.config.strategy === 'python' && result.config.python && (
            <details className="report-rules">
              <summary>Test edilen Python kodu</summary>
              <pre className="python-report-code">{result.config.python.source}</pre>
            </details>
          )}
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-chart">
            <BarChart3 size={27} />
          </div>
          <h3>Bir fikri stratejiye dönüştürün.</h3>
          <p>
            Stratejinizi yapılandırın ve ilk backtestinizi başlatın.
            <br />
            Sermaye eğrisi ve işlem sonuçları burada görünecek.
          </p>
          <span className="empty-tip">
            <span>01</span> Strateji seç <ArrowRight size={13} />
            <span>02</span> Parametreleri ayarla <ArrowRight size={13} />
            <span>03</span> Test et
          </span>
        </div>
      )}
    </section>
  );
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobile ? 'mobile-open' : '')}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go('dashboard');
          }}
        >
          <span className="brand-mark">
            <Bitcoin size={25} />
          </span>
          <span>
            bitcoin<span className="brand-light">lab</span>
            <small>RESEARCH TERMINAL</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <FlaskConical size={18} />
          </span>
          <div>
            Kişisel Çalışma Alanı<small>Yerel araştırma ortamı</small>
          </div>
          <span className="workspace-status" />
        </div>
        <div className="nav-label">ÇALIŞMA ALANI</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => go(id)} className={page === id ? 'active' : ''}>
              <Icon size={18} />
              <span>{label}</span>
              {id === 'backtest' && <span className="nav-tag">LAB</span>}
              {id === 'history' && history.length > 0 && (
                <span className="nav-count">{history.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="research-card">
            <div>
              <Sparkles size={16} />
              <span>Veriden içgörüye.</span>
            </div>
            <p>
              Fikirlerinizi geçmişte test edin.
              <br />
              Bir sonraki adımı verilerle atın.
            </p>
            <button onClick={() => setModal('help')}>
              Backtest rehberi <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="sidebar-link" onClick={() => setModal('help')}>
            <BookOpen size={17} /> Dokümantasyon <ArrowUpRight size={14} />
          </button>
          <button className="sidebar-link" onClick={() => setModal('settings')}>
            <Settings2 size={17} /> Ayarlar
          </button>
          <div className="profile">
            <span className="avatar">BA</span>
            <div>
              Bağımsız Araştırmacı<small>Yerel çalışma alanı</small>
            </div>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>
      {mobile && <div className="sidebar-scrim" onClick={() => setMobile(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Menüyü aç"
            >
              <Menu size={20} />
            </button>
            <span>Çalışma Alanı</span>
            <ChevronRight size={13} />
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={
                'connection ' +
                (market.status === 'live' || market.status === 'polling' ? 'online' : '')
              }
            >
              <i />
              {statusLabel}
            </span>
            <span className="topbar-divider" />
            <button className="icon-button" onClick={() => setModal('help')} aria-label="Yardım">
              <BookOpen size={17} />
            </button>
            <span className="avatar small">BA</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div className="title-eyebrow">
              <span /> BITCOIN ARAŞTIRMA PLATFORMU
            </div>
            <div className="title-row">
              <div>
                <h1>
                  {page === 'dashboard'
                    ? 'Piyasayı keşfedin. Stratejinizi test edin.'
                    : page === 'backtest'
                      ? 'Bir sonraki stratejiniz burada başlıyor.'
                      : page === 'strategies'
                        ? 'Fikriniz. Kurallarınız. Stratejiniz.'
                        : page === 'paper'
                          ? 'Stratejiniz canlı piyasada, sanal portföyle.'
                          : page === 'history'
                            ? 'Her test, yeni bir içgörü.'
                            : 'Araştırmanızın temeli: güvenilir veri.'}
                </h1>
                <p>
                  {page === 'dashboard'
                    ? 'Canlı Bitcoin verileri ve kapsamlı backtest araçları, tek bir çalışma alanında.'
                    : page === 'backtest'
                      ? 'Geçmiş veriler üzerinde deneyin, performansı ölçün ve sonuçları karşılaştırın.'
                      : page === 'strategies'
                        ? 'Hazır stratejilerle başlayın veya kaydettiğiniz parametrelerle araştırmaya devam edin.'
                        : page === 'paper'
                          ? 'Gerçek zamanlı Binance mumlarında sanal işlem; gerçek emir ve API anahtarı yok.'
                          : page === 'history'
                            ? 'Kaydedilen raporları inceleyin ve stratejilerinizi yan yana karşılaştırın.'
                            : 'Binance Spot verileri, yerel önbellek ve dışa aktarılabilir mum serileri.'}
                </p>
              </div>
              <div className="heading-actions">
                <button
                  className="secondary compact"
                  onClick={() => {
                    setResult(null);
                    go('backtest');
                    setToast('Yeni test için parametrelerinizi düzenleyin.');
                  }}
                >
                  <Plus size={15} />
                  Yeni Backtest
                </button>
              </div>
            </div>
          </div>
          {(error || market.error) && (
            <div className="notice error-notice">
              <WifiOff size={16} />
              <span>{error || market.error}</span>
              <button
                onClick={() => {
                  setError('');
                  market.retry();
                }}
              >
                <RefreshCw size={13} /> Tekrar dene
              </button>
            </div>
          )}
          {(page === 'dashboard' || page === 'backtest') && (
            <>
              {upload ? (
                <div className="market-metrics">
                  <div className="metric-card price-metric">
                    <div className="metric-label">
                      <span>{upload.name}</span>
                      <span className="tiny-badge amber">YÜKLENEN</span>
                    </div>
                    <div className="metric-value">
                      {last ? money(last.close, digits) : '—'}
                      {last && chartCandles.length > 1 && (
                        <span
                          className={
                            'change-pill ' +
                            (last.close >= chartCandles[0].close ? 'positive' : 'negative')
                          }
                        >
                          {pct((last.close / chartCandles[0].close - 1) * 100)}
                        </span>
                      )}
                    </div>
                    <div className="metric-sub">
                      {last ? `Son mum ${date(last.time)} UTC` : 'Veri seti yükleniyor'}
                    </div>
                  </div>
                  <Metric
                    label="Aralıktaki En Yüksek"
                    value={
                      chartCandles.length
                        ? money(Math.max(...chartCandles.map((b) => b.high)), digits)
                        : '—'
                    }
                    sub={`Grafikteki son ${chartCandles.length.toLocaleString('tr-TR')} mum`}
                    icon={<ArrowUpRight size={15} />}
                  />
                  <Metric
                    label="Aralıktaki En Düşük"
                    value={
                      chartCandles.length
                        ? money(Math.min(...chartCandles.map((b) => b.low)), digits)
                        : '—'
                    }
                    sub={`Grafikteki son ${chartCandles.length.toLocaleString('tr-TR')} mum`}
                    icon={<ArrowDownRight size={15} />}
                  />
                  <Metric
                    label="Veri Seti"
                    value={upload.count.toLocaleString('tr-TR') + ' mum'}
                    sub={`${upload.interval} · ${date(upload.start)} → ${date(upload.end)}`}
                    icon={<Database size={15} />}
                  />
                </div>
              ) : (
                <div className="market-metrics">
                  <div className="metric-card price-metric">
                    <div className="metric-label">
                      <span className="coin-icon">
                        {base === 'BTC' ? <Bitcoin size={19} /> : <Coins size={18} />}
                      </span>
                      <span>
                        {base === 'BTC' ? 'Bitcoin' : base}{' '}
                        <span className="muted">{pairLabel(symbol)}</span>
                      </span>
                      <span className="tiny-badge">SPOT</span>
                    </div>
                    <div className="metric-value">
                      {price !== null ? '$' + money(price, digits) : '—'}
                      <span className={'change-pill ' + (change >= 0 ? 'positive' : 'negative')}>
                        {price !== null ? (
                          <>
                            {change >= 0 ? (
                              <ArrowUpRight size={13} />
                            ) : (
                              <ArrowDownRight size={13} />
                            )}{' '}
                            {pct(change)}
                          </>
                        ) : (
                          'Bekleniyor'
                        )}
                      </span>
                    </div>
                    <div className="metric-sub">
                      {market.updated
                        ? 'Son veri: ' + new Date(market.updated).toLocaleTimeString('tr-TR')
                        : 'Canlı piyasa verisine bağlanılıyor'}
                    </div>
                  </div>
                  <Metric
                    label="24s En Yüksek"
                    value={ticker ? '$' + money(+ticker.highPrice, digits) : '—'}
                    sub="Son 24 saatin zirvesi"
                    icon={<ArrowUpRight size={15} />}
                  />
                  <Metric
                    label="24s En Düşük"
                    value={ticker ? '$' + money(+ticker.lowPrice, digits) : '—'}
                    sub="Son 24 saatin tabanı"
                    icon={<ArrowDownRight size={15} />}
                  />
                  <Metric
                    label="24s İşlem Hacmi"
                    value={ticker ? '$' + money(+ticker.quoteVolume / 1e9, 3) + 'B' : '—'}
                    sub={'Binance · ' + pairLabel(symbol)}
                    icon={<BarChart3 size={15} />}
                  />
                </div>
              )}
              {result && (
                <div className="performance-metrics">
                  <Metric
                    label="Net Getiri"
                    value={pct(result.metrics.returnPct)}
                    sub={'$' + money(result.metrics.netProfit) + ' net kâr / zarar'}
                    color={result.metrics.returnPct >= 0 ? 'positive' : 'negative'}
                  />
                  <Metric
                    label="Maksimum Düşüş"
                    value={'−' + money(result.metrics.maxDrawdown) + '%'}
                    sub="Mum kapanışında sermaye düşüşü"
                    color="negative"
                  />
                  <Metric
                    label="Kazanma Oranı"
                    value={money(result.metrics.winRate, 1) + '%'}
                    sub={result.trades.length + ' tamamlanmış işlem'}
                  />
                  <Metric
                    label="Kâr Faktörü"
                    value={
                      result.metrics.profitFactor === null
                        ? '—'
                        : money(result.metrics.profitFactor)
                    }
                    sub={
                      'Sharpe: ' +
                      (result.metrics.sharpe === null ? '—' : money(result.metrics.sharpe))
                    }
                  />
                  <Metric
                    label="Al & Tut Getirisi"
                    value={pct(result.metrics.benchmarkPct)}
                    sub={'Toplam komisyon: $' + money(result.metrics.totalFees)}
                    color={result.metrics.benchmarkPct >= 0 ? 'positive' : 'negative'}
                  />
                </div>
              )}
              <div className="terminal-grid">
                <div className="terminal-left">
                  <section className={'panel chart-panel ' + (fullscreen ? 'fullscreen' : '')}>
                    <div className="panel-heading">
                      <div className="heading-icon">
                        <span className="coin-icon small-coin">
                          {!upload && base === 'BTC' ? <Bitcoin size={16} /> : <Coins size={15} />}
                        </span>
                        <h2>{upload ? upload.name : pairLabel(symbol)}</h2>
                        <span className="muted chart-exchange">
                          {upload ? 'Yüklenen veri' : 'Binance'}
                        </span>
                        <span className="tiny-badge">{upload ? 'VERİ SETİ' : 'SPOT'}</span>
                      </div>
                      <div className="chart-actions">
                        <button
                          className={'icon-button ' + (indicators ? 'selected' : '')}
                          onClick={() => setIndicators(!indicators)}
                          title="Hareketli ortalamaları göster / gizle"
                          aria-label="Göstergeleri değiştir"
                        >
                          <Activity size={16} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={!chartCandles.length}
                          onClick={exportCandles}
                          aria-label="Grafik verisini indir"
                        >
                          <Download size={15} />
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => setFullscreen(!fullscreen)}
                          aria-label={fullscreen ? 'Grafiği küçült' : 'Grafiği büyüt'}
                        >
                          {fullscreen ? <X size={16} /> : <Maximize2 size={15} />}
                        </button>
                      </div>
                    </div>
                    <div className="chart-toolbar">
                      <div className="timeframes">
                        {upload ? (
                          <button className="active" title="Zaman dilimi veri setinden gelir.">
                            {upload.interval}
                          </button>
                        ) : (
                          marketIntervals.map((i) => (
                            <button
                              key={i}
                              className={interval === i ? 'active' : ''}
                              onClick={() => setInterval(i)}
                            >
                              {i}
                            </button>
                          ))
                        )}
                      </div>
                      <span className="chart-type">
                        <Activity size={13} /> Mum grafiği
                      </span>
                      <span className="utc-label">UTC</span>
                    </div>
                    <div className="ohlc">
                      {last ? (
                        <>
                          <span>
                            A <b>{money(last.open, digits)}</b>
                          </span>
                          <span>
                            Y <b>{money(last.high, digits)}</b>
                          </span>
                          <span>
                            D <b>{money(last.low, digits)}</b>
                          </span>
                          <span>
                            K{' '}
                            <b className={last.close >= last.open ? 'positive' : 'negative'}>
                              {money(last.close, digits)}
                            </b>
                          </span>
                        </>
                      ) : (
                        <span>
                          {upload
                            ? 'Veri seti yükleniyor'
                            : `${pairLabel(symbol)} piyasa verisi bekleniyor`}
                        </span>
                      )}
                    </div>
                    {chartCandles.length ? (
                      <PriceChart
                        key={upload ? upload.id : symbol + interval}
                        candles={chartCandles}
                        indicators={indicators}
                        precision={digits}
                        fast={config.fast}
                        slow={config.slow}
                      />
                    ) : upload ? (
                      <div className="chart-loading">
                        <LoaderCircle className="spin" size={28} />
                      </div>
                    ) : (
                      <div className="chart-loading">
                        <Activity size={32} />
                        <h3>
                          {market.status === 'offline'
                            ? 'Piyasa bağlantısı bekleniyor'
                            : 'Piyasa verileri yükleniyor'}
                        </h3>
                        <p>
                          Canlı verileri görmek için bağlantıyı kontrol edin
                          <br />
                          veya kendi verinizi yükleyip onunla backtest yapın.
                        </p>
                        <button className="secondary" onClick={() => go('data')}>
                          Kendi verini yükle <ArrowRight size={14} />
                        </button>
                      </div>
                    )}
                    <div className="chart-bottom">
                      <div>
                        {indicators && (
                          <>
                            <span>
                              <i style={{ background: '#e6b960' }} /> SMA {config.fast}
                            </span>
                            <span>
                              <i style={{ background: '#8d8de4' }} /> SMA {config.slow}
                            </span>
                          </>
                        )}
                        <span>
                          <i style={{ background: '#44c5a055' }} /> Hacim
                        </span>
                      </div>
                      <span>
                        {chartCandles.length} mum{' '}
                        <span className="muted">· Kaydır ve yakınlaştır</span>
                      </span>
                    </div>
                  </section>
                  {resultPanel}
                </div>
                {strategyForm}
              </div>
              <div className="insight-strip">
                <span className="insight-icon">
                  <Zap size={19} />
                </span>
                <div>
                  <strong>İyi bir strateji, ölçülebilir bir hipotezle başlar.</strong>
                  <p>
                    Komisyonları hesaba katın, farklı dönemleri test edin ve sonuçları al & tut ile
                    karşılaştırın.
                  </p>
                </div>
                <button onClick={() => setModal('help')}>
                  Metodolojiyi keşfet <ArrowUpRight size={15} />
                </button>
              </div>
            </>
          )}
          {page === 'paper' && (
            <PaperTrading
              fields={strategyFields(false)}
              config={config}
              digitsFor={digitsFor}
              onOpenReport={openResult}
              onToast={setToast}
              onReportsChanged={refreshLists}
            />
          )}
          {page === 'strategies' && (
            <>
              <div className="section-title">
                <h2>Strateji Kütüphanesi</h2>
                <span className="muted">
                  Hazır stratejiler · Mum kuralları · Python · Spot / Long
                </span>
              </div>
              <section className="panel custom-library-card">
                <div className="heading-icon">
                  <SlidersHorizontal size={23} />
                  <div>
                    <h2>Kendi mum formasyonunuzu oluşturun</h2>
                    <p>
                      “Son mum yeşil, alt fitili gövdesinin en az 2 katı” gibi kuralları kod
                      yazmadan birleştirin.
                    </p>
                  </div>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    go('backtest');
                    editCustom();
                  }}
                >
                  <Plus size={15} />
                  Özel strateji oluştur
                </button>
              </section>
              <section className="panel custom-library-card">
                <div>
                  <h2>Python Strateji Atölyesi</h2>
                  <p>
                    .py dosyanı yükle veya kodunu yapıştır. Mum formasyonlarını ve kendi
                    hesaplamalarını backtestte kullan.
                  </p>
                </div>
                <button className="primary" onClick={() => setPythonEditor(true)}>
                  <Plus size={15} />
                  Python stratejisi yükle
                </button>
              </section>
              <div className="strategy-cards">
                {(['sma', 'rsi', 'breakout'] as Strategy[]).map((id, i) => (
                  <section className="panel strategy-card" key={id}>
                    <div className={'strategy-card-icon icon-' + i}>
                      {i === 0 ? (
                        <Activity size={25} />
                      ) : i === 1 ? (
                        <TrendingUp size={25} />
                      ) : (
                        <BarChart3 size={25} />
                      )}
                    </div>
                    <span className="tiny-badge">
                      {['TREND TAKİBİ', 'ORTALAMAYA DÖNÜŞ', 'KIRILIM'][i]}
                    </span>
                    <h2>{strategyNames[id]}</h2>
                    <p>{descriptions[id]}</p>
                    <div className="strategy-formula">
                      {
                        [
                          'SMA(hızlı) ↗ SMA(yavaş)',
                          'RSI < alım eşiği → LONG',
                          'Kapanış > önceki kanal zirvesi',
                        ][i]
                      }
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        update('strategy', id);
                        go('backtest');
                      }}
                    >
                      Stratejiyi kullan <ArrowRight size={15} />
                    </button>
                  </section>
                ))}
              </div>
              <div className="section-title">
                <h2>Kaydettiğiniz Şablonlar</h2>
                <span className="muted">Yerel SQLite deposunda saklanır</span>
              </div>
              {presets.length ? (
                <div className="strategy-cards">
                  {presets.map((p, i) => (
                    <section className="panel strategy-card" key={i}>
                      <Save size={22} />
                      <h2>{p.name}</h2>
                      <p>
                        {strategyLabel(p.config)} · {p.config.interval}
                      </p>
                      <p>
                        ${money(p.config.capital)} sermaye · %{p.config.fee} komisyon
                      </p>
                      <div className="report-actions preset-actions">
                        <button
                          className="secondary"
                          onClick={() => {
                            setConfig(p.config);
                            go('backtest');
                          }}
                        >
                          Şablonu yükle <ArrowRight size={15} />
                        </button>
                        <button
                          className="icon-button danger"
                          title="Bu şablonu sil"
                          aria-label={'Şablonu sil ' + p.name}
                          disabled={!workspaceReady || workspaceSaving}
                          onClick={() => {
                            setDeleteError('');
                            setPresetDelete(i);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="panel empty-state">
                  <Layers3 size={28} />
                  <h3>Kendi araştırma kütüphanenizi oluşturun.</h3>
                  <p>Terminaldeki “Stratejiyi şablon olarak kaydet” düğmesiyle başlayın.</p>
                </div>
              )}
            </>
          )}
          {page === 'history' && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  Backtest Raporları <span className="tiny-badge">{history.length}</span>
                </h2>
                <div className="history-actions">
                  {compare.length > 0 && (
                    <button
                      className="danger-button"
                      disabled={deleting || compare.length > 1000}
                      onClick={() => confirmDelete(compare)}
                    >
                      <Trash2 size={14} />
                      Seçilenleri sil ({compare.length})
                    </button>
                  )}
                  <button className="secondary compact" onClick={refreshLists}>
                    <RefreshCw size={14} />
                    Yenile
                  </button>
                </div>
              </div>
              {history.length ? (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Seç / Karşılaştır</th>
                          <th>Strateji / Tarih</th>
                          <th>Veri kaynağı</th>
                          <th>Periyot</th>
                          <th>Net getiri</th>
                          <th>Maks. düşüş</th>
                          <th>İşlemler</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id}>
                            <td>
                              <input
                                aria-label={'Karşılaştır ' + h.id}
                                type="checkbox"
                                checked={compare.includes(h.id)}
                                onChange={(e) =>
                                  setCompare((old) =>
                                    e.target.checked
                                      ? [...old, h.id]
                                      : old.filter((id) => id !== h.id),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <strong>{strategyLabel(h.config)}</strong>
                              <small>{new Date(h.createdAt).toLocaleString('tr-TR')}</small>
                            </td>
                            <td>
                              <span
                                className={
                                  'tiny-badge ' + (h.config.mode === 'demo' ? 'amber' : '')
                                }
                              >
                                {h.source}
                              </span>
                              {h.paper && <PaperBadge kind={h.paper.kind} />}
                            </td>
                            <td>
                              {h.config.dataset ? '' : pairLabel(symbolOf(h.config)) + ' · '}
                              {h.config.interval}
                              <small>
                                {h.config.start} → {h.config.end}
                              </small>
                            </td>
                            <td className={h.metrics.returnPct >= 0 ? 'positive' : 'negative'}>
                              {pct(h.metrics.returnPct)}
                            </td>
                            <td className="negative">−{money(h.metrics.maxDrawdown)}%</td>
                            <td>{h.tradeCount}</td>
                            <td>
                              <div className="report-actions">
                                <button
                                  className="secondary compact"
                                  onClick={() => openResult(h.id)}
                                >
                                  Rapor <ArrowUpRight size={14} />
                                </button>
                                <button
                                  className="icon-button danger"
                                  title="Bu raporu sil"
                                  aria-label={'Raporu sil ' + h.id}
                                  onClick={() => confirmDelete([h.id])}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasMoreReports && (
                    <div className="history-load-more">
                      <button
                        className="secondary"
                        disabled={loadingMore}
                        onClick={loadMoreReports}
                      >
                        {loadingMore ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <History size={14} />
                        )}
                        Daha eski raporları yükle
                      </button>
                    </div>
                  )}
                  {compare.length > 0 && (
                    <div className="comparison">
                      <h3>Seçili testlerin karşılaştırması</h3>
                      <p className="muted">
                        {compare.length > 3 && 'İlk 3 seçili rapor karşılaştırılıyor. '}
                        Adil bir karşılaştırma için aynı veri kaynağı, tarih aralığı ve zaman
                        dilimini kullanın.
                      </p>
                      <div className="comparison-grid">
                        {history
                          .filter((h) => compare.includes(h.id))
                          .slice(0, 3)
                          .map((h) => (
                            <div className="compare-card" key={h.id}>
                              <strong>{strategyLabel(h.config)}</strong>
                              <small>
                                {h.config.start} — {h.config.end} ·{' '}
                                {h.config.dataset ? '' : pairLabel(symbolOf(h.config)) + ' · '}
                                {h.config.interval} · {h.source}
                                {h.paper &&
                                  (h.paper.kind === 'session'
                                    ? ' · Canlı (paper)'
                                    : ' · Karşılaştırma')}
                              </small>
                              <div>
                                Net getiri{' '}
                                <b className={h.metrics.returnPct >= 0 ? 'positive' : 'negative'}>
                                  {pct(h.metrics.returnPct)}
                                </b>
                              </div>
                              <div>
                                Kazanma oranı <b>{money(h.metrics.winRate, 1)}%</b>
                              </div>
                              <div>
                                Sharpe oranı{' '}
                                <b>{h.metrics.sharpe === null ? '—' : money(h.metrics.sharpe)}</b>
                              </div>
                              <div>
                                Son sermaye <b>${money(h.metrics.finalEquity)}</b>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <History size={30} />
                  <h3>Araştırma günlüğünüz henüz boş.</h3>
                  <p>Her tamamlanan backtest otomatik olarak burada saklanır.</p>
                  <button className="primary" onClick={() => go('backtest')}>
                    İlk backtesti oluştur <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          )}
          {page === 'data' && (
            <>
              <UploadPanel
                uploads={uploads}
                onChanged={refreshLists}
                onToast={setToast}
                onUse={(u) => {
                  selectSource(u.id);
                  go('backtest');
                  setToast(`“${u.name}” Backtest Terminali'nde veri kaynağı olarak seçildi.`);
                }}
              />
              <BackupPanel
                disabled={running || workspaceSaving || !workspaceReady}
                onImported={(summary) => {
                  setPresets(summary.workspace.presets);
                  setPreferences(summary.workspace.defaults);
                  setConfig((c) => ({ ...c, ...summary.workspace.defaults }));
                  setCompare([]);
                  void refreshLists();
                  market.retry();
                }}
              />
              <div className="data-overview">
                <section className="panel data-card">
                  <div className="heading-icon">
                    <span className="coin-icon">
                      <Bitcoin size={21} />
                    </span>
                    <h2>Binance Spot</h2>
                    <span className="tiny-badge">PUBLIC API</span>
                  </div>
                  <p>USDT spot çiftleri · OHLCV mum verileri ve canlı fiyat akışı</p>
                  <div className="data-detail">
                    <span>Bağlantı durumu</span>
                    <b className={market.status === 'live' ? 'positive' : 'muted'}>{statusLabel}</b>
                  </div>
                  <div className="data-detail">
                    <span>Canlı akış</span>
                    <b>WebSocket / REST yedek</b>
                  </div>
                  <div className="data-detail">
                    <span>Kimlik doğrulama</span>
                    <b>API anahtarı gerekmez</b>
                  </div>
                  <button className="secondary" onClick={() => market.retry()}>
                    Bağlantıyı yenile <RefreshCw size={14} />
                  </button>
                </section>
                <section className="panel data-card">
                  <div className="heading-icon">
                    <Database size={22} />
                    <h2>Yerel Veri Deposu</h2>
                  </div>
                  <div className="storage-number">
                    {datasets.reduce((n, d) => n + d.count, 0).toLocaleString('tr-TR')}{' '}
                    <span>mum</span>
                  </div>
                  <p>
                    İndirilen tarihsel mumlar SQLite önbelleğinde tutulur. Tekrar çalıştırılan
                    testler mevcut veriyi kullanır.
                  </p>
                  <button
                    className="secondary"
                    disabled={!market.candles.length}
                    onClick={exportCandles}
                  >
                    <Download size={15} /> Mevcut {interval} grafiğini CSV indir
                  </button>
                  <small className="muted">Dışa aktarım kaynağı: Binance Spot</small>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Binance Mum Önbelleği</h2>
                  <button
                    className="icon-button"
                    onClick={refreshLists}
                    aria-label="Veri setlerini yenile"
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
                {datasets.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>İşlem çifti</th>
                          <th>Zaman dilimi</th>
                          <th>Mum sayısı</th>
                          <th>İlk mum · UTC</th>
                          <th>Son mum · UTC</th>
                          <th>Depolama</th>
                        </tr>
                      </thead>
                      <tbody>
                        {datasets.map((d) => (
                          <tr key={d.symbol + d.interval}>
                            <td>{pairLabel(d.symbol)}</td>
                            <td>{d.interval}</td>
                            <td>{d.count.toLocaleString('tr-TR')}</td>
                            <td>{date(d.start)}</td>
                            <td>{date(d.end)}</td>
                            <td>
                              <span className="tiny-badge">SQLite</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <Database size={28} />
                    <h3>Veri deponuz hazır.</h3>
                    <p>
                      Canlı grafikte ve gerçek veriyle backtest sırasında mumlar otomatik indirilir.
                    </p>
                  </div>
                )}
                <div className="result-footnote">
                  Gösterilen ilk ve son tarihler arasındaki tüm mumların önbellekte bulunması
                  gerekmez. Test öncesinde eksikler indirilir.
                </div>
              </section>
            </>
          )}
          <footer>
            <span>
              <span className="footer-logo">₿</span> bitcoinlab{' '}
              <span className="muted">/ Araştırma için tasarlandı.</span>
            </span>
            <span>
              Geçmiş performans gelecekteki sonuçları garanti etmez.{' '}
              <span className="footer-separator">·</span> UTC
            </span>
          </footer>
        </main>
      </div>
      {running && (
        <div className="running-toast">
          <LoaderCircle size={18} className="spin" />
          <div>
            Backtest çalışıyor
            <small>Veriler indiriliyor, sinyaller ve işlemler hesaplanıyor.</small>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button className="icon-button" onClick={() => setToast('')} aria-label="Bildirimi kapat">
            <X size={14} />
          </button>
        </div>
      )}
      {deleteIds.length > 0 && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) setDeleteIds([]);
          }}
        >
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Test raporlarını sil"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>{deleteIds.length} test raporu silinecek</h2>
              <button
                className="icon-button"
                disabled={deleting}
                aria-label="Silmeyi iptal et"
                onClick={() => setDeleteIds([])}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="delete-description">
                Seçtiğiniz raporlar ve işlem dökümleri yerel geçmişten kaldırılır. Mum verileri,
                şablonlar ve dışa aktardığınız yedek dosyaları korunur.
              </p>
              <ul className="delete-list">
                {history
                  .filter((h) => deleteIds.includes(h.id))
                  .map((h) => (
                    <li key={h.id}>
                      {strategyLabel(h.config)} · {h.config.start} → {h.config.end} ·{' '}
                      {h.config.dataset ? '' : pairLabel(symbolOf(h.config)) + ' · '}
                      {h.config.interval}
                    </li>
                  ))}
              </ul>
              <p className="delete-description">
                Bu işlemi geri almak için önceden dışa aktardığınız bir yedeği içe aktarabilirsiniz.
              </p>
              {deleteError && (
                <div className="notice error-notice" role="alert">
                  {deleteError}
                </div>
              )}
              <div className="delete-actions">
                <button className="secondary" disabled={deleting} onClick={() => setDeleteIds([])}>
                  Vazgeç
                </button>
                <button className="danger-button" disabled={deleting} onClick={removeReports}>
                  {deleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                  Silme işlemini onayla
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {presetDelete !== null && presets[presetDelete] && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!workspaceSaving) setPresetDelete(null);
          }}
        >
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Şablonu sil"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>Şablon silinecek</h2>
              <button
                className="icon-button"
                disabled={workspaceSaving}
                aria-label="Silmeyi iptal et"
                onClick={() => setPresetDelete(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <ul className="delete-list">
                <li>
                  {presets[presetDelete].name} · {strategyLabel(presets[presetDelete].config)} ·{' '}
                  {presets[presetDelete].config.interval}
                </li>
              </ul>
              <p className="delete-description">
                Şablon yerel kütüphaneden kaldırılır. Bu şablonla oluşturulan raporlar, mum verileri
                ve dışa aktardığınız yedek dosyaları korunur.
              </p>
              {deleteError && (
                <div className="notice error-notice" role="alert">
                  {deleteError}
                </div>
              )}
              <div className="delete-actions">
                <button
                  className="secondary"
                  disabled={workspaceSaving}
                  onClick={() => setPresetDelete(null)}
                >
                  Vazgeç
                </button>
                <button
                  className="danger-button"
                  disabled={workspaceSaving}
                  onClick={() => void removePreset(presetDelete)}
                >
                  {workspaceSaving ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  Silme işlemini onayla
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {pythonEditor && (
        <PythonStrategyEditor
          value={config.python ?? examplePython}
          ready={workspaceReady && !workspaceSaving}
          onClose={() => setPythonEditor(false)}
          onApply={async (python) => {
            const next: Config = { ...config, mode: 'live', strategy: 'python', python };
            const exists = presets.some(
              (p) =>
                p.config.strategy === 'python' &&
                p.name === python.name &&
                JSON.stringify(p.config) === JSON.stringify(next),
            );
            await saveWorkspace({
              presets: exists ? presets : [...presets, { name: python.name, config: next }],
              defaults: preferences,
            });
            setConfig(next);
            setPythonEditor(false);
            go('backtest');
            setToast('Python stratejisi yerel kütüphaneye kaydedildi. Backtesti başlatabilirsin.');
          }}
        />
      )}
      {customEditor && (
        <CustomStrategyEditor
          value={config.custom ?? patternStrategy('engulfing')}
          candles={chartCandles}
          interval={upload ? upload.interval : interval}
          sourceLabel={upload ? 'Yüklenen veri · ' + upload.name : undefined}
          base={upload ? 'birim' : base}
          onClose={() => setCustomEditor(false)}
          onApply={(custom) => {
            setConfig((c) => ({ ...c, strategy: 'custom', custom }));
            setCustomEditor(false);
            setToast(
              'Mum kuralları uygulandı. Backtesti başlatabilir veya şablon olarak kaydedebilirsiniz.',
            );
          }}
        />
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'help'
                ? 'Backtest rehberi'
                : modal === 'settings'
                  ? 'Ayarlar'
                  : 'Şablon kaydet'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>
                {modal === 'help'
                  ? 'Backtest Metodolojisi'
                  : modal === 'settings'
                    ? 'Çalışma Alanı Ayarları'
                    : 'Stratejiyi Kaydet'}
              </h2>
              <button
                className="icon-button"
                onClick={() => setModal(null)}
                aria-label="Pencereyi kapat"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {modal === 'help' ? (
                <>
                  <div className="guide-intro">
                    <FlaskConical size={27} />
                    <p>
                      Tekrarlanabilir testler.
                      <br />
                      <strong>Açık varsayımlar.</strong>
                    </p>
                  </div>
                  <h3>Nasıl çalışır?</h3>
                  <ol>
                    <li>Bir strateji, tarih aralığı ve zaman dilimi seçin.</li>
                    <li>Sermaye, pozisyon büyüklüğü ve işlem maliyetlerini ayarlayın.</li>
                    <li>Backtesti başlatın; rapor otomatik olarak kaydedilir.</li>
                    <li>
                      Test Geçmişi üzerinden sonuçları karşılaştırın veya işlemleri CSV indirin.
                    </li>
                  </ol>
                  <h3>İşlem ve risk modeli</h3>
                  <p>
                    Özel Mum Stratejisi ile son kapanan mum ve ondan önceki 20 mumun fiyat, gövde,
                    fitil ve hacim değerlerini karşılaştırabilirsiniz. Giriş ve çıkış için ayrı
                    VE/VEYA grupları tanımlanır. Giriş ve çıkış aynı anda eşleşirse çıkış
                    önceliklidir; çıkış yapılan mumda yeniden giriş yapılmaz. Şablonlar ve raporlar
                    kullanılan kuralları da saklar.
                  </p>
                  <p>
                    Spot piyasada yalnızca long pozisyon açılır. Sinyaller kapanmış mumlardan
                    üretilir; emirler sonraki mum açılışında, kayma ve komisyon uygulanarak işlenir.
                    Aynı anda tek pozisyon tutulur.
                  </p>
                  <p>
                    Aynı mumda hem stop-loss hem take-profit görülürse temkinli olarak stop-loss
                    önce kabul edilir. Açılıştaki fiyat boşlukları açılış fiyatından işlenir. Testin
                    son mumunda açık pozisyon kapatılır. Stop-loss veya take-profit için 0 değeri
                    ilgili kuralı kapatır.
                  </p>
                  <h3>Ölçüm varsayımları</h3>
                  <p>
                    Maksimum düşüş mum kapanışındaki sermaye üzerinden ölçülür. Sharpe oranı sıfır
                    risksiz getiri ve 365 gün varsayımıyla yıllıklandırılır. Al & tut, ilk mum
                    açılışında alım ve son kapanışta satış ile aynı komisyon ve kaymayı kullanır.
                    Göstergelerin ısınma süresi test aralığına dahildir.
                  </p>
                  <p>
                    Likidite, kısmi dolumlar, borsa miktar adımları ve piyasa etkisi modellenmez. En
                    fazla 50.000 mum test edilir. Tüm tarihler UTC'dir.
                  </p>
                  <a
                    className="text-link"
                    href="https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Binance veri kaynağı dokümantasyonu <ArrowUpRight size={14} />
                  </a>
                  <a
                    className="text-link"
                    href="https://www.tradingview.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Grafikler: TradingView Lightweight Charts™ <ArrowUpRight size={14} />
                  </a>
                </>
              ) : modal === 'settings' ? (
                <>
                  <p>
                    Mevcut sermaye ve risk ayarlarınızı sonraki ziyaretler için varsayılan olarak
                    saklayın.
                  </p>
                  <div className="settings-summary">
                    <span>
                      Başlangıç sermayesi <b>${money(config.capital)}</b>
                    </span>
                    <span>
                      Komisyon / kayma{' '}
                      <b>
                        %{config.fee} / %{config.slippage}
                      </b>
                    </span>
                    <span>
                      Stop-loss / Take-profit{' '}
                      <b>
                        %{config.stopLoss} / %{config.takeProfit}
                      </b>
                    </span>
                  </div>
                  <button
                    className="primary"
                    disabled={!workspaceReady || workspaceSaving}
                    onClick={async () => {
                      try {
                        validateConfig({ ...config, mode: 'live' });
                        await saveWorkspace({
                          presets,
                          defaults: {
                            capital: config.capital,
                            allocation: config.allocation,
                            fee: config.fee,
                            slippage: config.slippage,
                            stopLoss: config.stopLoss,
                            takeProfit: config.takeProfit,
                          },
                        });
                        setToast('Varsayılan ayarlar yerel SQLite deposuna kaydedildi.');
                        setModal(null);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Save size={15} />
                    Varsayılan olarak kaydet
                  </button>
                  <p className="muted">
                    Mum verileri, raporlar, şablonlar ve tercihler yerel SQLite veritabanında
                    saklanır. Veri Merkezi üzerinden tamamını yedekleyebilirsiniz.
                  </p>
                </>
              ) : (
                <>
                  <p>Mevcut stratejiyi ve parametrelerini yeniden kullanmak için adlandırın.</p>
                  <label className="field">
                    <span>Şablon adı</span>
                    <input
                      autoFocus
                      maxLength={60}
                      placeholder="Örn. BTC 1s Trend Stratejisi"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={!presetName.trim() || !workspaceReady || workspaceSaving}
                    onClick={async () => {
                      try {
                        validateConfig({ ...config, mode: 'live' });
                        const next = [
                          ...presets,
                          { name: presetName.trim(), config: { ...config, mode: 'live' as const } },
                        ];
                        await saveWorkspace({ presets: next, defaults: preferences });
                        setModal(null);
                        setToast('Şablon Stratejiler sayfasına kaydedildi.');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Save size={15} />
                    Şablonu kaydet
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function PaperBadge({ kind }: { kind: 'session' | 'comparison' }) {
  return (
    <span className="tiny-badge paper-badge">
      {kind === 'session' ? 'CANLI (PAPER)' : 'KARŞILAŞTIRMA'}
    </span>
  );
}
function Metric({
  label,
  value,
  sub,
  icon,
  color = '',
}: {
  label: string;
  value: string;
  sub: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">
        {label}
        <span className="muted">{icon}</span>
      </div>
      <div className={'metric-value ' + color}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}
export default App;
