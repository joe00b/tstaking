import { NextResponse } from "next/server";

type Quote = {
  price: number | null;
  error?: string;
};

function normalizeCurrency(code: string): string {
  const c = code.trim().toLowerCase();
  if (c === "tfuel") return "tfuel";
  if (c === "theta") return "theta";
  if (c === "usdc") return "usdc";
  return c;
}

function toCoinGeckoId(symbol: string): string | null {
  const s = symbol.trim().toLowerCase();
  if (s === "tfuel") return "theta-fuel";
  if (s === "theta") return "theta-token";
  return null;
}

async function fetchEstimated(
  currencyFrom: string,
  currencyTo: string,
  amount: number,
): Promise<Quote> {
  const apiKey = process.env.SIMPLESWAP_API_KEY;
  if (!apiKey) {
    return { price: null, error: "Missing SIMPLESWAP_API_KEY" };
  }
  const url = new URL("https://api.simpleswap.io/get_estimated");
  url.searchParams.set("currency_from", normalizeCurrency(currencyFrom));
  url.searchParams.set("currency_to", normalizeCurrency(currencyTo));
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("fixed", "false");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
    },
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
      price: null,
      error: details
        ? `SimpleSwap HTTP ${res.status}: ${details}`
        : `SimpleSwap HTTP ${res.status}`,
    };
  }

  const data: unknown = await res.json();

  if (typeof data === "number") {
    return { price: data };
  }

  if (
    data &&
    typeof data === "object" &&
    "estimated_amount" in data &&
    typeof (data as { estimated_amount: unknown }).estimated_amount === "number"
  ) {
    return { price: (data as { estimated_amount: number }).estimated_amount };
  }

  return { price: null, error: "Unexpected SimpleSwap response" };
}

async function fetchCoinGeckoSpot(
  symbol: string,
): Promise<{ usdc: number | null; usd: number | null; error?: string }> {
  const id = toCoinGeckoId(symbol);
  if (!id) {
    return { usdc: null, usd: null, error: "Unsupported token" };
  }

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", id);
  url.searchParams.set("vs_currencies", "usd,usdc");

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    return { usdc: null, usd: null, error: `CoinGecko HTTP ${res.status}` };
  }

  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || !(id in data)) {
    return { usdc: null, usd: null, error: "Unexpected CoinGecko response" };
  }

  const row = (data as Record<string, unknown>)[id];
  if (!row || typeof row !== "object") {
    return { usdc: null, usd: null, error: "Unexpected CoinGecko response" };
  }

  const usd =
    "usd" in row && typeof (row as { usd?: unknown }).usd === "number"
      ? (row as { usd: number }).usd
      : null;
  const usdc =
    "usdc" in row && typeof (row as { usdc?: unknown }).usdc === "number"
      ? (row as { usdc: number }).usdc
      : null;

  return { usdc: usdc ?? usd, usd };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "").trim().toLowerCase();

  if (!symbol) {
    return NextResponse.json(
      { error: "Missing symbol" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const amount = 1;

  const usdcQuote = await fetchEstimated(symbol, "usdc", amount);

  let usdc = usdcQuote.price;
  let usd = usdc;
  let source: "simpleswap" | "coingecko" = "simpleswap";
  let error = usdcQuote.error;

  if (usdc == null) {
    const fallback = await fetchCoinGeckoSpot(symbol);
    usdc = fallback.usdc;
    usd = fallback.usd;
    if (usdc != null || usd != null) {
      source = "coingecko";
      error = usdcQuote.error
        ? `${usdcQuote.error} (using CoinGecko spot as fallback)`
        : fallback.error;
    } else {
      error = error ?? fallback.error;
    }
  }

  if (usdc == null && usd == null) {
    return NextResponse.json(
      {
        symbol,
        usdc: null,
        usd: null,
        error: error ?? "Failed to fetch price",
        source,
        fetchedAt: Date.now(),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    symbol,
    usdc,
    usd,
    source,
    fetchedAt: Date.now(),
  });
}
