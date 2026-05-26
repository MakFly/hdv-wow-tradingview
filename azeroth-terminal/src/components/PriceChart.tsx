import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createChart,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type IPrimitivePaneRenderer,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Crosshair, RotateCcw, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtGoldShort } from "@/lib/api";

type Point = { t: number; min: number; median: number; total: number; listings: number };

type Tf = "5m" | "15m" | "1h" | "4h" | "1d";

const STEP: Record<Tf, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type StockBar = { time: UTCTimestamp; value: number; color: string };
type LinePoint = { time: UTCTimestamp; value: number };
type Bucket = {
  candle: Candle;
  stock: number;
  listings: number;
  median: number;
};
type LegendBucket = Bucket | null;
type TooltipPos = { left: number; top: number } | null;

/**
 * Bucket raw snapshots into OHLC candles, a volume series and a median line —
 * all sharing the SAME unique, ascending time buckets. lightweight-charts
 * rejects data that isn't strictly ascending by time, so every series must be
 * derived from one deduplicated bucket map (several snapshots can land in the
 * same timeframe slot).
 */
function toMarketBuckets(points: Point[], tf: Tf) {
  if (points.length === 0) return { candles: [], stockBars: [], medians: [], buckets: [] };
  const step = STEP[tf];
  const buckets = new Map<number, Bucket>();
  // process chronologically so open = first snapshot, close = last snapshot
  const sorted = points.slice().sort((a, b) => a.t - b.t);
  for (const p of sorted) {
    const slot = p.t - (p.t % step);
    const price = p.min; // candle = lowest buyout in snapshot
    const b = buckets.get(slot);
    if (!b) {
      buckets.set(slot, {
        candle: { time: slot as UTCTimestamp, open: price, high: price, low: price, close: price },
        stock: p.total,
        listings: p.listings,
        median: p.median,
      });
    } else {
      b.candle.close = price;
      b.candle.high = Math.max(b.candle.high, price);
      b.candle.low = Math.min(b.candle.low, price);
      b.stock = p.total;
      b.listings = p.listings;
      b.median = p.median; // last median in the bucket, mirrors `close`
    }
  }
  const ordered = [...buckets.values()].sort((a, b) => (a.candle.time as number) - (b.candle.time as number));
  const candles = ordered.map(v => v.candle);
  const stockBars = ordered.map((v): StockBar => ({
    time: v.candle.time,
    value: v.stock,
    color: v.candle.close >= v.candle.open ? "rgba(38,215,130,.34)" : "rgba(239,79,79,.32)",
  }));
  const medians = ordered.map((v): LinePoint => ({ time: v.candle.time, value: v.median }));
  return { candles, stockBars, medians, buckets: ordered };
}

/** Simple moving average of candle closes; emits a point only once `period`
 *  closes are available, so the line starts where it becomes meaningful. */
function sma(candles: Candle[], period: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

// ----- min–median spread band ----------------------------------------------
// lightweight-charts v5 has no built-in two-series band, so the shaded zone
// between each candle's min (close) and its median is drawn as a series
// primitive: a single filled polygon on the candlestick pane.

type BandPoint = { time: Time; min: number; median: number };

type BitmapScope = {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
};
type DrawTarget = { useBitmapCoordinateSpace: (cb: (scope: BitmapScope) => void) => void };

class BandRenderer implements IPrimitivePaneRenderer {
  private readonly src: SpreadBand;
  constructor(src: SpreadBand) {
    this.src = src;
  }
  draw(target: DrawTarget) {
    const { chart, series } = this.src;
    if (!chart || !series || this.src.data.length < 2) return;
    const ts = chart.timeScale();
    const pts: { x: number; yMin: number; yMed: number }[] = [];
    for (const d of this.src.data) {
      const x = ts.timeToCoordinate(d.time);
      const yMin = series.priceToCoordinate(d.min);
      const yMed = series.priceToCoordinate(d.median);
      if (x !== null && yMin !== null && yMed !== null) pts.push({ x, yMin, yMed });
    }
    if (pts.length < 2) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * hr, pts[0].yMed * vr);
      for (const p of pts) ctx.lineTo(p.x * hr, p.yMed * vr); // top edge: median
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x * hr, pts[i].yMin * vr); // back along min
      ctx.closePath();
      ctx.fillStyle = "rgba(245,197,66,0.09)";
      ctx.fill();
    });
  }
}

class BandPaneView implements IPrimitivePaneView {
  private readonly _renderer: BandRenderer;
  constructor(src: SpreadBand) {
    this._renderer = new BandRenderer(src);
  }
  renderer() {
    return this._renderer;
  }
}

class SpreadBand implements ISeriesPrimitive<Time> {
  data: BandPoint[] = [];
  chart: IChartApi | null = null;
  series: ISeriesApi<"Candlestick"> | null = null;
  private readonly view = new BandPaneView(this);
  private requestUpdate?: () => void;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<"Candlestick">;
    this.requestUpdate = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = undefined;
  }
  setData(d: BandPoint[]) {
    this.data = d;
    this.requestUpdate?.();
  }
  paneViews() {
    return [this.view];
  }
}

// ----- crosshair OHLC legend ------------------------------------------------

const fmtUtc = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

function formatCount(n: number) {
  return Number.isFinite(n) ? `×${Math.round(n).toLocaleString()}` : "—";
}

function spread(bucket: Bucket) {
  const value = Math.max(0, bucket.median - bucket.candle.close);
  const pct = bucket.candle.close > 0 ? (value / bucket.candle.close) * 100 : 0;
  return { value, pct };
}

export function PriceChart({ points, tf }: { points: Point[]; tf: Tf }) {
  const { t } = useTranslation();
  const series = useMemo(() => toMarketBuckets(points, tf), [points, tf]);
  const [legend, setLegend] = useState<LegendBucket>(() => series.buckets.at(-1) ?? null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const csRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const medRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma7Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bandRef = useRef<SpreadBand | null>(null);
  // fitContent() must run on mount and on every timeframe change, but NOT on
  // each live tick — that would yank the user's zoom/pan back on every SSE push.
  const fittedTf = useRef<Tf | null>(null);
  const bucketsRef = useRef(new Map<number, Bucket>());

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8089a0", fontFamily: "JetBrains Mono, ui-monospace, monospace" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      localization: { priceFormatter: (price: number) => fmtGoldShort(price) },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(245,197,66,0.62)",
          style: LineStyle.Dashed,
          width: 1,
          labelBackgroundColor: "#b98712",
          labelVisible: true,
          visible: true,
        },
        horzLine: {
          color: "rgba(245,197,66,0.48)",
          style: LineStyle.Dotted,
          width: 1,
          labelBackgroundColor: "#b98712",
          labelVisible: true,
          visible: true,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: { mouse: true, touch: true },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.05)", autoScale: true },
      timeScale: { borderColor: "rgba(255,255,255,0.05)", timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    csRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#26d782",
      downColor: "#ef4f4f",
      borderUpColor: "#26d782",
      borderDownColor: "#ef4f4f",
      wickUpColor: "#26d782",
      wickDownColor: "#ef4f4f",
    });
    volRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "stock",
      priceFormat: {
        type: "custom",
        minMove: 1,
        formatter: (value: number) => formatCount(value),
      },
      color: "#3a4159",
      lastValueVisible: false,
    });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    medRef.current = chart.addSeries(LineSeries, {
      color: "rgba(245,197,66,0.9)",
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: false,
    });
    ma7Ref.current = chart.addSeries(LineSeries, {
      color: "#5ec8e0",
      lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    ma20Ref.current = chart.addSeries(LineSeries, {
      color: "#b98bff",
      lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    bandRef.current = new SpreadBand();
    csRef.current.attachPrimitive(bandRef.current);

    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point || !ref.current) {
        setLegend(bucketsRef.current.get(Number([...bucketsRef.current.keys()].at(-1))) ?? null);
        setTooltipPos(null);
        return;
      }
      setLegend(bucketsRef.current.get(param.time as number) ?? null);
      const width = ref.current.clientWidth;
      const height = ref.current.clientHeight;
      setTooltipPos({
        left: Math.min(Math.max(param.point.x + 14, 8), Math.max(8, width - 236)),
        top: Math.min(Math.max(param.point.y + 14, 48), Math.max(48, height - 154)),
      });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!csRef.current || !volRef.current || !medRef.current || !ma7Ref.current || !ma20Ref.current) return;
    const { candles, stockBars, medians, buckets } = series;
    bucketsRef.current = new Map(buckets.map(b => [b.candle.time as number, b]));
    csRef.current.setData(candles);
    volRef.current.setData(stockBars);
    medRef.current.setData(medians);
    ma7Ref.current.setData(sma(candles, 7));
    ma20Ref.current.setData(sma(candles, 20));
    bandRef.current?.setData(
      candles.map((c, i) => ({ time: c.time, min: c.close, median: medians[i]?.value ?? c.close }))
    );
    setLegend(buckets[buckets.length - 1] ?? null);
    // fit only on first paint for this timeframe — never on a live tick
    if (fittedTf.current !== tf && candles.length) {
      chartRef.current?.timeScale().fitContent();
      fittedTf.current = tf;
    }
  }, [series, tf]);

  const trendUp = legend ? legend.candle.close >= legend.candle.open : true;
  const currentSpread = legend ? spread(legend) : null;
  const resetView = () => {
    chartRef.current?.timeScale().fitContent();
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  };
  const scrollToLatest = () => chartRef.current?.timeScale().scrollToRealTime();

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute top-2 right-2 left-2 z-10 flex flex-wrap items-start justify-between gap-2 font-mono text-[10px]">
        <div className="bg-card/85 flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 shadow-sm backdrop-blur">
          <span className="text-muted-foreground">{legend ? fmtUtc(legend.candle.time as number) : "—"}</span>
          {legend && (
            <>
              <span>
                <span className="text-muted-foreground">{t("chart.ohlc.open")}</span> {fmtGoldShort(legend.candle.open)}
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.ohlc.high")}</span> {fmtGoldShort(legend.candle.high)}
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.ohlc.low")}</span> {fmtGoldShort(legend.candle.low)}
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.ohlc.close")}</span>{" "}
                <span className={trendUp ? "text-emerald-400" : "text-red-400"}>
                  {fmtGoldShort(legend.candle.close)}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.medianShort")}</span>{" "}
                <span className="text-amber-300">{fmtGoldShort(legend.median)}</span>
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.spreadShort")}</span>{" "}
                {currentSpread ? `${fmtGoldShort(currentSpread.value)} · ${currentSpread.pct.toFixed(1)}%` : "—"}
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.stockShort")}</span> {formatCount(legend.stock)}
              </span>
              <span>
                <span className="text-muted-foreground">{t("chart.listingsShort")}</span>{" "}
                {formatCount(legend.listings)}
              </span>
            </>
          )}
        </div>
        <div className="bg-card/85 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-2 py-1 shadow-sm backdrop-blur">
          <span className="flex items-center gap-1 text-emerald-300">
            <span className="h-2 w-2 rounded-sm bg-emerald-400" />
            {t("chart.legend.priceGold")}
          </span>
          <span className="flex items-center gap-1 text-amber-300">
            <span className="h-2 w-2 rounded-sm bg-amber-300" />
            {t("chart.legend.medianGold")}
          </span>
          <span className="flex items-center gap-1 text-cyan-300">
            <span className="h-2 w-2 rounded-sm bg-cyan-300" />
            {t("chart.legend.ma7")}
          </span>
          <span className="flex items-center gap-1 text-violet-300">
            <span className="h-2 w-2 rounded-sm bg-violet-300" />
            {t("chart.legend.ma20")}
          </span>
          <span className="text-muted-foreground flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-slate-500" />
            {t("chart.legend.stockUnits")}
          </span>
        </div>
      </div>
      <div className="absolute right-2 bottom-2 z-10 flex gap-1">
        <Button variant="outline" size="sm" className="bg-card/85 h-7 px-2 backdrop-blur" title={t("chart.controls.reset")} onClick={resetView}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="bg-card/85 h-7 px-2 backdrop-blur" title={t("chart.controls.latest")} onClick={scrollToLatest}>
          <StepForward className="h-3.5 w-3.5" />
        </Button>
      </div>
      {legend && tooltipPos && currentSpread && (
        <div
          className="pointer-events-none absolute z-20 w-[228px] rounded-md border bg-card/95 p-2 font-mono text-[10px] shadow-lg backdrop-blur"
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-muted-foreground truncate">{fmtUtc(legend.candle.time as number)}</span>
            <Crosshair className="h-3 w-3 text-amber-300" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-muted-foreground">{t("chart.ohlc.open")}</span>
            <span className="text-right">{fmtGoldShort(legend.candle.open)}</span>
            <span className="text-muted-foreground">{t("chart.ohlc.high")}</span>
            <span className="text-right">{fmtGoldShort(legend.candle.high)}</span>
            <span className="text-muted-foreground">{t("chart.ohlc.low")}</span>
            <span className="text-right">{fmtGoldShort(legend.candle.low)}</span>
            <span className="text-muted-foreground">{t("chart.ohlc.close")}</span>
            <span className={`text-right ${trendUp ? "text-emerald-400" : "text-red-400"}`}>
              {fmtGoldShort(legend.candle.close)}
            </span>
            <span className="text-muted-foreground">{t("chart.median")}</span>
            <span className="text-right text-amber-300">{fmtGoldShort(legend.median)}</span>
            <span className="text-muted-foreground">{t("chart.spread")}</span>
            <span className="text-right">{fmtGoldShort(currentSpread.value)} · {currentSpread.pct.toFixed(1)}%</span>
            <span className="text-muted-foreground">{t("chart.stock")}</span>
            <span className="text-right">{formatCount(legend.stock)}</span>
            <span className="text-muted-foreground">{t("chart.listings")}</span>
            <span className="text-right">{formatCount(legend.listings)}</span>
          </div>
        </div>
      )}
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
