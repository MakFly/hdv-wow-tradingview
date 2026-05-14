import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { TokenPoint } from "@/lib/api";

export function TokenChart({ points }: { points: TokenPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const sRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8089a0", fontSize: 10 },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "transparent" },
      timeScale: { borderColor: "transparent", timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    sRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#f5c542",
      topColor: "rgba(245,197,66,0.35)",
      bottomColor: "rgba(245,197,66,0)",
      lineWidth: 2,
    });
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => {
    if (!sRef.current) return;
    // lightweight-charts needs strictly-ascending unique times; token timestamps
    // are ms, so two points can collapse to the same second — dedupe (keep last).
    const bySec = new Map<number, number>();
    for (const p of points) bySec.set(Math.floor(p.t / 1000), p.price);
    const data = [...bySec.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    sRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return <div ref={ref} className="h-full w-full" />;
}
