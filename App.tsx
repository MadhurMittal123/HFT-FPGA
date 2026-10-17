
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time
} from "lightweight-charts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  Cpu,
  Database,
  Gauge,
  Moon,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sun,
  Wallet
} from "lucide-react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";
const STARTING_CASH_PAISE = 10_000_000; // ₹1,00,000 simulated starting cash
const REFRESH_MS = 2000;

type AnyRecord = Record<string, unknown>;

type Tick = {
  cycle: number;
  pricePaise: number;
};

type Order = {
  cycle: number;
  pricePaise: number;
  averagePaise: number;
  signal: number | string;
  side: number | string;
  quantity: number;
  position: number;
};

type Risk = {
  cycle: number;
  pricePaise: number;
  signal: number | string;
  position: number;
  message?: string;
};

type DashboardData = {
  status: string;
  source: string;
  mode: string;
  symbol: string;
  connected: boolean;
  serialError: string;
  ticks: Tick[];
  orders: Order[];
  risks: Risk[];
  cycleCount: number;
  tickCount: number;
  orderCount: number;
  riskCount: number;
};

type Mode = "historical" | "live";

type TradeStats = {
  cashPaise: number;
  position: number;
  averageCostPaise: number;
  realizedPaise: number;
  unrealizedPaise: number;
  equityPaise: number;
  totalPnlPaise: number;
  lastPricePaise: number;
};

const EMPTY_DATA: DashboardData = {
  status: "loading",
  source: "—",
  mode: "—",
  symbol: "DEMO",
  connected: false,
  serialError: "",
  ticks: [],
  orders: [],
  risks: [],
  cycleCount: 0,
  tickCount: 0,
  orderCount: 0,
  riskCount: 0
};

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object"
    ? (value as AnyRecord)
    : {};
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim()
    ? value
    : fallback;
}

function firstValue(
  record: AnyRecord,
  keys: string[],
  fallback: unknown = undefined
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return fallback;
}

/**
 * The backend uses paise for prices in its API.
 * If a record only has "price", treat it as rupees when explicitly
 * indicated by the API schema; otherwise retain the numeric value.
 */
function priceFromRecord(record: AnyRecord): number {
  const paise = firstValue(record, [
    "pricePaise",
    "price_paise",
    "lastPaise",
    "last_paise",
    "lastPricePaise",
    "last_price_paise"
  ]);

  if (paise !== undefined) return numberValue(paise);

  return numberValue(
    firstValue(record, ["price", "lastPrice", "last_price"])
  );
}

function normalizeTick(item: unknown, index: number): Tick {
  const row = asRecord(item);

  return {
    cycle: numberValue(
      firstValue(row, ["cycle", "tick", "timestamp_ms", "timestamp", "time"]),
      index + 1
    ),
    pricePaise: priceFromRecord(row)
  };
}

function normalizeOrder(item: unknown, index: number): Order {
  const row = asRecord(item);

  return {
    cycle: numberValue(
      firstValue(row, ["cycle", "tick", "timestamp_ms", "timestamp", "time"]),
      index + 1
    ),
    pricePaise: priceFromRecord(row),
    averagePaise: numberValue(
      firstValue(row, [
        "averagePaise",
        "average_paise",
        "avgPaise",
        "avg_paise",
        "average",
        "avg"
      ])
    ),
    signal: firstValue(row, ["signal", "signalCode"], ""),
    side: firstValue(row, ["side", "orderSide", "order_side"], ""),
    quantity: numberValue(
      firstValue(row, ["quantity", "qty", "orderQty", "order_qty"])
    ),
    position: numberValue(
      firstValue(row, ["position", "currentPosition", "current_position"])
    )
  };
}

function normalizeRisk(item: unknown, index: number): Risk {
  const row = asRecord(item);

  return {
    cycle: numberValue(
      firstValue(row, ["cycle", "tick", "timestamp_ms", "timestamp", "time"]),
      index + 1
    ),
    pricePaise: priceFromRecord(row),
    signal: firstValue(row, ["signal", "signalCode"], ""),
    position: numberValue(
      firstValue(row, ["position", "currentPosition", "current_position"])
    ),
    message: stringValue(
      firstValue(row, ["message", "reason", "riskReason", "risk_reason"])
    )
  };
}

function normalizePayload(payload: unknown, mode: Mode): DashboardData {
  const row = asRecord(payload);

  const ticksRaw = Array.isArray(row.ticks) ? row.ticks : [];
  const ordersRaw = Array.isArray(row.orders) ? row.orders : [];
  const risksRaw = Array.isArray(row.risks) ? row.risks : [];

  const ticks = ticksRaw.map(normalizeTick);
  const orders = ordersRaw.map(normalizeOrder);
  const risks = risksRaw.map(normalizeRisk);

  const connected =
    mode === "historical"
      ? row.status === "ok"
      : row.connected === true;

  return {
    status: stringValue(row.status, "unknown"),
    source: stringValue(
      row.source,
      mode === "live" ? "FPGA UART" : "Historical replay"
    ),
    mode: stringValue(
      row.mode,
      mode === "live" ? "LIVE FPGA" : "HISTORICAL REPLAY"
    ),
    symbol: stringValue(row.symbol, "DEMO"),
    connected,
    serialError: stringValue(row.serialError ?? row.serial_error),
    ticks,
    orders,
    risks,
    cycleCount: numberValue(
      firstValue(row, ["cycleCount", "cycle_count"]),
      ticks.length
    ),
    tickCount: numberValue(
      firstValue(row, ["tickCount", "tick_count"]),
      ticks.length
    ),
    orderCount: numberValue(
      firstValue(row, ["orderCount", "order_count"]),
      orders.length
    ),
    riskCount: numberValue(
      firstValue(row, ["riskCount", "risk_count"]),
      risks.length
    )
  };
}

function formatRupees(paise: number, signed = false): string {
  const rupees = paise / 100;

  return `${signed && rupees > 0 ? "+" : ""}${new Intl.NumberFormat(
    "en-IN",
    {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }
  ).format(rupees)}`;
}

function formatPrice(paise: number): string {
  return formatRupees(paise);
}

function formatTime(cycle: number): string {
  if (!Number.isFinite(cycle)) return "—";
  return String(cycle);
}

function sideName(order: Order): "BUY" | "SELL" | "UNKNOWN" {
  const side = String(order.side).toUpperCase();

  if (side === "1" || side === "BUY" || side === "B") return "BUY";
  if (side === "2" || side === "SELL" || side === "S") return "SELL";

  // This project uses signal codes HOLD=00, BUY=01, SELL=10.
  const signal = String(order.signal).toUpperCase();
  if (signal === "1" || signal === "01" || signal === "BUY") return "BUY";
  if (signal === "2" || signal === "10" || signal === "SELL") return "SELL";

  return "UNKNOWN";
}

/**
 * Approximate accounting for the simulator:
 * - BUY increases holdings and average cost.
 * - SELL realizes profit/loss against average cost.
 * - Remaining holdings use the latest observed market price.
 *
 * Orders with unknown sides or nonpositive quantities are excluded.
 */
function calculateStats(data: DashboardData): TradeStats {
  let cashPaise = STARTING_CASH_PAISE;
  let position = 0;
  let averageCostPaise = 0;
  let realizedPaise = 0;

  const chronologicalOrders = [...data.orders].sort(
    (a, b) => a.cycle - b.cycle
  );

  for (const order of chronologicalOrders) {
    const quantity = Math.max(0, Math.floor(order.quantity));
    const price = order.pricePaise;
    const side = sideName(order);

    if (quantity <= 0 || price <= 0) continue;

    if (side === "BUY") {
      const newPosition = position + quantity;
      averageCostPaise =
        newPosition > 0
          ? (averageCostPaise * position + price * quantity) / newPosition
          : 0;

      position = newPosition;
      cashPaise -= price * quantity;
    } else if (side === "SELL") {
      const sellQuantity = Math.min(quantity, position);

      if (sellQuantity <= 0) continue;

      realizedPaise += (price - averageCostPaise) * sellQuantity;
      position -= sellQuantity;
      cashPaise += price * sellQuantity;

      if (position === 0) averageCostPaise = 0;
    }
  }

  const lastTick = data.ticks[data.ticks.length - 1];
  const lastOrder = data.orders[data.orders.length - 1];
  const lastPricePaise =
    lastTick?.pricePaise || lastOrder?.pricePaise || 0;

  const unrealizedPaise =
    position > 0 && lastPricePaise > 0
      ? (lastPricePaise - averageCostPaise) * position
      : 0;

  const equityPaise = cashPaise + position * lastPricePaise;
  const totalPnlPaise = equityPaise - STARTING_CASH_PAISE;

  return {
    cashPaise,
    position,
    averageCostPaise,
    realizedPaise,
    unrealizedPaise,
    equityPaise,
    totalPnlPaise,
    lastPricePaise
  };
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <div className={`stat-value ${tone}`}>{value}</div>
      <div className="stat-detail">{detail}</div>
    </section>
  );
}

type Theme = "light" | "dark";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartPalette() {
  return {
    bg: cssVar("--chart-bg"),
    text: cssVar("--chart-text"),
    gridV: cssVar("--chart-grid-v"),
    gridH: cssVar("--chart-grid-h"),
    border: cssVar("--chart-border"),
    cross: cssVar("--chart-cross"),
    crossLabel: cssVar("--chart-cross-label"),
    price: cssVar("--chart-price"),
    priceTop: cssVar("--chart-price-top"),
    priceBottom: cssVar("--chart-price-bottom"),
    avg: cssVar("--chart-avg")
  };
}

function PriceChart({
  ticks,
  orders,
  theme
}: {
  ticks: Tick[];
  orders: Order[];
  theme: Theme;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const averageRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const p = chartPalette();

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 400,
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11
      },
      grid: {
        vertLines: { color: p.gridV },
        horzLines: { color: p.gridH }
      },
      rightPriceScale: {
        borderColor: p.border
      },
      timeScale: {
        borderColor: p.border,
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: p.cross, labelBackgroundColor: p.crossLabel },
        horzLine: { color: p.cross, labelBackgroundColor: p.crossLabel }
      },
      localization: {
        priceFormatter: (price: number) =>
          `₹${(price / 100).toFixed(2)}`
      }
    });

    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor: p.price,
      topColor: p.priceTop,
      bottomColor: p.priceBottom,
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: p.price
    });

    const averageSeries = chart.addSeries(LineSeries, {
      color: p.avg,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true
    });

    chartRef.current = chart;
    areaRef.current = priceSeries;
    averageRef.current = averageSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && chartRef.current) {
        chartRef.current.applyOptions({ width });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      areaRef.current = null;
      averageRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!areaRef.current || !averageRef.current || !chartRef.current) return;

    const p = chartPalette();

    chartRef.current.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: p.bg },
        textColor: p.text
      },
      grid: {
        vertLines: { color: p.gridV },
        horzLines: { color: p.gridH }
      },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border },
      crosshair: {
        vertLine: { color: p.cross, labelBackgroundColor: p.crossLabel },
        horzLine: { color: p.cross, labelBackgroundColor: p.crossLabel }
      }
    });

    (areaRef.current as ISeriesApi<"Area">).applyOptions({
      lineColor: p.price,
      topColor: p.priceTop,
      bottomColor: p.priceBottom,
      priceLineColor: p.price
    });

    (averageRef.current as ISeriesApi<"Line">).applyOptions({ color: p.avg });
  }, [theme]);

  useEffect(() => {
    if (!areaRef.current || !averageRef.current || !chartRef.current) return;

    const toTime = (value: number, index: number): Time => {
      // Lightweight Charts requires unique, ascending time values.
      // Use a monotonic synthetic timeline based on the record index.
      return (1_700_000_000 + index) as Time;
    };

    const priceData = ticks
      .filter((tick) => tick.pricePaise > 0)
      .map((tick, index) => ({
        time: toTime(tick.cycle, index),
        value: tick.pricePaise
      }));

    areaRef.current.setData(priceData);

    const averageData = orders
      .filter((order) => order.averagePaise > 0)
      .map((order, index) => ({
        time: toTime(order.cycle, index),
        value: order.averagePaise
      }));

    averageRef.current.setData(averageData);

    if (priceData.length > 0) {
      chartRef.current.timeScale().fitContent();
    }
  }, [ticks, orders]);

  return (
    <div className="chart-shell">
      <div className="chart-legend">
        <span><i className="legend-dot price-dot" /> Market price</span>
        <span><i className="legend-dot average-dot" /> Rolling average</span>
      </div>
      <div className="chart-container" ref={containerRef} />
      {ticks.length === 0 && (
        <div className="chart-empty">
          Waiting for market tick data…
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>("historical");
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [paused, setPaused] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("nexus-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  // Layout effects run before child effects, so the chart reads the right palette.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("nexus-theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const fetchData = useCallback(async () => {
    try {
      const endpoint =
        mode === "live" ? `${API_BASE}/api/live` : `${API_BASE}/api/data`;

      const response = await fetch(endpoint, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const payload: unknown = await response.json();
      const normalized = normalizePayload(payload, mode);

      setData(normalized);
      setLastUpdated(new Date());
      setError("");

      if (mode === "live" && !normalized.connected) {
        setError(
          normalized.serialError ||
            "Backend is reachable, but the FPGA UART is not connected."
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not connect to the backend."
      );
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    setLoading(true);
    setData(EMPTY_DATA);
    setError("");
    void fetchData();

    if (paused) return;

    const timer = window.setInterval(() => {
      void fetchData();
    }, REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [fetchData, paused]);

  const stats = useMemo(() => calculateStats(data), [data]);

  const session = useMemo(() => {
    const prices = data.ticks
      .map((tick) => tick.pricePaise)
      .filter((price) => price > 0);

    if (prices.length === 0) {
      return { high: 0, low: 0, open: 0, change: 0, changePct: 0 };
    }

    const open = prices[0];
    const last = prices[prices.length - 1];

    return {
      high: Math.max(...prices),
      low: Math.min(...prices),
      open,
      change: last - open,
      changePct: open > 0 ? ((last - open) / open) * 100 : 0
    };
  }, [data.ticks]);

  const pnlTone =
    stats.totalPnlPaise > 0
      ? "positive"
      : stats.totalPnlPaise < 0
        ? "negative"
        : "neutral";

  const latestPrice =
    data.ticks[data.ticks.length - 1]?.pricePaise ||
    stats.lastPricePaise;

  const connectionLabel =
    mode === "historical"
      ? data.status === "ok"
        ? "Replay ready"
        : loading
          ? "Loading"
          : "Not ready"
      : data.connected
        ? "FPGA connected"
        : "FPGA disconnected";

  const changeTone =
    session.change > 0 ? "positive" : session.change < 0 ? "negative" : "neutral";

  const isConnected =
    data.connected || (mode === "historical" && data.status === "ok");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Activity size={16} /></div>
          <div className="brand-name">FPGA<span>HFT</span></div>
          <div className="brand-caption">ELECTRONICS CLUB IIT INDORE</div>
        </div>

        <div className="topbar-spacer" />

        <div className="mode-controls">
          <button
            className={`mode-button ${mode === "historical" ? "active" : ""}`}
            onClick={() => setMode("historical")}
          >
            <Database size={13} /> Historical Replay
          </button>
          <button
            className={`mode-button ${mode === "live" ? "active" : ""}`}
            onClick={() => setMode("live")}
          >
            <Radio size={13} /> Live FPGA
          </button>
        </div>

        <span className={`connection-pill ${isConnected ? "is-connected" : "is-offline"}`}>
          <span className="status-dot" />
          {connectionLabel}
        </span>
        <button className="icon-button" onClick={() => void fetchData()} title="Refresh data">
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button"
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
        >
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </header>

      {error && (
        <div className={`notice ${mode === "live" ? "notice-warning" : "notice-error"}`}>
          <span className="notice-indicator" />
          <div>
            <strong>
              {mode === "live" ? "Live connection notice" : "Backend connection issue"}
            </strong>
            <p>{error}</p>
            {mode === "live" && (
              <p className="notice-hint">
                Check that backend.py is running and the FPGA is connected on COM3 at 115200 baud.
                Close any other application reading COM3.
              </p>
            )}
          </div>
        </div>
      )}

      <section className="quote-bar">
        <div className="quote-cell">
          <div className="quote-symbol">
            <span className="symbol">{data.symbol}</span>
            <span className="exchange">{mode === "live" ? "Live" : "Replay"}</span>
          </div>
          <span className="quote-sub">{data.source}</span>
        </div>
        <div className="quote-cell">
          <div className="quote-price">
            <span className={`last-price ${latestPrice > 0 ? changeTone : ""}`}>
              {latestPrice > 0 ? formatPrice(latestPrice) : "—"}
            </span>
            <span className={`price-change ${changeTone}`}>
              {session.open > 0
                ? `${session.change >= 0 ? "+" : ""}${(session.change / 100).toFixed(2)} (${session.changePct >= 0 ? "+" : ""}${session.changePct.toFixed(2)}%)`
                : "—"}
            </span>
          </div>
          <span className="quote-sub">Last price · change since first tick</span>
        </div>
        <div className="quote-cell">
          <span className="metric-label">Session High</span>
          <span className="metric-value">{session.high > 0 ? formatPrice(session.high) : "—"}</span>
        </div>
        <div className="quote-cell">
          <span className="metric-label">Session Low</span>
          <span className="metric-value">{session.low > 0 ? formatPrice(session.low) : "—"}</span>
        </div>
        <div className="quote-cell">
          <span className="metric-label">Ticks</span>
          <span className="metric-value">{data.tickCount.toLocaleString("en-IN")}</span>
        </div>
        <div className="quote-cell">
          <span className="metric-label">Orders</span>
          <span className="metric-value">{data.orderCount.toLocaleString("en-IN")}</span>
        </div>
        <div className="quote-cell">
          <span className="metric-label">Risk Events</span>
          <span className={`metric-value ${data.riskCount > 0 ? "negative" : ""}`}>
            {data.riskCount.toLocaleString("en-IN")}
          </span>
        </div>
      </section>

      <section className="summary-grid">
        <StatCard
          label="Portfolio Equity"
          value={formatRupees(stats.equityPaise)}
          detail="Cash + marked-to-market holdings"
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Available Cash"
          value={formatRupees(stats.cashPaise)}
          detail={`Starting cash ${formatRupees(STARTING_CASH_PAISE)}`}
          icon={<CircleDollarSign size={15} />}
        />
        <StatCard
          label="Open Position"
          value={`${stats.position.toLocaleString("en-IN")} units`}
          detail={
            stats.position > 0
              ? `Average cost ${formatPrice(stats.averageCostPaise)}`
              : "No open long position"
          }
          icon={<Gauge size={15} />}
        />
        <StatCard
          label="Position Value"
          value={formatRupees(stats.position * stats.lastPricePaise)}
          detail={`Unrealized ${formatRupees(stats.unrealizedPaise, true)}`}
          icon={stats.totalPnlPaise >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          tone={pnlTone}
        />
      </section>

      <section className="main-grid">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Market Performance</div>
              <div className="panel-subtitle">
                Price and rolling average · {data.symbol}
              </div>
            </div>
            <span className={`live-tag ${mode === "live" ? "" : "is-replay"}`}>
              <span className="status-dot" />
              {mode === "live" ? "Live feed" : "Replay data"}
            </span>
          </div>
          <PriceChart ticks={data.ticks} orders={data.orders} theme={theme} />
          <div className="chart-footer">
            <div>
              <span className="footer-label">Market ticks</span>
              <strong>{data.tickCount.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span className="footer-label">Orders</span>
              <strong>{data.orderCount.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span className="footer-label">Risk events</span>
              <strong>{data.riskCount.toLocaleString("en-IN")}</strong>
            </div>
            <div>
              <span className="footer-label">Last update</span>
              <strong>{lastUpdated ? lastUpdated.toLocaleTimeString("en-IN") : "—"}</strong>
            </div>
          </div>
        </div>

        <div className="panel pnl-panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Profit & Loss</div>
              <div className="panel-subtitle">Simulator accounting estimate</div>
            </div>
            <span className={`pnl-badge ${pnlTone}`}>
              {stats.totalPnlPaise >= 0 ? "Profit" : "Loss"}
            </span>
          </div>

          <div className="panel-body">
            <div className={`big-pnl ${pnlTone}`}>
              {formatRupees(stats.totalPnlPaise, true)}
            </div>
            <div className="pnl-caption">Total simulated return from starting cash</div>

            <div className="pnl-breakdown">
              <div className="pnl-row">
                <span>Realized P&L</span>
                <strong className={stats.realizedPaise >= 0 ? "positive" : "negative"}>
                  {formatRupees(stats.realizedPaise, true)}
                </strong>
              </div>
              <div className="pnl-row">
                <span>Unrealized P&L</span>
                <strong className={stats.unrealizedPaise >= 0 ? "positive" : "negative"}>
                  {formatRupees(stats.unrealizedPaise, true)}
                </strong>
              </div>
              <div className="pnl-row">
                <span>Available simulated cash</span>
                <strong>{formatRupees(stats.cashPaise)}</strong>
              </div>
              <div className="pnl-row">
                <span>Market value of position</span>
                <strong>{formatRupees(stats.position * stats.lastPricePaise)}</strong>
              </div>
            </div>
          </div>

          <div className="pnl-note">
            <ShieldCheck size={14} />
            <span>
              Estimated from the order events supplied by the backend. This is not a broker account balance.
            </span>
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Execution Activity</div>
              <div className="panel-subtitle">Latest accepted order events</div>
            </div>
            <span className="count-badge">{data.orders.length}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {[...data.orders].slice(-12).reverse().map((order, index) => {
                  const side = sideName(order);
                  return (
                    <tr key={`${order.cycle}-${index}`}>
                      <td className="muted-cell">{formatTime(order.cycle)}</td>
                      <td>
                        <span className={`side-pill ${side.toLowerCase()}`}>
                          {side === "BUY" ? <ArrowUpRight size={11} /> : side === "SELL" ? <ArrowDownRight size={11} /> : null}
                          {side}
                        </span>
                      </td>
                      <td className="numeric-cell">{formatPrice(order.pricePaise)}</td>
                      <td className="numeric-cell">{order.quantity}</td>
                      <td className="numeric-cell">{order.position}</td>
                    </tr>
                  );
                })}
                {data.orders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No order events received yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <div className="panel-title">Risk Monitor</div>
              <div className="panel-subtitle">Risk manager event history</div>
            </div>
            <span className={`count-badge ${data.risks.length ? "risk-count" : ""}`}>
              {data.risks.length}
            </span>
          </div>

          <div className={`risk-summary ${data.risks.length ? "has-risk" : ""}`}>
            <div className="risk-summary-icon">
              <ShieldCheck size={16} />
            </div>
            <div>
              <strong>{data.risks.length === 0 ? "No risk events recorded" : `${data.risks.length} risk events recorded`}</strong>
              <p>Events reported by the backend risk monitor.</p>
            </div>
          </div>

          <div className="risk-list">
            {[...data.risks].slice(-8).reverse().map((risk, index) => (
              <div className="risk-item" key={`${risk.cycle}-${index}`}>
                <span className="risk-event-dot" />
                <div className="risk-event-main">
                  <strong>{risk.message || "Risk event / order rejected"}</strong>
                  <span>Cycle {risk.cycle}, position {risk.position}</span>
                </div>
                <span className="risk-price">
                  {risk.pricePaise > 0 ? formatPrice(risk.pricePaise) : "—"}
                </span>
              </div>
            ))}
            {data.risks.length === 0 && (
              <div className="risk-empty">
                <ShieldCheck size={20} />
                <span>Risk monitor is clear for the events received.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-brand">
          <Cpu size={13} /> NexusHFT <span>FPGA terminal</span>
        </div>
        <div className="footer-meta">
          <span><Clock3 size={12} /> Refresh: {REFRESH_MS / 1000}s</span>
          <span><CircleDollarSign size={12} /> P&L is simulated</span>
          <span><Activity size={12} /> {paused ? "Refresh paused" : "Auto refresh enabled"}</span>
        </div>
        <button className="text-button" onClick={() => setPaused((value) => !value)}>
          {paused ? "Resume refresh" : "Pause refresh"}
        </button>
      </footer>

      {loading && data.ticks.length === 0 && (
        <div className="loading-overlay">
          <RefreshCw size={14} className="spin" />
          Connecting to HFT backend…
        </div>
      )}
    </main>
  );
}
