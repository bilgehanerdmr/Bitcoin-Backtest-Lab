import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { sma } from '../../shared/engine';
import type { Candle, EquityPoint } from '../../shared/types';
const options = {
  layout: {
    background: { type: ColorType.Solid, color: '#11151c' },
    textColor: '#7c879a',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 11,
    attributionLogo: true,
  },
  grid: { vertLines: { color: '#1c222c' }, horzLines: { color: '#1c222c' } },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
  crosshair: {
    vertLine: { color: '#626c7e', labelBackgroundColor: '#303a48' },
    horzLine: { color: '#626c7e', labelBackgroundColor: '#303a48' },
  },
};
export function PriceChart({
  candles,
  indicators,
  fast,
  slow,
}: {
  candles: Candle[];
  indicators: boolean;
  fast: number;
  slow: number;
}) {
  const el = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi | null>(null),
    series = useRef<ISeriesApi<'Candlestick'> | null>(null),
    volume = useRef<ISeriesApi<'Histogram'> | null>(null),
    ma1 = useRef<ISeriesApi<'Line'> | null>(null),
    ma2 = useRef<ISeriesApi<'Line'> | null>(null),
    fit = useRef(false);
  useEffect(() => {
    if (!el.current) return;
    const ch = createChart(el.current, { ...options, autoSize: true });
    chart.current = ch;
    series.current = ch.addSeries(CandlestickSeries, {
      upColor: '#44c5a0',
      downColor: '#e8787d',
      borderVisible: false,
      wickUpColor: '#44c5a0',
      wickDownColor: '#e8787d',
    });
    series.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.23 } });
    volume.current = ch.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    ma1.current = ch.addSeries(LineSeries, {
      color: '#e6b960',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    ma2.current = ch.addSeries(LineSeries, {
      color: '#8d8de4',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    fit.current = false;
    return () => {
      ch.remove();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    if (!chart.current) return;
    series.current!.setData(candles.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
    volume.current!.setData(
      candles.map((b) => ({
        time: b.time as UTCTimestamp,
        value: b.volume,
        color: b.close >= b.open ? '#44c5a033' : '#e8787d33',
      })),
    );
    const closes = candles.map((b) => b.close);
    [ma1.current, ma2.current].forEach((ma, i) => {
      const values = sma(closes, i ? slow : fast);
      ma!.setData(
        indicators
          ? candles.flatMap((b, j) =>
              values[j] === null ? [] : [{ time: b.time as UTCTimestamp, value: values[j]! }],
            )
          : [],
      );
    });
    if (candles.length && !fit.current) {
      chart.current.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - 110),
        to: candles.length + 3,
      });
      fit.current = true;
    }
  }, [candles, indicators, fast, slow]);
  return (
    <div
      className="price-chart"
      ref={el}
      aria-label="BTC mum grafiği; sürükleyerek gezinin, kaydırarak yakınlaştırın"
    />
  );
}
export function EquityChart({
  points,
  drawdown = false,
  timeVisible = false,
}: {
  points: EquityPoint[];
  drawdown?: boolean;
  // Paper sessions span hours, so the axis needs times rather than only dates.
  timeVisible?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !points.length) return;
    const ch = createChart(el.current, {
      ...options,
      autoSize: true,
      timeScale: { ...options.timeScale, timeVisible },
      handleScroll: false,
      handleScale: false,
    });
    const area = ch.addSeries(AreaSeries, {
      lineColor: drawdown ? '#e8787d' : '#71c8ae',
      topColor: drawdown ? '#e8787d30' : '#71c8ae30',
      bottomColor: drawdown ? '#e8787d02' : '#71c8ae02',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: drawdown
        ? { type: 'custom', formatter: (n: number) => n.toFixed(1) + '%' }
        : { type: 'price' },
    });
    area.setData(
      points.map((p) => ({ time: p.time as UTCTimestamp, value: drawdown ? p.drawdown : p.value })),
    );
    if (!drawdown) {
      const benchmark = ch.addSeries(LineSeries, {
        color: '#69768a',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      benchmark.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.benchmark })));
    }
    ch.timeScale().fitContent();
    return () => ch.remove();
  }, [points, drawdown, timeVisible]);
  return (
    <div
      className="equity-chart"
      ref={el}
      aria-label={drawdown ? 'Düşüş grafiği' : 'Sermaye ve al-tut karşılaştırma grafiği'}
    />
  );
}
