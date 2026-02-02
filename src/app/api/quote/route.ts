import { NextResponse } from "next/server";

function normalizeFrom(code: string): string {
  const c = code.trim().toLowerCase();
  if (c === "tfuel") return "tfuel";
  if (c === "theta") return "theta";
  return c;
}

function normalizeTo(network: string): string {
  const n = network.trim().toLowerCase();
  if (n === "sol" || n === "solana" || n === "usdc-sol") return "usdcspl";
  return "usdc";
}

function parseMinFromDescription(desc: string): number | null {
  const m = desc.match(/Min:\s*([0-9.]+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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

async function fetchEstimated(
  from: string,
  to: string,
  amount: number,
): Promise<{ estimated: number | null; min?: number | null; error?: string }> {
  const apiKey = process.env.SIMPLESWAP_API_KEY;
  if (!apiKey) {
    return {
      estimated: null,
      error: "Missing SIMPLESWAP_API_KEY",
    };
  }
  const url = new URL("https://api.simpleswap.io/get_estimated");
  url.searchParams.set("currency_from", normalizeFrom(from));
  url.searchParams.set("currency_to", to);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("fixed", "false");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let min: number | null | undefined;

    try {
      const parsed = txt ? (JSON.parse(txt) as unknown) : null;
      if (
        parsed &&
        typeof parsed === "object" &&
        "description" in parsed &&
        typeof (parsed as { description?: unknown }).description === "string"
      ) {
        min = parseMinFromDescription(
          (parsed as { description: string }).description,
        );
      }
    } catch {
      min = undefined;
    }

    return {
      estimated: null,
      min,
      error: txt
        ? `SimpleSwap HTTP ${res.status}: ${txt.slice(0, 300)}`
        : `SimpleSwap HTTP ${res.status}`,
    };
  }

  const data: unknown = await res.json();

  if (typeof data === "number") return { estimated: data };

  if (typeof data === "string") {
    const n = Number(data);
    return Number.isFinite(n)
      ? { estimated: n }
      : { estimated: null, error: "Unexpected SimpleSwap response" };
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "").trim().toLowerCase();
  const amountRaw = (searchParams.get("amount") ?? "").trim();
  const network = (searchParams.get("network") ?? "sol").trim().toLowerCase();

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const to = normalizeTo(network);
  const r = await fetchEstimated(symbol, to, amount);

  if (r.estimated == null) {
    const spotUsdc = await fetchCoinGeckoSpotUSDC(symbol);
    if (spotUsdc != null) {
      const estimatedUsdc = spotUsdc * amount;
      const totalUsd = estimatedUsdc;
      const effectiveUsdPerToken = amount > 0 ? totalUsd / amount : null;

      return NextResponse.json(
        {
          symbol,
          amount,
          network: to === "usdcspl" ? "sol" : "eth",
          estimatedUsdc,
          totalUsd,
          effectiveUsdPerToken,
          spotTotalUsd: estimatedUsdc,
          impliedFeeUsd: 0,
          impliedFeePct: 0,
          minAmount: r.min ?? null,
          error: r.error
            ? `${r.error} (using CoinGecko spot as fallback)`
            : "Using CoinGecko spot as fallback",
          source: "coingecko",
          fetchedAt: Date.now(),
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        symbol,
        amount,
        network: to === "usdcspl" ? "sol" : "eth",
        estimatedUsdc: null,
        totalUsd: null,
        effectiveUsdPerToken: null,
        spotTotalUsd: null,
        impliedFeeUsd: null,
        impliedFeePct: null,
        minAmount: r.min ?? null,
        error: r.error ?? "Failed to fetch quote",
        source: "simpleswap",
        fetchedAt: Date.now(),
      },
      { status: 502 },
    );
  }

  const estimatedUsdc = r.estimated;
  const totalUsd = estimatedUsdc;
  const effectiveUsdPerToken = amount > 0 ? totalUsd / amount : null;

  const spotUsdc = await fetchCoinGeckoSpotUSDC(symbol);
  const spotTotalUsd = spotUsdc == null ? null : spotUsdc * amount;
  const impliedFeeUsd =
    spotTotalUsd == null ? null : Math.max(0, spotTotalUsd - totalUsd);
  const impliedFeePct =
    spotTotalUsd == null || spotTotalUsd <= 0 || impliedFeeUsd == null
      ? null
      : (impliedFeeUsd / spotTotalUsd) * 100;

  return NextResponse.json({
    symbol,
    amount,
    network: to === "usdcspl" ? "sol" : "eth",
    estimatedUsdc,
    totalUsd,
    effectiveUsdPerToken,
    spotTotalUsd,
    impliedFeeUsd,
    impliedFeePct,
    minAmount: null,
    source: "simpleswap",
    fetchedAt: Date.now(),
  });
}
