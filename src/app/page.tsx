"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type PriceRow = {
  symbol: string;
  usdc: number | null;
  usd: number | null;
  source: string;
  fetchedAt: number;
  error?: string;
};

type FeesResponse = {
  symbol: string;
  amount: number;
  spotUsdc: number | null;
  rows: Array<{
    to: "usdc-sol" | "usdc-eth";
    estimatedUsdc: number | null;
    impliedFeeUsdc: number | null;
    impliedFeePct: number | null;
    error?: string;
  }>;
  quoteFetchedAt?: number;
  fetchedAt: number;
};

type QuoteResponse = {
  symbol: string;
  amount: number;
  network: "sol" | "eth";
  estimatedUsdc: number | null;
  totalUsd: number | null;
  effectiveUsdPerToken: number | null;
  spotTotalUsd: number | null;
  impliedFeeUsd: number | null;
  impliedFeePct: number | null;
  minAmount: number | null;
  error?: string;
  source: string;
  fetchedAt: number;
};

type ThetaRewardsResponse = {
  addresses: string[];
  results: Array<{
    address: string;
    tfuelBalance: number | null;
    stakedTheta: number | null;
    rewards7d: number | null;
    rewards30d: number | null;
    lastRewardAt: number | null;
  }>;
  fetchedAt: number;
};

type ThetaEarnedResponse = {
  sinceSec: number;
  addresses: string[];
  results: Array<{
    address: string;
    earned: number | null;
    lastRewardAt: number | null;
    pagesFetched: number;
  }>;
  fetchedAt: number;
};

type TokenPricePoint = {
  t: number;
  price: number;
};

type PriceHistoryStore = {
  tfuel: TokenPricePoint[];
  theta: TokenPricePoint[];
};

type HistoryResponse = {
  symbol: string;
  days: number;
  prices: Array<{ t: number; price: number }>;
  fetchedAt: number;
};

function formatMoney(v: number | null, currency: "USD" | "USDC") {
  if (v == null || Number.isNaN(v)) return "—";

  if (currency === "USDC") {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "decimal",
      maximumFractionDigits: v < 1 ? 6 : 2,
    }).format(v);
    return `${formatted} USDC`;
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: v < 1 ? 6 : 2,
  }).format(v);
}

async function getPrice(symbol: string): Promise<PriceRow> {
  const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return {
      symbol,
      usdc: null,
      usd: null,
      source: "simpleswap",
      fetchedAt: Date.now(),
      error: `HTTP ${res.status}`,
    };
  }

  return (await res.json()) as PriceRow;
}

export default function Home() {
  const refreshOptions = useMemo(
    () => [
      { ms: 0, label: "Off" },
      { ms: 15_000, label: "15s" },
      { ms: 30_000, label: "30s" },
      { ms: 60_000, label: "60s" },
    ],
    [],
  );

  const refreshLabel = useMemo(() => {
    const map = new Map(refreshOptions.map((o) => [o.ms, o.label] as const));
    return (ms: number) => map.get(ms) ?? `${Math.round(ms / 1000)}s`;
  }, [refreshOptions]);

  const tokens = useMemo(
    () => [
      { symbol: "tfuel", label: "TFUEL" },
      { symbol: "theta", label: "THETA" },
    ],
    [],
  );

  const trackedThetaAddresses = useMemo(
    () => [
      "0xa7c140c272fe9d9c30ec6af97c209f745375cfa4",
      "0x343a8bacd985f8ef2fc59d567edc78a097bf87e8",
    ],
    [],
  );

  const [prices, setPrices] = useState<Record<string, PriceRow>>({});
  const [loading, setLoading] = useState(false);
  const [pricesLastUpdatedAt, setPricesLastUpdatedAt] = useState<number | null>(
    null,
  );
  const [pricesAutoRefreshMs, setPricesAutoRefreshMs] = useState<number>(30_000);
  const [tab, setTab] = useState<"prices" | "swap" | "staking">("prices");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("tfuel");
  const [amount, setAmount] = useState<string>("");
  const [amountTouched, setAmountTouched] = useState(false);

  const [pricesRefreshNonce, setPricesRefreshNonce] = useState(0);
  const [swapRefreshNonce, setSwapRefreshNonce] = useState(0);
  const [stakingRefreshNonce, setStakingRefreshNonce] = useState(0);

  const [touchStart, setTouchStart] = useState<{
    x: number;
    y: number;
    atTop: boolean;
    ignore: boolean;
  } | null>(null);

  const [swapAutoRefreshMs, setSwapAutoRefreshMs] = useState<number>(15_000);
  const [stakingAutoRefreshMs, setStakingAutoRefreshMs] = useState<number>(60_000);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const rows = await Promise.all(tokens.map((t) => getPrice(t.symbol)));
        if (cancelled) return;
        setPrices((prev) => {
          const next = { ...prev };
          for (const r of rows) next[r.symbol] = r;
          return next;
        });
        setPricesLastUpdatedAt(Date.now());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id =
      pricesAutoRefreshMs > 0
        ? window.setInterval(load, pricesAutoRefreshMs)
        : null;
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
    };
  }, [tokens, pricesAutoRefreshMs, pricesRefreshNonce]);

  function triggerRefreshForTab(nextTab: "prices" | "swap" | "staking") {
    if (nextTab === "prices") setPricesRefreshNonce((v) => v + 1);
    if (nextTab === "swap") setSwapRefreshNonce((v) => v + 1);
    if (nextTab === "staking") setStakingRefreshNonce((v) => v + 1);
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const ignore =
      tag === "input" ||
      tag === "select" ||
      tag === "textarea" ||
      tag === "button" ||
      Boolean(target?.closest("input,select,textarea,button,a"));

    setTouchStart({
      x: t.clientX,
      y: t.clientY,
      atTop: (window.scrollY ?? 0) <= 0,
      ignore,
    });
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (!touchStart) return;
    setTouchStart(null);

    if (touchStart.ignore) return;
    const t = e.changedTouches[0];
    if (!t) return;

    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    const swipeThreshold = 55;
    const pullThreshold = 80;

    if (touchStart.atTop && dy > pullThreshold && absDx < 30) {
      triggerRefreshForTab(tab);
      return;
    }

    if (absDx > swipeThreshold && absDx > absDy) {
      const order: Array<typeof tab> = ["prices", "swap", "staking"];
      const idx = order.indexOf(tab);
      if (idx === -1) return;

      if (dx > 0 && idx < order.length - 1) {
        setTab(order[idx + 1]);
      } else if (dx < 0 && idx > 0) {
        setTab(order[idx - 1]);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultAmount() {
      if (amountTouched) return;
      if (selectedSymbol !== "tfuel") return;
      if (amount.trim() !== "") return;

      try {
        const res = await fetch(
          `/api/theta/rewards?addresses=${encodeURIComponent(trackedThetaAddresses.join(","))}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;

        const json = (await res.json()) as ThetaRewardsResponse;
        const total = (json.results ?? [])
          .map((r) => r.tfuelBalance)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
          .reduce((a, b) => a + b, 0);

        if (cancelled) return;
        if (!Number.isFinite(total) || total <= 0) return;

        setAmount(total.toFixed(0));
      } catch {
        return;
      }
    }

    void loadDefaultAmount();
    return () => {
      cancelled = true;
    };
  }, [amount, amountTouched, selectedSymbol, trackedThetaAddresses]);

  return (
    <div className="app-bg min-h-screen font-sans text-zinc-50">
      <main
        className="mx-auto flex w-full max-w-md flex-col gap-4 px-2 py-6"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/theta-fuel-tfuel-logo.png"
              alt=""
              width={36}
              height={36}
              priority
            />
            <div className="flex flex-col leading-tight">
              <h1 className="text-lg font-semibold">T-Fuel Staking Rewards</h1>
              <p className="text-xs text-zinc-400">
                Default: USDC
              </p>
            </div>
          </div>
          <a
            className="text-xs font-medium text-zinc-700 underline underline-offset-4 dark:text-zinc-300"
            href="https://simpleswap.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            SimpleSwap
          </a>
        </header>

        <nav className="app-glass grid grid-cols-3 overflow-hidden rounded-2xl p-1 text-xs font-semibold">
          <button
            type="button"
            className={
              tab === "prices"
                ? "ios-press h-10 rounded-xl bg-[#ff6a00] text-white"
                : "ios-press h-10 rounded-xl text-zinc-300 hover:bg-black/40"
            }
            onClick={() => setTab("prices")}
          >
            Prices
          </button>
          <button
            type="button"
            className={
              tab === "swap"
                ? "ios-press h-10 rounded-xl bg-[#ff6a00] text-white"
                : "ios-press h-10 rounded-xl text-zinc-300 hover:bg-black/40"
            }
            onClick={() => setTab("swap")}
          >
            Swap
          </button>
          <button
            type="button"
            className={
              tab === "staking"
                ? "ios-press h-10 rounded-xl bg-[#ff6a00] text-white"
                : "ios-press h-10 rounded-xl text-zinc-300 hover:bg-black/40"
            }
            onClick={() => setTab("staking")}
          >
            Staking
          </button>
        </nav>

        {tab === "prices" ? (
          <section className="tab-enter flex flex-col gap-3">
            <div className="app-glass rounded-2xl p-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Dashboard</h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Prices, wallet totals, and earnings.
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Last updated: {pricesLastUpdatedAt == null ? "—" : new Date(pricesLastUpdatedAt).toLocaleTimeString()}
                  </div>
                  <select
                    className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] outline-none focus:ring-2 focus:ring-zinc-400 dark:border-white/10 dark:bg-black"
                    value={pricesAutoRefreshMs}
                    onChange={(e) => setPricesAutoRefreshMs(Number(e.target.value))}
                  >
                    {refreshOptions.map((o) => (
                      <option key={o.ms} value={o.ms}>
                        Auto: {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <Dashboard prices={prices} autoRefreshMs={stakingAutoRefreshMs} refreshLabel={refreshLabel} />
          </section>
        ) : null}

        {tab === "swap" ? (
          <section className="tab-enter flex flex-col gap-3">
            <div className="app-glass rounded-2xl p-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Swap</h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Convert TFUEL/THETA to USDC and compare Solana vs Ethereum.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Auto refresh
                  </div>
                  <select
                    className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] outline-none focus:ring-2 focus:ring-zinc-400 dark:border-white/10 dark:bg-black"
                    value={swapAutoRefreshMs}
                    onChange={(e) => setSwapAutoRefreshMs(Number(e.target.value))}
                  >
                    {refreshOptions.map((o) => (
                      <option key={o.ms} value={o.ms}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="app-glass min-w-0 overflow-hidden rounded-xl p-2">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">
                  Converter{" "}
                  <span
                    className={
                      selectedSymbol === "tfuel"
                        ? "text-[#ff6a00]"
                        : "text-[#14b8a6]"
                    }
                  >
                    {selectedSymbol.toUpperCase()}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Spot vs SimpleSwap
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Value and estimated conversion.
              </p>
              <Converter
                prices={prices}
                symbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
                amount={amount}
                autoRefreshMs={swapAutoRefreshMs}
                refreshNonce={swapRefreshNonce}
                onAmountChange={(v) => {
                  setAmountTouched(true);
                  setAmount(v);
                }}
              />
            </div>

            <div className="app-glass min-w-0 overflow-hidden rounded-xl p-2">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold">
                  Network comparison{" "}
                  <span
                    className={
                      selectedSymbol === "tfuel"
                        ? "text-[#ff6a00]"
                        : "text-[#14b8a6]"
                    }
                  >
                    {selectedSymbol.toUpperCase()}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  Best route highlighted
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Solana (USDC SPL) is usually cheaper than Ethereum (USDC ERC-20).
              </p>
              <NetworkFees
                prices={prices}
                symbol={selectedSymbol}
                onSymbolChange={setSelectedSymbol}
                amount={amount}
                autoRefreshMs={swapAutoRefreshMs}
                refreshNonce={swapRefreshNonce}
                onAmountChange={(v) => {
                  setAmountTouched(true);
                  setAmount(v);
                }}
              />
            </div>
          </section>
        ) : null}

        {tab === "staking" ? (
          <section className="tab-enter flex flex-col gap-3">
            <div className="app-glass rounded-2xl p-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Staking</h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Tracks days elapsed and estimates rewards.
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Auto refresh
                  </div>
                  <select
                    className="h-8 rounded-lg border border-black/10 bg-white px-2 text-[11px] outline-none focus:ring-2 focus:ring-zinc-400 dark:border-white/10 dark:bg-black"
                    value={stakingAutoRefreshMs}
                    onChange={(e) => setStakingAutoRefreshMs(Number(e.target.value))}
                  >
                    {refreshOptions.map((o) => (
                      <option key={o.ms} value={o.ms}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <StakingTracker
              prices={prices}
              autoRefreshMs={stakingAutoRefreshMs}
              refreshLabel={refreshLabel}
              refreshNonce={stakingRefreshNonce}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function formatCompactNumber(v: number | null, decimals = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "decimal",
    maximumFractionDigits: decimals,
  }).format(v);
}

function dayKeyLocal(ms: number) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayLabel(key: string) {
  const parts = key.split("-");
  if (parts.length !== 3) return key;
  return `${parts[1]}/${parts[2]}`;
}

type TrackingState = {
  startedAt: number;
  baselines: Record<string, number | null>;
  series: Record<string, Record<string, number>>;
};

function readNumberFromLocalStorage(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeNumberToLocalStorage(key: string, value: number | null) {
  try {
    if (value == null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, String(value));
  } catch {
    return;
  }
}

function Dashboard({
  prices,
  autoRefreshMs,
  refreshLabel,
}: {
  prices: Record<string, PriceRow>;
  autoRefreshMs: number;
  refreshLabel: (ms: number) => string;
}) {
  const trackedAddresses = useMemo(
    () => [
      "0xa7c140c272fe9d9c30ec6af97c209f745375cfa4",
      "0x343a8bacd985f8ef2fc59d567edc78a097bf87e8",
    ],
    [],
  );

  const [wallets, setWallets] = useState<ThetaRewardsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stakingLastUpdatedAt, setStakingLastUpdatedAt] = useState<number | null>(
    null,
  );
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [lifetimeStartedAt, setLifetimeStartedAt] = useState<number | null>(null);
  const [lifetimeEarned, setLifetimeEarned] = useState<ThetaEarnedResponse | null>(
    null,
  );
  const [pricesExpanded, setPricesExpanded] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryStore>({
    tfuel: [],
    theta: [],
  });
  const [earningsView, setEarningsView] = useState<"total" | "today">("total");
  const [earningsChartView, setEarningsChartView] = useState<
    "combined" | "day"
  >("combined");
  const [priceChartSymbol, setPriceChartSymbol] = useState<"tfuel" | "theta">(
    "tfuel",
  );
  const [historyBackfilledAt, setHistoryBackfilledAt] = useState<number | null>(
    null,
  );

  const loadTracking = useMemo(
    () => () => {
      try {
        const raw = window.localStorage.getItem("thetaRewardsTracking.v1");
        if (!raw) {
          setTracking(null);
          return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
          setTracking(null);
          return;
        }
        const obj = parsed as Record<string, unknown>;
        if (
          typeof obj.startedAt === "number" &&
          obj.baselines &&
          typeof obj.baselines === "object" &&
          obj.series &&
          typeof obj.series === "object"
        ) {
          setTracking({
            startedAt: obj.startedAt,
            baselines: obj.baselines as Record<string, number | null>,
            series: obj.series as Record<string, Record<string, number>>,
          });
        } else {
          setTracking(null);
        }
      } catch {
        setTracking(null);
      }
    },
    [],
  );

  useEffect(() => {
    loadTracking();
  }, [loadTracking]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "thetaRewardsTracking.v1") loadTracking();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadTracking]);

  useEffect(() => {
    setLifetimeStartedAt(readNumberFromLocalStorage("tfuelLifetimeStartedAt.v1"));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function backfill() {
      // Backfill hourly points for the last 30 days so closing the tab doesn't create gaps.
      // This is a best-effort request; local sampling still runs while open.
      try {
        const [tfuelRes, thetaRes] = await Promise.all([
          fetch("/api/history?symbol=tfuel&days=30", { cache: "no-store" }),
          fetch("/api/history?symbol=theta&days=30", { cache: "no-store" }),
        ]);

        if (!tfuelRes.ok || !thetaRes.ok) return;
        const tfuelJson = (await tfuelRes.json()) as HistoryResponse;
        const thetaJson = (await thetaRes.json()) as HistoryResponse;

        const tfuelSeries = (tfuelJson.prices ?? [])
          .map((p) => ({ t: p.t, price: p.price }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
          .sort((a, b) => a.t - b.t);

        const thetaSeries = (thetaJson.prices ?? [])
          .map((p) => ({ t: p.t, price: p.price }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
          .sort((a, b) => a.t - b.t);

        if (tfuelSeries.length < 2 || thetaSeries.length < 2) return;

        if (cancelled) return;

        setPriceHistory((prev) => {
          const cap = 900;

          const mergeSeries = (a: TokenPricePoint[], b: TokenPricePoint[]) => {
            const byT = new Map<number, TokenPricePoint>();
            for (const p of a) byT.set(p.t, p);
            for (const p of b) byT.set(p.t, p);
            const next = Array.from(byT.values()).sort((x, y) => x.t - y.t);
            return next.length > cap ? next.slice(next.length - cap) : next;
          };

          return {
            tfuel: mergeSeries(prev.tfuel, tfuelSeries),
            theta: mergeSeries(prev.theta, thetaSeries),
          };
        });

        setHistoryBackfilledAt(Date.now());
      } catch {
        return;
      }
    }

    void backfill();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      // Prefer v2 (per-token). If only v1 exists, migrate.
      const rawV2 = window.localStorage.getItem("priceHistory.v2");
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as unknown;
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          const tfuel = Array.isArray(obj.tfuel) ? obj.tfuel : [];
          const theta = Array.isArray(obj.theta) ? obj.theta : [];

          function parseSeries(raw: unknown): TokenPricePoint[] {
            if (!Array.isArray(raw)) return [];
            return raw
              .map((p) => {
                if (!p || typeof p !== "object") return null;
                const o = p as Record<string, unknown>;
                const t = typeof o.t === "number" ? o.t : null;
                const price = typeof o.price === "number" ? o.price : null;
                if (
                  t == null ||
                  price == null ||
                  !Number.isFinite(t) ||
                  !Number.isFinite(price)
                ) {
                  return null;
                }
                return { t, price };
              })
              .filter((v): v is TokenPricePoint => v != null)
              .sort((a, b) => a.t - b.t);
          }

          setPriceHistory({
            tfuel: parseSeries(tfuel),
            theta: parseSeries(theta),
          });
          return;
        }
      }

      const rawV1 = window.localStorage.getItem("priceHistory.v1");
      if (!rawV1) return;
      const parsedV1 = JSON.parse(rawV1) as unknown;
      if (!Array.isArray(parsedV1)) return;

      const tfuel: TokenPricePoint[] = [];
      const theta: TokenPricePoint[] = [];

      for (const p of parsedV1) {
        if (!p || typeof p !== "object") continue;
        const obj = p as Record<string, unknown>;
        const t = typeof obj.t === "number" ? obj.t : null;
        const tfuelUsd = typeof obj.tfuelUsd === "number" ? obj.tfuelUsd : null;
        const thetaUsd = typeof obj.thetaUsd === "number" ? obj.thetaUsd : null;
        if (
          t == null ||
          tfuelUsd == null ||
          thetaUsd == null ||
          !Number.isFinite(t) ||
          !Number.isFinite(tfuelUsd) ||
          !Number.isFinite(thetaUsd)
        ) {
          continue;
        }
        tfuel.push({ t, price: tfuelUsd });
        theta.push({ t, price: thetaUsd });
      }

      tfuel.sort((a, b) => a.t - b.t);
      theta.sort((a, b) => a.t - b.t);

      setPriceHistory({ tfuel, theta });
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("priceHistory.v2", JSON.stringify(priceHistory));
    } catch {
      return;
    }
  }, [priceHistory]);

  useEffect(() => {
    const tfuelUsdRaw = prices.tfuel?.usd;
    const thetaUsdRaw = prices.theta?.usd;
    if (tfuelUsdRaw == null || thetaUsdRaw == null) return;
    if (typeof tfuelUsdRaw !== "number" || typeof thetaUsdRaw !== "number") return;
    if (!Number.isFinite(tfuelUsdRaw) || !Number.isFinite(thetaUsdRaw)) return;

    const tfuelUsd = tfuelUsdRaw;
    const thetaUsd = thetaUsdRaw;

    const minIntervalMs = 15 * 60 * 1000;
    const maxPoints = 8 * 24 * 4; // ~8 days at 15min resolution

    function pushSample(sampleTime: number) {
      setPriceHistory((prev) => {
        const lastTfuel = prev.tfuel.at(-1);
        if (lastTfuel && sampleTime - lastTfuel.t < 1000) return prev;

        const tfuelNext = [...prev.tfuel, { t: sampleTime, price: tfuelUsd }];
        const thetaNext = [...prev.theta, { t: sampleTime, price: thetaUsd }];

        return {
          tfuel:
            tfuelNext.length > maxPoints
              ? tfuelNext.slice(tfuelNext.length - maxPoints)
              : tfuelNext,
          theta:
            thetaNext.length > maxPoints
              ? thetaNext.slice(thetaNext.length - maxPoints)
              : thetaNext,
        };
      });
    }

    const now = Date.now();
    setPriceHistory((prev) => {
      // 1) If we have no samples, add immediately.
      if (prev.tfuel.length === 0 || prev.theta.length === 0) {
        return {
          tfuel: [...prev.tfuel, { t: now, price: tfuelUsd }],
          theta: [...prev.theta, { t: now, price: thetaUsd }],
        };
      }

      // 2) Normal cadence: only sample if >= 15 minutes since last.
      const last = prev.tfuel.at(-1);
      if (last && now - last.t >= minIntervalMs) {
        const tfuelNext = [...prev.tfuel, { t: now, price: tfuelUsd }];
        const thetaNext = [...prev.theta, { t: now, price: thetaUsd }];

        return {
          tfuel:
            tfuelNext.length > maxPoints
              ? tfuelNext.slice(tfuelNext.length - maxPoints)
              : tfuelNext,
          theta:
            thetaNext.length > maxPoints
              ? thetaNext.slice(thetaNext.length - maxPoints)
              : thetaNext,
        };
      }

      return prev;
    });

    // 3) If fewer than 2 samples, take a second one quickly so the chart draws.
    if (priceHistory.tfuel.length < 2 || priceHistory.theta.length < 2) {
      const id = window.setTimeout(() => pushSample(Date.now()), 5_000);
      return () => window.clearTimeout(id);
    }

    return;
  }, [
    priceHistory.tfuel.length,
    priceHistory.theta.length,
    prices.tfuel?.usd,
    prices.theta?.usd,
  ]);

  function normalizeSeries(pts: TokenPricePoint[], w: number, h: number) {
    if (pts.length < 2) return "";
    const values = pts.map((p) => p.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    return pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - ((p.price - min) / span) * h;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (lifetimeStartedAt == null) {
        setLifetimeEarned(null);
        return;
      }
      const sinceSec = Math.floor(lifetimeStartedAt / 1000);

      try {
        const res = await fetch(
          `/api/theta/earned?addresses=${encodeURIComponent(trackedAddresses.join(","))}&since=${encodeURIComponent(
            String(sinceSec),
          )}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as ThetaEarnedResponse;
        if (!cancelled) setLifetimeEarned(json);
      } catch {
        return;
      }
    }

    void load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lifetimeStartedAt, trackedAddresses]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/theta/rewards?addresses=${encodeURIComponent(trackedAddresses.join(","))}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as ThetaRewardsResponse;
        if (!cancelled) {
          setWallets(json);
          setStakingLastUpdatedAt(Date.now());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = autoRefreshMs > 0 ? window.setInterval(load, autoRefreshMs) : null;
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
    };
  }, [trackedAddresses, autoRefreshMs]);

  const tfuelPrice = prices.tfuel?.usd ?? null;
  const thetaPrice = prices.theta?.usd ?? null;

  const totals = useMemo(() => {
    const rows = wallets?.results ?? [];
    const tfuel = rows
      .map((r) => r.tfuelBalance)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    const rewards7d = rows
      .map((r) => r.rewards7d)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    const rewards30d = rows
      .map((r) => r.rewards30d)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);

    return {
      tfuel: rows.length ? tfuel : null,
      rewards7d: rows.length ? rewards7d : null,
      rewards30d: rows.length ? rewards30d : null,
    };
  }, [wallets]);

  const earnedSinceStart = useMemo(() => {
    if (!tracking || !wallets) return null;
    const sum = wallets.results
      .map((r) => {
        const base = tracking.baselines[r.address];
        if (base == null || r.tfuelBalance == null) return null;
        return Math.max(0, r.tfuelBalance - base);
      })
      .filter((v): v is number => v != null)
      .reduce((a, b) => a + b, 0);
    return sum;
  }, [tracking, wallets]);

  const lifetimeEarnedTotal = useMemo(() => {
    const rows = lifetimeEarned?.results ?? [];
    const sum = rows
      .map((r) => r.earned)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .reduce((a, b) => a + b, 0);
    return rows.length ? sum : null;
  }, [lifetimeEarned]);

  const earnedSinceStartUsd =
    earnedSinceStart == null || tfuelPrice == null ? null : earnedSinceStart * tfuelPrice;
  const lifetimeEarnedUsd =
    lifetimeEarnedTotal == null || tfuelPrice == null
      ? null
      : lifetimeEarnedTotal * tfuelPrice;

  const earnedToday = useMemo(() => {
    if (!tracking) return null;
    const todayKey = dayKeyLocal(Date.now());
    let total = 0;
    for (const series of Object.values(tracking.series)) {
      const cur = series[todayKey] ?? null;
      if (cur == null) continue;
      const keys = Object.keys(series).sort();
      const idx = keys.indexOf(todayKey);
      const prevKey = idx > 0 ? keys[idx - 1] : null;
      const prev = prevKey ? series[prevKey] ?? 0 : 0;
      total += Math.max(0, cur - prev);
    }
    return Number.isFinite(total) ? total : null;
  }, [tracking]);

  const earnedTodayUsd =
    earnedToday == null || tfuelPrice == null ? null : earnedToday * tfuelPrice;

  const earnedYesterday = useMemo(() => {
    if (!tracking) return null;
    const yesterdayKey = dayKeyLocal(Date.now() - 24 * 60 * 60 * 1000);
    let total = 0;
    for (const series of Object.values(tracking.series)) {
      const cur = series[yesterdayKey] ?? null;
      if (cur == null) continue;
      const keys = Object.keys(series).sort();
      const idx = keys.indexOf(yesterdayKey);
      const prevKey = idx > 0 ? keys[idx - 1] : null;
      const prev = prevKey ? series[prevKey] ?? 0 : 0;
      total += Math.max(0, cur - prev);
    }
    return Number.isFinite(total) ? total : null;
  }, [tracking]);

  const earnedYesterdayUsd =
    earnedYesterday == null || tfuelPrice == null
      ? null
      : earnedYesterday * tfuelPrice;

  const daysTracked = tracking ? daysBetween(tracking.startedAt, Date.now()) : null;

  const chart = useMemo(() => {
    if (!tracking) return null;
    const allDays = new Set<string>();
    for (const series of Object.values(tracking.series)) {
      for (const k of Object.keys(series)) allDays.add(k);
    }
    const keys = Array.from(allDays).sort().slice(-30);
    const values = keys.map((k) => {
      let total = 0;
      for (const series of Object.values(tracking.series)) {
        const cur = series[k] ?? 0;
        const prevKey =
          keys.indexOf(k) > 0 ? keys[keys.indexOf(k) - 1] : null;
        const prev = prevKey ? series[prevKey] ?? 0 : 0;
        total += Math.max(0, cur - prev);
      }
      return total;
    });
    const max = values.reduce((m, v) => Math.max(m, v), 0);
    return { keys, values, max };
  }, [tracking]);

  function StatRow({
    label,
    value,
    index,
  }: {
    label: string;
    value: ReactNode;
    index: number;
  }) {
    const bg =
      index % 2 === 0
        ? "bg-black/30"
        : "bg-[rgba(255,106,0,0.12)]";

    return (
      <div className={`${bg} grid grid-cols-2 gap-x-3 px-2 py-2 text-xs`}>
        <div className="text-zinc-300">{label}</div>
        <div className="text-right font-semibold text-zinc-50">{value}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="app-glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[#ff6a00]">Earnings</div>
            <span className="text-[11px] text-zinc-400">
              {loading ? "Refreshing…" : "Auto refresh: 60s"}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={
                earningsView === "total"
                  ? "ios-press h-9 rounded-xl border border-white/10 bg-black/40 text-xs font-semibold text-zinc-50"
                  : "ios-press h-9 rounded-xl border border-white/10 bg-black/20 text-xs font-semibold text-zinc-200 hover:bg-black/30"
              }
              onClick={() => setEarningsView("total")}
            >
              Total
            </button>
            <button
              type="button"
              className={
                earningsView === "today"
                  ? "ios-press h-9 rounded-xl border border-white/10 bg-black/40 text-xs font-semibold text-zinc-50"
                  : "ios-press h-9 rounded-xl border border-white/10 bg-black/20 text-xs font-semibold text-zinc-200 hover:bg-black/30"
              }
              onClick={() => setEarningsView("today")}
            >
              Today
            </button>
          </div>

          <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="text-[11px] text-zinc-400">
              {earningsView === "today" ? "Earned today" : "Earned since start"}
            </div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight text-[#ff6a00]">
              {formatMoney(
                earningsView === "today" ? earnedTodayUsd : earnedSinceStartUsd,
                "USD",
              )}
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {(() => {
                const v = earningsView === "today" ? earnedToday : earnedSinceStart;
                return v == null ? "—" : `${formatCompactNumber(v, 3)} TFUEL`;
              })()}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              {
                label: "Status",
                value: tracking ? "Running" : "Not started",
              },
              {
                label: "Days tracked",
                value: daysTracked == null ? "—" : daysTracked,
              },
              {
                label: "Earned since start",
                value:
                  earnedSinceStart == null
                    ? "—"
                    : `${formatCompactNumber(earnedSinceStart, 3)} TFUEL`,
              },
              {
                label: "Earned since start (USD)",
                value: formatMoney(earnedSinceStartUsd, "USD"),
              },
              {
                label: "Lifetime earned",
                value:
                  lifetimeEarnedTotal == null
                    ? "—"
                    : `${formatCompactNumber(lifetimeEarnedTotal, 3)} TFUEL`,
              },
              {
                label: "Lifetime earned (USD)",
                value: formatMoney(lifetimeEarnedUsd, "USD"),
              },
            ] as Array<{ label: string; value: ReactNode }>).map((m) => (
              <div
                key={m.label}
                className="rounded-xl border border-white/10 bg-black/30 p-3"
              >
                <div className="text-[11px] text-zinc-400">{m.label}</div>
                <div className="mt-1 text-sm font-semibold text-zinc-50">
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {tracking ? (
            <div className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold text-zinc-200">
                  Daily earnings
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={
                      earningsChartView === "combined"
                        ? "ios-press h-7 rounded-lg border border-white/10 bg-black/40 px-2 text-[11px] font-semibold text-zinc-50"
                        : "ios-press h-7 rounded-lg border border-white/10 bg-black/20 px-2 text-[11px] font-semibold text-zinc-300 hover:bg-black/30"
                    }
                    onClick={() => setEarningsChartView("combined")}
                  >
                    Combined
                  </button>
                  <button
                    type="button"
                    className={
                      earningsChartView === "day"
                        ? "ios-press h-7 rounded-lg border border-white/10 bg-black/40 px-2 text-[11px] font-semibold text-zinc-50"
                        : "ios-press h-7 rounded-lg border border-white/10 bg-black/20 px-2 text-[11px] font-semibold text-zinc-300 hover:bg-black/30"
                    }
                    onClick={() => setEarningsChartView("day")}
                  >
                    1 Day
                  </button>
                </div>
              </div>

              {earningsChartView === "day" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="text-[11px] text-zinc-400">Today</div>
                    <div className="mt-1 text-sm font-semibold text-[#ff6a00]">
                      {formatMoney(earnedTodayUsd, "USD")}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      {earnedToday == null
                        ? "—"
                        : `${formatCompactNumber(earnedToday, 4)} TFUEL`}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="text-[11px] text-zinc-400">Yesterday</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {formatMoney(earnedYesterdayUsd, "USD")}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      {earnedYesterday == null
                        ? "—"
                        : `${formatCompactNumber(earnedYesterday, 4)} TFUEL`}
                    </div>
                  </div>

                  {(() => {
                    const today = earnedToday ?? 0;
                    const yesterday = earnedYesterday ?? 0;
                    const max = Math.max(1e-9, today, yesterday);
                    const ht = Math.max(6, Math.round((today / max) * 52));
                    const hy = Math.max(6, Math.round((yesterday / max) * 52));
                    return (
                      <div className="col-span-2 rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="flex items-end justify-between gap-6">
                          <div className="flex w-full items-end gap-4">
                            <div className="flex flex-1 flex-col items-center gap-2">
                              <div
                                className="w-full rounded-md bg-[#ff6a00]"
                                style={{ height: `${ht}px` }}
                              />
                              <div className="text-[11px] text-zinc-400">Today</div>
                            </div>
                            <div className="flex flex-1 flex-col items-center gap-2">
                              <div
                                className="w-full rounded-md bg-white/40"
                                style={{ height: `${hy}px` }}
                              />
                              <div className="text-[11px] text-zinc-400">Yesterday</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : chart ? (
                <div className="mt-3">
                  <div className="text-[11px] text-zinc-400">
                    Combined (last {chart.keys.length}d)
                  </div>
                  <div className="mt-2 flex h-16 items-end gap-1 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
                    {chart.keys.map((k, idx) => {
                      const v = chart.values[idx] ?? 0;
                      const h =
                        chart.max > 0
                          ? Math.max(2, Math.round((v / chart.max) * 56))
                          : 2;
                      return (
                        <div
                          key={k}
                          className="flex w-2 flex-col items-center"
                          title={`${formatDayLabel(k)}: ${formatCompactNumber(v, 4)} TFUEL`}
                        >
                          <div
                            className="w-2 rounded-sm bg-[#ff6a00]"
                            style={{ height: `${h}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-zinc-400">
                  Collecting daily series…
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-400">
              Start tracking in the Staking tab to see the chart.
            </div>
          )}
      </div>

      <div className="app-glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[#ff6a00]">Wallet totals</div>
            <div className="text-[11px] text-zinc-400">Live balances</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-[11px] text-zinc-400">TFUEL total</div>
              <div className="mt-1 text-lg font-semibold text-[#ff6a00]">
                {formatCompactNumber(totals.tfuel, 3)}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {totals.tfuel == null || tfuelPrice == null
                  ? "—"
                  : formatMoney(totals.tfuel * tfuelPrice, "USD")}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-[11px] text-zinc-400">TFUEL total (USD)</div>
              <div className="mt-1 text-lg font-semibold text-[#ff6a00]">
                {totals.tfuel == null || tfuelPrice == null
                  ? "—"
                  : formatMoney(totals.tfuel * tfuelPrice, "USD")}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {formatCompactNumber(totals.tfuel, 3)} TFUEL
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-[11px] text-zinc-400">Rewards (7d)</div>
              <div className="mt-1 text-lg font-semibold text-zinc-50">
                {formatCompactNumber(totals.rewards7d, 3)}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {totals.rewards7d == null || tfuelPrice == null
                  ? "—"
                  : formatMoney(totals.rewards7d * tfuelPrice, "USD")}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-[11px] text-zinc-400">Rewards (30d)</div>
              <div className="mt-1 text-lg font-semibold text-zinc-50">
                {formatCompactNumber(totals.rewards30d, 3)}
              </div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {totals.rewards30d == null || tfuelPrice == null
                  ? "—"
                  : formatMoney(totals.rewards30d * tfuelPrice, "USD")}
              </div>
            </div>
          </div>
      </div>

      <div className="app-glass rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[#ff6a00]">Prices</span>
            <span className="text-[11px] text-zinc-400">Tap a token</span>
          </div>
          <div className="mt-3 grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={
                  priceChartSymbol === "tfuel"
                    ? "ios-press app-glass rounded-xl p-3 text-left ring-1 ring-[rgba(255,106,0,0.35)]"
                    : "ios-press app-glass rounded-xl p-3 text-left"
                }
                onClick={() => {
                  setPriceChartSymbol("tfuel");
                  setPricesExpanded(false);
                }}
              >
                <div className="text-xs font-semibold text-[#ff6a00]">TFUEL</div>
                <div className="mt-1 text-lg font-semibold text-[#ff6a00]">
                  {formatMoney(prices.tfuel?.usdc ?? null, "USDC")}
                </div>
                <div className="text-xs text-zinc-400">
                  {formatMoney(prices.tfuel?.usd ?? null, "USD")}
                </div>
              </button>

              <button
                type="button"
                className={
                  priceChartSymbol === "theta"
                    ? "ios-press app-glass rounded-xl p-3 text-left ring-1 ring-[rgba(20,184,166,0.35)]"
                    : "ios-press app-glass rounded-xl p-3 text-left"
                }
                onClick={() => {
                  setPriceChartSymbol("theta");
                  setPricesExpanded(false);
                }}
              >
                <div className="text-xs font-semibold text-[#14b8a6]">THETA</div>
                <div className="mt-1 text-lg font-semibold text-[#14b8a6]">
                  {formatMoney(prices.theta?.usdc ?? null, "USDC")}
                </div>
                <div className="text-xs text-zinc-400">
                  {formatMoney(prices.theta?.usd ?? null, "USD")}
                </div>
              </button>
            </div>
          </div>

          {(() => {
            const series =
              priceChartSymbol === "tfuel" ? priceHistory.tfuel : priceHistory.theta;
            if (series.length < 2) return null;
            const start = series[0];
            const end = series[series.length - 1];
            const delta = end.price - start.price;
            const pct = start.price === 0 ? null : (delta / start.price) * 100;
            const color = priceChartSymbol === "tfuel" ? "#ff6a00" : "#14b8a6";
            const symbolLabel = priceChartSymbol === "tfuel" ? "TFUEL" : "THETA";
            const samples = series.length;

            const startLabel = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: start.price < 1 ? 6 : 2,
            }).format(start.price);
            const endLabel = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: end.price < 1 ? 6 : 2,
            }).format(end.price);
            const deltaLabel = new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: Math.abs(delta) < 1 ? 6 : 2,
            }).format(delta);

            return (
              <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color }}>
                    {symbolLabel} (30d)
                  </div>
                  <button
                    type="button"
                    className="ios-press text-[11px] font-semibold text-zinc-300 hover:text-zinc-50"
                    onClick={() => setPricesExpanded((v) => !v)}
                  >
                    {pricesExpanded ? "Hide chart" : `Show chart (${samples} samples)`}
                  </button>
                </div>

                <div
                  className="ios-press mt-2"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPricesExpanded((v) => !v)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPricesExpanded((v) => !v);
                    }
                  }}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] text-zinc-400">Start</div>
                      <div className="mt-1 text-sm font-semibold" style={{ color }}>
                        {startLabel}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="text-[11px] text-zinc-400">Now</div>
                      <div className="mt-1 text-sm font-semibold" style={{ color }}>
                        {endLabel}
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        {deltaLabel}
                        {pct == null
                          ? ""
                          : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {pricesExpanded ? (
            <div className="mt-3">
              {historyBackfilledAt != null ? (
                <div className="mt-1 text-[11px] text-zinc-500">
                  Backfilled
                </div>
              ) : null}

              <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-3">
                <svg viewBox="0 0 300 90" className="h-[90px] w-full">
                  <polyline
                    fill="none"
                    stroke={priceChartSymbol === "tfuel" ? "#ff6a00" : "#14b8a6"}
                    strokeWidth="2"
                    points={normalizeSeries(
                      priceChartSymbol === "tfuel"
                        ? priceHistory.tfuel
                        : priceHistory.theta,
                      300,
                      90,
                    )}
                    opacity="0.95"
                  />
                </svg>
              </div>
            </div>
          ) : null}
      </div>
    </div>
  );
}

function ThetaExplorerRewards({ prices }: { prices: Record<string, PriceRow> }) {
  const defaultAddresses = useMemo(
    () => [
      "0xa7c140c272fe9d9c30ec6af97c209f745375cfa4",
      "0x343a8bacd985f8ef2fc59d567edc78a097bf87e8",
    ],
    [],
  );

  const [data, setData] = useState<ThetaRewardsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/theta/rewards?addresses=${encodeURIComponent(defaultAddresses.join(","))}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ThetaRewardsResponse;
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [defaultAddresses]);

  const tfuelUsd = prices.tfuel?.usd ?? null;
  const thetaUsd = prices.theta?.usd ?? null;

  return (
    <div className="rounded-xl border border-black/10 bg-zinc-50 p-3 text-sm dark:border-white/10 dark:bg-black">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[#14b8a6]">
            Theta Explorer (TFUEL rewards)
          </span>
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
            {loading ? "Refreshing…" : "Auto refresh: 60s"}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {(data?.results ?? []).map((r) => (
          <div
            key={r.address}
            className="rounded-xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-950"
          >
            {(() => {
              const avg7d = r.rewards7d == null ? null : r.rewards7d / 7;
              const avg30d = r.rewards30d == null ? null : r.rewards30d / 30;
              const projMonth = avg30d == null ? null : avg30d * 30;
              const projYear = avg30d == null ? null : avg30d * 365;

              const projYearUsd =
                projYear == null || tfuelUsd == null ? null : projYear * tfuelUsd;
              const stakedUsd =
                r.stakedTheta == null || thetaUsd == null
                  ? null
                  : r.stakedTheta * thetaUsd;

              const aprUsd =
                projYearUsd == null || stakedUsd == null || stakedUsd <= 0
                  ? null
                  : (projYearUsd / stakedUsd) * 100;

              return (
                <>
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400 break-all">
              {r.address}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="text-[#14b8a6]">Staked THETA</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(r.stakedTheta, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">TFUEL balance</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(r.tfuelBalance, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Rewards (7d)</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(r.rewards7d, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Rewards (30d)</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(r.rewards30d, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Avg/day (7d)</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(avg7d, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Avg/day (30d)</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(avg30d, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Projected /mo</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(projMonth, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Projected /yr</div>
              <div className="text-right font-semibold">
                {formatCompactNumber(projYear, 3)}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Rewards (30d USD)</div>
              <div className="text-right text-zinc-700 dark:text-zinc-300">
                {r.rewards30d == null || tfuelUsd == null
                  ? "—"
                  : formatMoney(r.rewards30d * tfuelUsd, "USD")}
              </div>

              <div className="text-zinc-600 dark:text-zinc-400">Implied APR (USD)</div>
              <div className="text-right text-zinc-700 dark:text-zinc-300">
                {aprUsd == null ? "—" : `${aprUsd.toFixed(2)}%`}
              </div>
            </div>
                </>
              );
            })()}
          </div>
        ))}

        {data == null ? (
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
            Loading wallet rewards…
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TokenRow({
  symbol,
  label,
  price,
}: {
  symbol: string;
  label: string;
  price?: PriceRow;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <div>
          <div
            className={
              label === "TFUEL"
                ? "text-xs font-semibold text-[#ff6a00]"
                : label === "THETA"
                  ? "text-xs font-semibold text-[#14b8a6]"
                  : "text-xs font-semibold"
            }
          >
            {label}
          </div>
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
            {price?.source ?? "—"}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm font-semibold">
            {formatMoney(price?.usdc ?? null, "USDC")}
          </span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            {formatMoney(price?.usd ?? null, "USD")}
          </span>
        </div>
      </div>
    </div>
  );
}

function Converter({
  prices,
  symbol,
  onSymbolChange,
  amount,
  autoRefreshMs,
  refreshNonce,
  onAmountChange,
}: {
  prices: Record<string, PriceRow>;
  symbol: string;
  onSymbolChange: (v: string) => void;
  amount: string;
  autoRefreshMs: number;
  refreshNonce?: number;
  onAmountChange: (v: string) => void;
}) {
  const [network, setNetwork] = useState<"sol" | "eth">("sol");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteLastUpdatedAt, setQuoteLastUpdatedAt] = useState<number | null>(
    null,
  );

  const parsedAmount = useMemo(() => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v < 0) return null;
    return v;
  }, [amount]);

  const row = prices[symbol];
  const usdcValue =
    parsedAmount == null || row?.usdc == null ? null : parsedAmount * row.usdc;
  const usdValue =
    parsedAmount == null || row?.usd == null ? null : parsedAmount * row.usd;

  const simpleSwapUrl = useMemo(() => {
    const from = symbol.trim().toLowerCase();
    const to = network === "sol" ? "usdcspl" : "usdc";
    const pair = `${from}-${to}`;
    const url = new URL(`https://simpleswap.io/crypto-to-crypto/${pair}`);
    if (parsedAmount != null && parsedAmount > 0) {
      // If SimpleSwap supports prefilling, this should populate the "You send" amount.
      // If not supported, it will be ignored safely.
      url.searchParams.set("amount", String(parsedAmount));
    }
    return url.toString();
  }, [symbol, network, parsedAmount]);

  const networkTintBgClass =
    network === "sol"
      ? "bg-gradient-to-br from-[#7c3aed]/25 via-black/40 to-black/70"
      : "bg-gradient-to-br from-[#38bdf8]/25 via-black/40 to-black/70";
  const networkRingClass =
    network === "sol" ? "ring-[#7c3aed]/30" : "ring-[#38bdf8]/30";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (parsedAmount == null || parsedAmount <= 0) {
        setQuote(null);
        return;
      }

      setQuoteLoading(true);
      try {
        const res = await fetch(
          `/api/quote?symbol=${encodeURIComponent(symbol)}&amount=${encodeURIComponent(String(parsedAmount))}&network=${encodeURIComponent(network)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as QuoteResponse;
        if (!cancelled) {
          setQuote(json);
          setQuoteLastUpdatedAt(Date.now());
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }

    void load();
    const id =
      autoRefreshMs > 0
        ? window.setInterval(load, autoRefreshMs)
        : null;
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
    };
  }, [symbol, parsedAmount, network, autoRefreshMs, refreshNonce]);

  return (
    <div className="mt-3 flex w-full flex-col gap-3">
      <div className="w-full min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-zinc-200">You send</div>
          <div className="text-[11px] text-zinc-400">
            {row?.source ?? "—"}
          </div>
        </div>

        <div className="mt-2 flex w-full gap-2">
          <input
            className="h-14 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 text-xl font-semibold text-zinc-50 outline-none focus:ring-2 focus:ring-zinc-400"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
          />
          <select
            className={
              symbol === "tfuel"
                ? "h-14 w-28 shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-[#ff6a00] outline-none focus:ring-2 focus:ring-[#ff6a00]"
                : "h-14 w-28 shrink-0 rounded-xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-[#14b8a6] outline-none focus:ring-2 focus:ring-[#14b8a6]"
            }
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
          >
            <option value="tfuel">TFUEL</option>
            <option value="theta">THETA</option>
          </select>
        </div>

        <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 truncate text-[11px] text-zinc-400">
            Spot: {formatMoney(usdcValue, "USDC")} ({formatMoney(usdValue, "USD")})
          </div>
        </div>

        <div className="mt-3 grid w-full grid-cols-2 gap-2">
          <button
            type="button"
            className={
              network === "sol"
                ? "ios-press h-10 rounded-xl border border-white/10 bg-[#7c3aed]/20 text-xs font-semibold text-zinc-50"
                : "ios-press h-10 rounded-xl border border-white/10 bg-black/20 text-xs font-semibold text-zinc-200 hover:bg-black/30"
            }
            onClick={() => setNetwork("sol")}
          >
            Solana
          </button>
          <button
            type="button"
            className={
              network === "eth"
                ? "ios-press h-10 rounded-xl border border-white/10 bg-[#38bdf8]/20 text-xs font-semibold text-zinc-50"
                : "ios-press h-10 rounded-xl border border-white/10 bg-black/20 text-xs font-semibold text-zinc-200 hover:bg-black/30"
            }
            onClick={() => setNetwork("eth")}
          >
            Ethereum
          </button>
        </div>
      </div>

      <div
        className={`w-full min-w-0 overflow-hidden rounded-xl border border-white/10 p-3 text-sm ${networkTintBgClass} ring-1 ring-inset ${networkRingClass}`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">SimpleSwap quote</span>
          <span className="text-[11px] font-semibold text-zinc-100">
            {quoteLoading ? "Quoting…" : "Live"}
          </span>
        </div>

        <div className="mt-1 text-[11px] text-zinc-400">
          Last updated: {quoteLastUpdatedAt == null ? "—" : new Date(quoteLastUpdatedAt).toLocaleTimeString()}
        </div>

        <div className="mt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col">
              <div className="text-[11px] text-zinc-400">Estimated received</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-50">
                {quote?.estimatedUsdc == null
                  ? "—"
                  : new Intl.NumberFormat(undefined, {
                      style: "decimal",
                      maximumFractionDigits: quote.estimatedUsdc < 1 ? 6 : 2,
                    }).format(quote.estimatedUsdc)}
                <span className="ml-2 text-[11px] font-semibold text-zinc-300">USDC</span>
              </div>
            </div>

            <div className="flex flex-col items-end text-right">
              <div className="text-[11px] text-zinc-400">Fee vs spot</div>
              <div className="mt-1 text-sm font-semibold text-zinc-50">
                {quote?.impliedFeeUsd == null
                  ? "—"
                  : `${formatMoney(quote.impliedFeeUsd, "USD")}`}
              </div>
              <div className="text-[11px] text-zinc-300">
                {quote?.impliedFeePct == null ? "" : `${quote.impliedFeePct.toFixed(2)}%`}
              </div>
            </div>
          </div>

          <div className="mt-3 h-px w-full bg-white/10" />

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <div className="text-[11px] text-zinc-400">Spot total</div>
              <div className="mt-1 text-sm font-semibold text-zinc-50">
                {formatMoney(quote?.spotTotalUsd ?? null, "USD")}
              </div>
            </div>
            <div className="flex flex-col">
              <div className="text-[11px] text-zinc-400">Effective price</div>
              <div
                className={
                  symbol === "tfuel"
                    ? "mt-1 text-sm font-semibold text-[#ff6a00]"
                    : "mt-1 text-sm font-semibold text-[#14b8a6]"
                }
              >
                {quote?.effectiveUsdPerToken == null
                  ? "—"
                  : `${formatMoney(quote.effectiveUsdPerToken, "USD")}/${symbol.toUpperCase()}`}
              </div>
            </div>
          </div>

          {quote?.minAmount != null ? (
            <div className="mt-2 text-[11px] text-zinc-300">Minimum: {quote.minAmount}</div>
          ) : null}
        </div>

        <a
          className="ios-press mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-black/40 text-sm font-semibold text-zinc-50 hover:bg-black/50"
          href={simpleSwapUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in SimpleSwap
        </a>
      </div>

      {row?.error ? (
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{row.error}</p>
      ) : null}

      {quote?.error ? (
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
          {quote.error}
        </p>
      ) : null}
    </div>
  );
}

function labelNetwork(n: "usdc-sol" | "usdc-eth") {
  return n === "usdc-sol" ? "USDC (Solana)" : "USDC (Ethereum)";
}

function daysBetween(startMs: number, endMs: number) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((endMs - startMs) / msPerDay));
}

function StakingTracker({
  prices,
  autoRefreshMs,
  refreshLabel,
  refreshNonce,
}: {
  prices: Record<string, PriceRow>;
  autoRefreshMs: number;
  refreshLabel: (ms: number) => string;
  refreshNonce?: number;
}) {
  const defaultAddresses = useMemo(
    () => [
      "0xa7c140c272fe9d9c30ec6af97c209f745375cfa4",
      "0x343a8bacd985f8ef2fc59d567edc78a097bf87e8",
    ],
    [],
  );

  const [data, setData] = useState<ThetaRewardsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stakingLastUpdatedAt, setStakingLastUpdatedAt] = useState<number | null>(
    null,
  );
  const [tracking, setTracking] = useState<{
    startedAt: number;
    baselines: Record<string, number | null>;
    series: Record<string, Record<string, number>>;
  } | null>(null);
  const [lifetimeStartedAt, setLifetimeStartedAt] = useState<number | null>(null);
  const [lifetimeEarned, setLifetimeEarned] = useState<ThetaEarnedResponse | null>(
    null,
  );

  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertThresholdUsd, setAlertThresholdUsd] = useState<string>("200");
  const [alertUseBrowserNotifications, setAlertUseBrowserNotifications] =
    useState(false);
  const [alertArmed, setAlertArmed] = useState(true);
  const [alertBanner, setAlertBanner] = useState<string | null>(null);

  const tfuelUsd = prices.tfuel?.usd ?? null;
  const thetaUsd = prices.theta?.usd ?? null;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("stakingUsdAlert.v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const obj = parsed as Record<string, unknown>;

      if (typeof obj.enabled === "boolean") setAlertEnabled(obj.enabled);
      if (
        typeof obj.thresholdUsd === "number" &&
        Number.isFinite(obj.thresholdUsd)
      ) {
        setAlertThresholdUsd(String(obj.thresholdUsd));
      }
      if (typeof obj.useBrowserNotifications === "boolean") {
        setAlertUseBrowserNotifications(obj.useBrowserNotifications);
      }
      if (typeof obj.armed === "boolean") setAlertArmed(obj.armed);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      const threshold = Number(alertThresholdUsd);
      window.localStorage.setItem(
        "stakingUsdAlert.v1",
        JSON.stringify({
          enabled: alertEnabled,
          thresholdUsd: Number.isFinite(threshold) ? threshold : null,
          useBrowserNotifications: alertUseBrowserNotifications,
          armed: alertArmed,
        }),
      );
    } catch {
      return;
    }
  }, [alertEnabled, alertThresholdUsd, alertUseBrowserNotifications, alertArmed]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("thetaRewardsTracking.v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const obj = parsed as Record<string, unknown>;
      if (
        typeof obj.startedAt === "number" &&
        obj.baselines &&
        typeof obj.baselines === "object" &&
        obj.series &&
        typeof obj.series === "object"
      ) {
        setTracking({
          startedAt: obj.startedAt,
          baselines: obj.baselines as Record<string, number | null>,
          series: obj.series as Record<string, Record<string, number>>,
        });
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    try {
      if (tracking == null) {
        window.localStorage.removeItem("thetaRewardsTracking.v1");
        return;
      }
      window.localStorage.setItem(
        "thetaRewardsTracking.v1",
        JSON.stringify(tracking),
      );
    } catch {
      return;
    }
  }, [tracking]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/theta/rewards?addresses=${encodeURIComponent(defaultAddresses.join(","))}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as ThetaRewardsResponse;
        if (cancelled) return;
        setData(json);
        setStakingLastUpdatedAt(Date.now());

        const k = dayKeyLocal(Date.now());
        setTracking((prev) => {
          if (prev == null) return prev;
          const nextSeries: Record<string, Record<string, number>> = {
            ...prev.series,
          };

          for (const r of json.results) {
            const base = prev.baselines[r.address];
            if (base == null || r.tfuelBalance == null) continue;
            const earned = Math.max(0, r.tfuelBalance - base);
            const walletSeries = { ...(nextSeries[r.address] ?? {}) };
            walletSeries[k] = earned;
            nextSeries[r.address] = walletSeries;
          }

          return { ...prev, series: nextSeries };
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id =
      autoRefreshMs > 0
        ? window.setInterval(load, autoRefreshMs)
        : null;
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
    };
  }, [defaultAddresses, autoRefreshMs, refreshNonce]);

  const startedAt = tracking?.startedAt ?? null;
  const days = startedAt == null ? 0 : daysBetween(startedAt, Date.now());

  function dailyDeltas(address: string): Array<{ day: string; delta: number }>
    | null {
    const s = tracking?.series?.[address];
    if (!s) return null;
    const keys = Object.keys(s).sort();
    const deltas: Array<{ day: string; delta: number }> = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const prev = i === 0 ? 0 : s[keys[i - 1]] ?? 0;
      const cur = s[k] ?? 0;
      deltas.push({ day: k, delta: Math.max(0, cur - prev) });
    }
    return deltas.slice(-30);
  }

  const totalEarnedAll = (data?.results ?? [])
    .map((r) => {
      if (!tracking || r.tfuelBalance == null) return null;
      const base = tracking.baselines[r.address];
      if (base == null) return null;
      return Math.max(0, r.tfuelBalance - base);
    })
    .filter((v): v is number => v != null)
    .reduce((a, b) => a + b, 0);

  const totalEarnedUsd =
    tfuelUsd == null ? null : totalEarnedAll * tfuelUsd;

  const alertThresholdUsdNum = useMemo(() => {
    const v = Number(alertThresholdUsd);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }, [alertThresholdUsd]);

  useEffect(() => {
    if (!alertEnabled) return;
    if (!alertArmed) {
      if (
        alertThresholdUsdNum != null &&
        totalEarnedUsd != null &&
        totalEarnedUsd < alertThresholdUsdNum
      ) {
        setAlertArmed(true);
      }
      return;
    }

    if (alertThresholdUsdNum == null || totalEarnedUsd == null) return;
    if (totalEarnedUsd < alertThresholdUsdNum) return;
    if (tracking == null) return;

    const msg = `Staking rewards reached ${formatMoney(totalEarnedUsd, "USD")} (target ${formatMoney(alertThresholdUsdNum, "USD")}).`;
    setAlertBanner(msg);
    setAlertArmed(false);

    if (!alertUseBrowserNotifications) return;
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;

    try {
      if (Notification.permission === "granted") {
        new Notification("T-Fuel Staking Rewards", {
          body: msg,
        });
      }
    } catch {
      return;
    }
  }, [
    alertEnabled,
    alertArmed,
    alertThresholdUsdNum,
    alertUseBrowserNotifications,
    totalEarnedUsd,
    tracking,
  ]);

  const lifetimeEarnedTotal = (lifetimeEarned?.results ?? [])
    .map((r) => r.earned)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .reduce((a, b) => a + b, 0);

  const shortAddress = (addr: string) =>
    addr.length <= 14 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div className="flex flex-col gap-3">
      {alertBanner ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-zinc-50">{alertBanner}</div>
            <button
              type="button"
              className="ios-press h-7 shrink-0 rounded-full border border-white/10 bg-black/40 px-3 text-[11px] font-semibold text-zinc-50 hover:bg-black/50"
              onClick={() => setAlertBanner(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-[rgba(255,106,0,0.18)] via-black/30 to-black/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-200">Tracking summary</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              Last updated: {stakingLastUpdatedAt == null ? "—" : new Date(stakingLastUpdatedAt).toLocaleTimeString()}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400">
              {loading ? "Refreshing…" : `Auto refresh: ${refreshLabel(autoRefreshMs)}`}
            </div>
          </div>
          <div className="text-[11px] text-zinc-400">
            {tracking ? "Running" : "Not started"}
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            className={
              tracking == null
                ? "ios-press h-11 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white dark:bg-white dark:text-black"
                : "ios-press h-11 w-full rounded-xl border border-white/10 bg-black/30 text-sm font-semibold text-zinc-50 hover:bg-black/40"
            }
            onClick={() => {
              if (tracking != null) {
                setTracking(null);
                return;
              }

              if (!data) return;

              const existingLifetime = readNumberFromLocalStorage(
                "tfuelLifetimeStartedAt.v1",
              );
              if (existingLifetime == null) {
                const now = Date.now();
                writeNumberToLocalStorage("tfuelLifetimeStartedAt.v1", now);
                setLifetimeStartedAt(now);
              }

              const baselines: Record<string, number | null> = {};
              for (const r of data.results) baselines[r.address] = r.tfuelBalance;

              const k = dayKeyLocal(Date.now());
              const series: Record<string, Record<string, number>> = {};
              for (const r of data.results) {
                series[r.address] = { [k]: 0 };
              }

              setTracking({
                startedAt: Date.now(),
                baselines,
                series,
              });
            }}
            disabled={tracking == null && data == null}
          >
            {tracking == null ? "Start tracking" : "Stop tracking"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="text-[11px] text-zinc-400">Days</div>
            <div className="mt-1 text-lg font-semibold text-zinc-50">{days}</div>
          </div>
          <div className="rounded-xl border border-[rgba(255,106,0,0.35)] bg-[rgba(255,106,0,0.10)] p-3">
            <div className="text-[11px] text-zinc-400">Earned (USD)</div>
            <div className="mt-1 text-lg font-semibold text-[#ff6a00]">
              {tracking == null ? "—" : formatMoney(totalEarnedUsd, "USD")}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="text-[11px] text-zinc-400">Earned (TFUEL)</div>
            <div className="mt-1 text-sm font-semibold text-zinc-50">
              {tracking == null
                ? "—"
                : `${formatCompactNumber(totalEarnedAll, 3)} TFUEL`}
            </div>
          </div>
          <div className="rounded-xl border border-[rgba(20,184,166,0.25)] bg-[rgba(20,184,166,0.08)] p-3">
            <div className="text-[11px] text-zinc-400">Lifetime earned</div>
            <div className="mt-1 text-sm font-semibold text-zinc-50">
              {lifetimeEarnedTotal == null
                ? "—"
                : `${formatCompactNumber(lifetimeEarnedTotal, 3)} TFUEL`}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-[rgba(20,184,166,0.16)] via-black/30 to-black/70 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-[#14b8a6]">Alerts</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              Notify when Earned (USD) reaches a threshold.
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="text-xs text-zinc-400">Enable alert</div>
            <button
              type="button"
              className={
                alertEnabled
                  ? "ios-press h-9 rounded-xl border border-white/10 bg-black/40 px-4 text-xs font-semibold text-zinc-50"
                  : "ios-press h-9 rounded-xl border border-white/10 bg-black/20 px-4 text-xs font-semibold text-zinc-200 hover:bg-black/30"
              }
              onClick={() => setAlertEnabled((v) => !v)}
            >
              {alertEnabled ? "On" : "Off"}
            </button>
          </div>

          <div className="grid grid-cols-[1fr_120px] items-center gap-3">
            <div className="text-xs text-zinc-400">
              Threshold (USD)
            </div>
            <input
              className="h-9 rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-zinc-50 outline-none focus:ring-2 focus:ring-zinc-400"
              inputMode="decimal"
              value={alertThresholdUsd}
              onChange={(e) => setAlertThresholdUsd(e.target.value)}
              placeholder="200"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="text-xs text-zinc-400">
              Browser notification
            </div>
            <button
              type="button"
              className={
                alertUseBrowserNotifications
                  ? "ios-press h-9 rounded-xl border border-white/10 bg-black/40 px-4 text-xs font-semibold text-zinc-50"
                  : "ios-press h-9 rounded-xl border border-white/10 bg-black/20 px-4 text-xs font-semibold text-zinc-200 hover:bg-black/30"
              }
              onClick={() => setAlertUseBrowserNotifications((v) => !v)}
            >
              {alertUseBrowserNotifications ? "On" : "Off"}
            </button>
          </div>

          <button
            type="button"
            className="ios-press h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs font-semibold text-zinc-50 hover:bg-black/40"
            onClick={async () => {
              if (typeof Notification === "undefined") {
                setAlertBanner(
                  "Notifications aren’t supported in this browser. Use the in-app banner instead.",
                );
                return;
              }
              try {
                const r = await Notification.requestPermission();
                if (r !== "granted") {
                  setAlertBanner(
                    "Notification permission not granted. You can still use the in-app banner.",
                  );
                } else {
                  setAlertBanner("Notifications enabled.");
                }
              } catch {
                setAlertBanner(
                  "Failed to request notification permission. You can still use the in-app banner.",
                );
              }
            }}
          >
            Enable notifications
          </button>

          <div className="text-[11px] text-zinc-400">
            This will notify on this device (phone if you’re using the app on your
            phone). For true push notifications when the app is closed, we’d need
            PWA + a backend.
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold">Wallets</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              {data == null ? "Loading wallet rewards…" : `${data.results.length} wallets`}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          {(data?.results ?? []).map((r) => {
            const base = tracking?.baselines?.[r.address] ?? null;
            const earned =
              tracking == null || base == null || r.tfuelBalance == null
                ? null
                : Math.max(0, r.tfuelBalance - base);
            const earnedUsd =
              earned == null || tfuelUsd == null ? null : earned * tfuelUsd;

            const deltas = tracking == null ? null : dailyDeltas(r.address);
            const maxDelta = deltas
              ? deltas.reduce((m, d) => Math.max(m, d.delta), 0)
              : 0;

            const avgPerDay =
              deltas == null || deltas.length === 0
                ? null
                : deltas.reduce((a, d) => a + d.delta, 0) / deltas.length;

            const projMonth = avgPerDay == null ? null : avgPerDay * 30;
            const projYear = avgPerDay == null ? null : avgPerDay * 365;
            const projYearUsd =
              projYear == null || tfuelUsd == null ? null : projYear * tfuelUsd;
            const stakedUsd =
              r.stakedTheta == null || thetaUsd == null
                ? null
                : r.stakedTheta * thetaUsd;
            const aprUsd =
              projYearUsd == null || stakedUsd == null || stakedUsd <= 0
                ? null
                : (projYearUsd / stakedUsd) * 100;

            return (
              <div
                key={r.address}
                className="rounded-xl border border-[rgba(255,106,0,0.18)] bg-black/30 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-50">
                      {shortAddress(r.address)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-400">
                      Earned (USD): {earnedUsd == null ? "—" : formatMoney(earnedUsd, "USD")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-zinc-400">Implied APR (USD)</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {aprUsd == null ? "—" : `${aprUsd.toFixed(2)}%`}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">Staked THETA</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {formatCompactNumber(r.stakedTheta, 3)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">TFUEL balance</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {formatCompactNumber(r.tfuelBalance, 3)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">Baseline</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {tracking == null ? "—" : formatCompactNumber(base, 3)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-[11px] text-zinc-400">Avg/day</div>
                    <div className="mt-1 text-sm font-semibold text-zinc-50">
                      {formatCompactNumber(avgPerDay, 3)}
                    </div>
                  </div>
                </div>

                {tracking != null && deltas != null && deltas.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-[11px] text-zinc-400">
                      Daily earnings (last {deltas.length}d)
                    </div>
                    <div className="mt-2 flex h-14 items-end gap-1 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2">
                      {deltas.map((d) => {
                        const h =
                          maxDelta > 0
                            ? Math.max(2, Math.round((d.delta / maxDelta) * 48))
                            : 2;
                        return (
                          <div
                            key={d.day}
                            className="flex w-2 flex-col items-center"
                            title={`${formatDayLabel(d.day)}: ${formatCompactNumber(d.delta, 4)} TFUEL`}
                          >
                            <div
                              className="w-2 rounded-sm bg-white/40"
                              style={{ height: `${h}px` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NetworkFees({
  prices,
  symbol,
  onSymbolChange,
  amount,
  autoRefreshMs,
  refreshNonce,
  onAmountChange,
}: {
  prices: Record<string, PriceRow>;
  symbol: string;
  onSymbolChange: (v: string) => void;
  amount: string;
  autoRefreshMs: number;
  refreshNonce?: number;
  onAmountChange: (v: string) => void;
}) {
  const [data, setData] = useState<FeesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0);
  const [feesLastUpdatedAt, setFeesLastUpdatedAt] = useState<number | null>(
    null,
  );

  const amountNum = useMemo(() => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) return null;
    return v;
  }, [amount]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (amountNum == null) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/fees?symbol=${encodeURIComponent(symbol)}&amount=${encodeURIComponent(String(amountNum))}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as FeesResponse;
        if (!cancelled) {
          setData(json);
          setFeesLastUpdatedAt(Date.now());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const id =
      autoRefreshMs > 0
        ? window.setInterval(load, autoRefreshMs)
        : null;
    return () => {
      cancelled = true;
      if (id != null) window.clearInterval(id);
    };
  }, [symbol, amountNum, autoRefreshMs, refreshNonce, localRefreshNonce]);

  const spotRow = prices[symbol];
  const spotUsdc = spotRow?.usdc ?? data?.spotUsdc ?? null;
  const spotValue =
    spotUsdc == null || amountNum == null ? null : spotUsdc * amountNum;

  const bestEstimated = useMemo(() => {
    const vals = (data?.rows ?? [])
      .map((r) => r.estimatedUsdc)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    return Math.max(...vals);
  }, [data]);

  const tokenAccentClass = symbol === "tfuel" ? "text-[#ff6a00]" : "text-[#14b8a6]";
  const tokenAccentFromClass =
    symbol === "tfuel" ? "from-[#ff6a00]/20" : "from-[#14b8a6]/20";

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400 dark:border-white/10 dark:bg-black"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
        />
        <select
          className={
            symbol === "tfuel"
              ? "h-11 rounded-xl border border-white/10 bg-black px-3 text-sm text-[#ff6a00] outline-none focus:ring-2 focus:ring-[#ff6a00]"
              : "h-11 rounded-xl border border-white/10 bg-black px-3 text-sm text-[#14b8a6] outline-none focus:ring-2 focus:ring-[#14b8a6]"
          }
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
        >
          <option value="tfuel">TFUEL</option>
          <option value="theta">THETA</option>
        </select>
      </div>

      <div className="rounded-xl border border-black/10 bg-zinc-50 p-3 text-sm dark:border-white/10 dark:bg-black">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Spot value (USDC)
          </span>
          <span className="font-semibold">{formatMoney(spotValue, "USDC")}</span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
          Last updated: {feesLastUpdatedAt == null ? "—" : new Date(feesLastUpdatedAt).toLocaleTimeString()}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Status</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              {loading ? "Loading…" : data ? "Ready" : "—"}
            </span>
            <button
              type="button"
              className="ios-press h-7 rounded-full border border-white/10 bg-black/30 px-3 text-[11px] font-semibold text-zinc-50 hover:bg-black/40"
              onClick={() => setLocalRefreshNonce((v) => v + 1)}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>
        {data?.quoteFetchedAt ? (
          <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
            Quote time: {new Date(data.quoteFetchedAt).toLocaleTimeString()}
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        {(data?.rows ?? []).map((r, idx) => {
          const isBest =
            bestEstimated != null &&
            r.estimatedUsdc != null &&
            Math.abs(r.estimatedUsdc - bestEstimated) < 1e-9;
          const deltaVsBest =
            bestEstimated == null || r.estimatedUsdc == null
              ? null
              : Math.max(0, bestEstimated - r.estimatedUsdc);

          const networkTextClass =
            r.to === "usdc-sol" ? "text-[#7c3aed]" : "text-[#38bdf8]";
          const networkSubtleTextClass =
            r.to === "usdc-sol" ? "text-[#7c3aed]/80" : "text-[#38bdf8]/80";

          const rowBg = isBest
            ? "bg-white/5"
            : r.to === "usdc-sol"
              ? "bg-[#7c3aed]/10"
              : "bg-[#38bdf8]/10";

          return (
            <div key={r.to} className={`${rowBg} p-3 text-sm`}>
              {idx > 0 ? <div className="mb-3 h-px w-full bg-white/10" /> : null}
              <div className={`flex items-start justify-between gap-3 ${networkTextClass}`}>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{labelNetwork(r.to)}</span>
                  <span className={`text-[11px] ${networkSubtleTextClass}`}>
                    Estimated received
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-semibold">
                    {formatMoney(r.estimatedUsdc, "USDC")}
                  </span>
                  {spotValue != null && r.impliedFeeUsdc != null ? (
                    <span className={`text-[11px] ${networkSubtleTextClass}`}>
                      Vs CoinGecko spot: {formatMoney(r.impliedFeeUsdc, "USDC")}
                      {r.impliedFeePct == null ? "" : ` (${r.impliedFeePct.toFixed(2)}%)`}
                    </span>
                  ) : null}
                  {deltaVsBest != null && deltaVsBest > 0 ? (
                    <span className={`text-[11px] ${networkSubtleTextClass}`}>
                      Difference vs best: {formatMoney(deltaVsBest, "USDC")}
                    </span>
                  ) : isBest ? (
                    <span className={`text-[11px] ${networkSubtleTextClass}`}>Best route</span>
                  ) : null}
                </div>
              </div>
              {r.error ? (
                <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400">{r.error}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
