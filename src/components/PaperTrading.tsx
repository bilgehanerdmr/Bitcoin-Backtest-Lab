import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Download,
  FileText,
  LoaderCircle,
  Play,
  Radio,
  RefreshCw,
  Scale,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { api, date, download, money, pct } from '../api';
import { EquityChart } from './Chart';
import { TradeTable, tradesCsv } from './TradeTable';
import {
  DEFAULT_WARMUP,
  MAX_ACTIVE_SESSIONS,
  MAX_WARMUP,
  minWarmup,
  paperStatusLabels,
  utcDate,
  validatePaperStart,
  type FeedStatus,
  type PaperDetail,
  type PaperMetrics,
  type PaperView,
} from '../../shared/paper';
import { strategyLabel, symbolOf, type Config } from '../../shared/types';
import { baseOf, pairLabel } from '../../shared/pairs';
import './paper.css';

const feedLabels: Record<FeedStatus, string> = {
  connecting: 'Bağlanıyor',
  live: 'Canlı akış',
  reconnecting: 'Yeniden bağlanıyor',
};
const signalLabels = { buy: 'AL', sell: 'SAT', hold: 'BEKLE' };
// Label, value, display format and the unit of the backtest − live difference.
const comparisonRows: [string, (m: PaperMetrics) => number, (n: number) => string, string][] = [
  ['Net getiri', (m) => m.returnPct, pct, ' puan'],
  ['İşlem sayısı', (m) => m.trades, String, ''],
  ['Maks. düşüş', (m) => m.maxDrawdown, (n) => '−' + money(n) + '%', ' puan'],
  ['Kazanma oranı', (m) => m.winRate, (n) => money(n, 1) + '%', ' puan'],
  ['Son sermaye', (m) => m.finalEquity, (n) => '$' + money(n), ' $'],
  ['Toplam komisyon', (m) => m.totalFees, (n) => '$' + money(n), ' $'],
];
const delta = (n: number, unit: string) =>
  (n > 0 ? '+' : '−') + (unit ? money(Math.abs(n)) : Math.abs(n)) + unit;

export function PaperTrading({
  fields,
  config,
  digitsFor,
  onOpenReport,
  onToast,
  onReportsChanged,
}: {
  fields: ReactNode;
  config: Config;
  // Price decimals of a pair, from its Binance tick size.
  digitsFor: (symbol: string) => number;
  onOpenReport: (id: string) => void;
  onToast: (message: string) => void;
  onReportsChanged: () => void;
}) {
  const [sessions, setSessions] = useState<PaperView[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<PaperDetail | null>(null),
    [warmup, setWarmup] = useState(DEFAULT_WARMUP),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [tab, setTab] = useState<'equity' | 'trades' | 'logs'>('equity'),
    [tradePage, setTradePage] = useState(0),
    [hiddenComparison, setHiddenComparison] = useState('');
  // The server runs the sessions; the page only polls them.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const list = await api<PaperView[]>('/paper');
        if (active) setSessions(list);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const current = sessions.find((s) => s.id === selected) ?? sessions[0] ?? null,
    currentId = current?.id,
    // Full trades and equity are fetched again only when a candle or the state changed.
    version = current
      ? [
          current.lastProcessed,
          current.status,
          current.comparison?.reportId,
          current.logs.length,
        ].join('|')
      : '';
  useEffect(() => {
    if (!currentId) {
      setDetail(null);
      return;
    }
    let active = true;
    api<PaperDetail>('/paper/' + currentId)
      .then((d) => active && setDetail(d))
      .catch((e: Error) => active && setError(e.message));
    return () => {
      active = false;
    };
    // `version` is the trigger: refetch only when a candle was processed or the state changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [currentId, version]);
  const activeCount = sessions.filter((s) => s.status !== 'stopped').length,
    min = minWarmup(config);
  function select(id: string) {
    setSelected(id);
    setTab('equity');
    setTradePage(0);
  }
  async function start() {
    setError('');
    const today = utcDate(Date.now() / 1000),
      request = {
        // Paper trading always runs on Binance, whatever the terminal's data source is.
        config: { ...config, dataset: undefined, mode: 'live' as const, start: today, end: today },
        warmup,
      };
    try {
      validatePaperStart(request);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy('start');
    try {
      const s = await api<PaperView>('/paper', { method: 'POST', body: JSON.stringify(request) });
      setSessions((old) => [s, ...old.filter((o) => o.id !== s.id)]);
      select(s.id);
      onToast('Canlı test başlatıldı. Sonuçlar her kapanan mumda güncellenir.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function command(action: 'stop' | 'compare' | 'retry') {
    if (!current) return;
    setBusy(action);
    setError('');
    try {
      const s = await api<PaperView>(`/paper/${current.id}/${action}`, { method: 'POST' });
      setSessions((old) => old.map((o) => (o.id === s.id ? s : o)));
      if (action !== 'retry') onReportsChanged();
      onToast(
        action === 'stop'
          ? s.reportId
            ? "Oturum durduruldu. Nihai rapor Test Geçmişi'ne “Canlı (paper)” etiketiyle kaydedildi."
            : 'Oturum durduruldu.'
          : action === 'compare'
            ? "Karşılaştırma backtest'i Test Geçmişi'ne kaydedildi."
            : 'Oturum yeniden başlatıldı.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const s = detail && detail.id === currentId ? detail : null,
    comparison = s?.comparison && s.comparison.reportId !== hiddenComparison ? s.comparison : null;
  return (
    <div className="paper-grid">
      <aside className="panel strategy-panel">
        <div className="panel-heading">
          <div className="heading-icon">
            <Radio size={16} />
            <h2>Canlı Test Ayarları</h2>
          </div>
          <span className="tiny-badge amber">PAPER</span>
        </div>
        <div className="form-body">
          {fields}
          <div className="section-label">CANLI TEST</div>
          <div className="form-grid">
            <label className="field">
              <span>Isınma mumu</span>
              <div className="input-wrap">
                <input
                  type="number"
                  value={warmup}
                  min={min}
                  max={MAX_WARMUP}
                  step="1"
                  onChange={(e) => setWarmup(Number(e.target.value))}
                />
                <span>mum</span>
              </div>
            </label>
          </div>
          <p className="paper-hint">
            Göstergeler başlatmadan önceki {warmup.toLocaleString('tr-TR')} mumla ısınır (en az{' '}
            {min}); işlemler başlatmadan sonra açılan ilk mumdan itibaren sayılır.
          </p>
          <div className="execution-note">
            <ShieldCheck size={14} />
            <span>Sanal portföy · Gerçek emir ve API anahtarı yok</span>
          </div>
          <button
            className="primary run-button"
            disabled={!!busy || activeCount >= MAX_ACTIVE_SESSIONS}
            onClick={start}
          >
            {busy === 'start' ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            {busy === 'start' ? 'Isınma mumları yükleniyor…' : 'Canlı testi başlat'}
            <ArrowRight size={17} />
          </button>
          {activeCount >= MAX_ACTIVE_SESSIONS && (
            <p className="paper-hint">
              Aynı anda en fazla {MAX_ACTIVE_SESSIONS} oturum çalışabilir. Yeni oturum için birini
              durdurun.
            </p>
          )}
        </div>
      </aside>
      <div className="paper-main">
        {error && (
          <div className="notice error-notice" role="alert">
            {error}
          </div>
        )}
        {sessions.length > 0 && (
          <div className="paper-sessions" role="tablist" aria-label="Canlı test oturumları">
            {sessions.map((o) => (
              <button
                key={o.id}
                role="tab"
                aria-selected={o.id === currentId}
                className={'paper-chip ' + (o.id === currentId ? 'active' : '')}
                onClick={() => select(o.id)}
              >
                <i className={'paper-dot ' + o.status} />
                <span>
                  {strategyLabel(o.config)} · {baseOf(symbolOf(o.config))} · {o.config.interval}
                  {o.config.mode === 'demo' ? ' · DEMO' : ''}
                </span>
                <small>{paperStatusLabels[o.status]}</small>
              </button>
            ))}
          </div>
        )}
        {!current ? (
          <section className="panel empty-state">
            <Radio size={28} />
            <h3>Stratejinizi gerçek zamanlı piyasada sanal olarak çalıştırın.</h3>
            <p>
              Her kapanan mumda sinyal üretilir, işlem sonraki mumun açılışında sanal portföyde
              gerçekleşir. Hesaplama backtest motoruyla birebir aynıdır.
            </p>
          </section>
        ) : (
          <section className="panel paper-session" aria-label="Canlı test oturumu">
            <div className="panel-heading paper-heading">
              <div className="heading-icon">
                <Radio size={16} />
                <h2>{strategyLabel(current.config)}</h2>
                <span className="tiny-badge">{pairLabel(symbolOf(current.config))}</span>
                <span className="tiny-badge">{current.config.interval}</span>
                <span className={'tiny-badge ' + (current.config.mode === 'demo' ? 'amber' : '')}>
                  {current.config.mode === 'demo' ? 'DEMO' : 'BINANCE'}
                </span>
                <span className={'paper-status ' + current.status}>
                  {paperStatusLabels[current.status]}
                </span>
              </div>
              <div className="paper-actions">
                {(current.status === 'error' || current.status === 'waiting') && (
                  <button
                    className="secondary compact"
                    disabled={!!busy}
                    onClick={() => command('retry')}
                  >
                    <RefreshCw size={14} /> Yeniden dene
                  </button>
                )}
                <button
                  className="secondary compact"
                  disabled={!!busy || current.tradingCandles < 3}
                  title={
                    current.tradingCandles < 3
                      ? 'Karşılaştırma için en az 3 işlem mumu gerekir.'
                      : ''
                  }
                  onClick={() => command('compare')}
                >
                  {busy === 'compare' ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Scale size={14} />
                  )}
                  Aynı dönemi backtest et
                </button>
                {current.status !== 'stopped' ? (
                  <button
                    className="danger-button"
                    disabled={!!busy}
                    onClick={() => command('stop')}
                  >
                    {busy === 'stop' ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Square size={13} />
                    )}
                    Durdur
                  </button>
                ) : (
                  current.reportId && (
                    <button
                      className="secondary compact"
                      onClick={() => onOpenReport(current.reportId!)}
                    >
                      <FileText size={14} /> Nihai raporu aç
                    </button>
                  )
                )}
              </div>
            </div>
            {(current.message || current.stopReason) && (
              <div
                className={
                  'notice ' + (current.status === 'error' ? 'error-notice' : 'paper-message')
                }
                role={current.status === 'error' ? 'alert' : 'status'}
              >
                {[current.stopReason, current.message].filter(Boolean).join(' ')}
              </div>
            )}
            <div className="paper-metrics">
              <PaperCard
                label="Sanal bakiye"
                value={'$' + money(current.metrics?.finalEquity ?? current.config.capital)}
                sub={'Başlangıç $' + money(current.config.capital)}
              />
              <PaperCard
                label="Net getiri"
                value={current.metrics ? pct(current.metrics.returnPct) : '—'}
                sub={
                  current.metrics
                    ? 'Al & tut ' + pct(current.metrics.benchmarkPct)
                    : 'İşlem bekleniyor'
                }
                color={
                  current.metrics ? (current.metrics.returnPct >= 0 ? 'positive' : 'negative') : ''
                }
              />
              <PaperCard
                label="Açık pozisyon"
                value={
                  current.position
                    ? 'LONG @ ' + money(current.position.entry, digitsFor(symbolOf(current.config)))
                    : 'Yok'
                }
                sub={
                  current.position
                    ? `${current.position.quantity.toPrecision(6)} ${baseOf(symbolOf(current.config))} · ${pct((current.position.value / current.position.cost - 1) * 100)}`
                    : 'Sermaye nakitte'
                }
              />
              <PaperCard
                label="Son sinyal"
                value={current.lastSignal ? signalLabels[current.lastSignal.signal] : '—'}
                sub={
                  current.lastSignal
                    ? date(current.lastSignal.time) + ' kapanışı · sonraki açılışta'
                    : 'Henüz yok'
                }
              />
              <PaperCard
                label="Son işlenen mum"
                value={current.lastProcessed !== null ? date(current.lastProcessed) : '—'}
                sub={`${current.tradingCandles.toLocaleString('tr-TR')} işlem · ${current.warmup.toLocaleString('tr-TR')} ısınma mumu`}
              />
              <PaperCard
                label="Bağlantı"
                value={current.feed ? feedLabels[current.feed] : 'Durdu'}
                sub={
                  current.config.mode === 'demo'
                    ? 'Eski demo oturumu · sentetik veri'
                    : 'Binance WebSocket + REST'
                }
              />
            </div>
            {comparison && (
              <div className="paper-compare" aria-label="Karşılaştırma">
                <div className="paper-compare-head">
                  <strong>
                    Karşılaştırma · {date(comparison.lastCandle)} UTC mumuna kadar,{' '}
                    {comparison.candleCount.toLocaleString('tr-TR')} işlem mumu
                  </strong>
                  <button
                    className="icon-button"
                    aria-label="Karşılaştırmayı kapat"
                    onClick={() => setHiddenComparison(comparison.reportId)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th />
                        <th>Canlı (paper)</th>
                        <th>Backtest</th>
                        <th>Fark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map(([label, get, format, unit]) => {
                        const a = get(comparison.live),
                          b = get(comparison.backtest);
                        return (
                          <tr key={label} className={a === b ? '' : 'paper-diff'}>
                            <td>{label}</td>
                            <td>{format(a)}</td>
                            <td>{format(b)}</td>
                            <td>{a === b ? '—' : delta(b - a, unit)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className={comparison.identical ? 'positive' : 'paper-warning'}>
                  {comparison.identical
                    ? '✓ İşlemler ve sermaye eğrisi birebir aynı.'
                    : 'Canlı sonuç ile backtest arasında fark var:'}
                </p>
                {!comparison.identical && (
                  <ul className="paper-differences">
                    {comparison.differences.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
                <small className="muted">
                  Canlı sütunu, oturum bu mumda durdurulsaydı oluşacak nihai rapordur. Backtest aynı
                  mumları yeniden okuyup stratejiyi baştan çalıştırır.
                </small>
                <button className="text-link" onClick={() => onOpenReport(comparison.reportId)}>
                  Backtest raporunu aç <ArrowRight size={14} />
                </button>
              </div>
            )}
            <div className="result-tabs">
              <button className={tab === 'equity' ? 'active' : ''} onClick={() => setTab('equity')}>
                Sermaye Eğrisi
              </button>
              <button className={tab === 'trades' ? 'active' : ''} onClick={() => setTab('trades')}>
                İşlemler <span>{current.tradeCount}</span>
              </button>
              {current.config.strategy === 'python' && (
                <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                  Python Logları
                </button>
              )}
              {tab === 'trades' && s && s.trades.length > 0 && (
                <button
                  className="icon-button paper-csv"
                  aria-label="Canlı işlemleri CSV indir"
                  onClick={() =>
                    download(`bitcoin-lab-canli-${s.id.slice(0, 8)}.csv`, tradesCsv(s.trades))
                  }
                >
                  <Download size={15} />
                </button>
              )}
            </div>
            {!s ? (
              <div className="chart-loading">
                <LoaderCircle className="spin" size={24} />
              </div>
            ) : tab === 'logs' ? (
              <pre className="paper-logs" aria-label="Python logları">
                {s.logs.length
                  ? s.logs.join('\n')
                  : 'Henüz log yok. Başlatmadan sonra kapanan mumlardaki print() çıktıları burada görünür.'}
              </pre>
            ) : tab === 'trades' ? (
              <TradeTable
                trades={s.trades}
                page={tradePage}
                setPage={setTradePage}
                digits={digitsFor(symbolOf(s.config))}
                empty={{
                  title: 'Henüz kapanmış işlem yok.',
                  hint: 'Açık pozisyon kapandığında burada listelenir.',
                }}
              />
            ) : s.equity.length ? (
              <EquityChart points={s.equity} timeVisible />
            ) : (
              <div className="empty-state">
                <Radio size={25} />
                <h3>İlk işlem mumu bekleniyor.</h3>
                <p>İşlemler {date(s.tradeFrom)} UTC açılışında başlayan mumla başlar.</p>
              </div>
            )}
            <div className="result-footnote">
              Isınma {date(current.warmupStart)} UTC'den itibaren · İşlemler{' '}
              {date(current.tradeFrom)} UTC açılışından itibaren · Sinyal kapanmış mumda, işlem
              sonraki açılışta
              {!!current.missingCandles &&
                ` · Binance'te bulunmayan ${current.missingCandles.toLocaleString('tr-TR')} mum (borsa kesintisi) atlandı`}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
function PaperCard({
  label,
  value,
  sub,
  color = '',
}: {
  label: string;
  value: string;
  sub: string;
  color?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={'metric-value ' + color}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
}
