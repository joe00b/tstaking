import { NextResponse } from "next/server";

function normalizeFrom(code: string): string {
  const c = code.trim().toLowerCase();
  if (c === "tfuel") return "tfuel";
  if (c === "theta") return "theta";
  return c;
}

function normalizeTo(code: string): string {
  const c = code.trim().toLowerCase();
  if (c === "usdc") return "usdc";
  if (c === "usdc-eth") return "usdc";
  if (c === "usdc-sol") return "usdcspl";
  return c;
}

function toCoinGeckoId(symbol: string): string | null {
  const s = symbol.trim().toLowerCase();
  if (s === "tfuel") return "theta-fuel";
  if (s === "theta") return "theta-token";
  return null;
}

async function fetchCoinGeckoSpotUSDC(symbol: string): Promise<number | null> {
  const id = toCoinGeckoId(symbol);
  if (!id) return null;

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", id);
  url.searchParams.set("vs_currencies", "usdc,usd");

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });

  if (!res.ok) return null;

  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || !(id in data)) return null;
  const row = (data as Record<string, unknown>)[id];
  if (!row || typeof row !== "object") return null;

  const usdc =
    "usdc" in row && typeof (row as { usdc?: unknown }).usdc === "number"
      ? (row as { usdc: number }).usdc
      : null;
  const usd =
    "usd" in row && typeof (row as { usd?: unknown }).usd === "number"
      ? (row as { usd: number }).usd
      : null;

  return usdc ?? usd;
}

async function fetchSimpleSwapEstimatedUSDC(
  from: string,
  to: string,
  amount: number,
): Promise<{ estimated: number | null; error?: string }> {
  const apiKey = process.env.SIMPLESWAP_API_KEY;
  const url = new URL("https://api.simpleswap.io/get_estimated");
  url.searchParams.set("currency_from", normalizeFrom(from));
  url.searchParams.set("currency_to", normalizeTo(to));
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("fixed", "false");
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    let details: string | undefined;
    try {
      const txt = await res.text();
      details = txt ? txt.slice(0, 300) : undefined;
    } catch {
      details = undefined;
    }

    return {
      estimated: null,
      error: details
        ? `SimpleSwap HTTP ${res.status}: ${details}`
        : `SimpleSwap HTTP ${res.status}`,
    };
  }

  const data: unknown = await res.json();

  if (typeof data === "number") return { estimated: data };

  if (typeof data === "string") {
    const n = Number(data);
    return Number.isFinite(n) ? { estimated: n } : { estimated: null };
  }

  if (
    data &&
    typeof data === "object" &&
    "estimated_amount" in data &&
    (typeof (data as { estimated_amount: unknown }).estimated_amount === "number" ||
      typeof (data as { estimated_amount: unknown }).estimated_amount === "string")
  ) {
    const raw = (data as { estimated_amount: number | string }).estimated_amount;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n)
      ? { estimated: n }
      : { estimated: null, error: "Unexpected SimpleSwap response" };
  }

  return { estimated: null, error: "Unexpected SimpleSwap response" };
}

type NetworkFeeRow = {
  to: "usdc-sol" | "usdc-eth";
  estimatedUsdc: number | null;
  impliedFeeUsdc: number | null;
  impliedFeePct: number | null;
  error?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "").trim().toLowerCase();
  const amountRaw = (searchParams.get("amount") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : 100;

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const spotUsdc = await fetchCoinGeckoSpotUSDC(symbol);

  const apiKey = process.env.SIMPLESWAP_API_KEY;
  if (!apiKey) {
    const targets: Array<NetworkFeeRow["to"]> = ["usdc-sol", "usdc-eth"];
    const rows = targets.map((to) => {
      const estimatedUsdc = spotUsdc == null ? null : spotUsdc * amount;
      return {
        to,
        estimatedUsdc,
        impliedFeeUsdc: estimatedUsdc == null ? null : 0,
        impliedFeePct: estimatedUsdc == null ? null : 0,
        error: "Missing SIMPLESWAP_API_KEY (using CoinGecko spot as fallback)",
      } satisfies NetworkFeeRow;
    });

    return NextResponse.json({
      symbol,
      amount,
      spotUsdc,
      rows,
      quoteFetchedAt: Date.now(),
      fetchedAt: Date.now(),
    });
  }

  const targets: Array<NetworkFeeRow["to"]> = ["usdc-sol", "usdc-eth"];
  const estimates = await Promise.all(
    targets.map(async (to) => {
      const r = await fetchSimpleSwapEstimatedUSDC(symbol, to, amount);
      const estimatedUsdc = r.estimated;

      let impliedFeeUsdc: number | null = null;
      let impliedFeePct: number | null = null;

      if (spotUsdc != null && estimatedUsdc != null) {
        const spotValue = spotUsdc * amount;
        impliedFeeUsdc = Math.max(0, spotValue - estimatedUsdc);
        impliedFeePct =
          spotValue > 0 ? (impliedFeeUsdc / spotValue) * 100 : null;
      }

      return {
        to,
        estimatedUsdc,
        impliedFeeUsdc,
        impliedFeePct,
        error: r.error,
      } satisfies NetworkFeeRow;
    }),
  );

  return NextResponse.json({
    symbol,
    amount,
    spotUsdc,
    rows: estimates,
    quoteFetchedAt: Date.now(),
    fetchedAt: Date.now(),
  });
}
