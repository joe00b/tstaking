import { NextResponse } from "next/server";

function clampDays(raw: string | null) {
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n)) return 30;
  return Math.min(90, Math.max(1, Math.round(n)));
}

function symbolToCoinGeckoId(symbol: string) {
  switch (symbol.toLowerCase()) {
    case "tfuel":
      return "theta-fuel";
    case "theta":
      return "theta-token";
    default:
      return null;
  }
}

type MarketChartResponse = {
  prices?: Array<[number, number]>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "tfuel-staking-rewards/1.0",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CoinGecko HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") ?? "").toLowerCase();
  const days = clampDays(searchParams.get("days"));
  const id = symbolToCoinGeckoId(symbol);

  if (!id) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  // Note: do NOT pass interval=hourly; CoinGecko restricts that to enterprise.
  // For days in [2, 90], CoinGecko returns hourly-ish data automatically.
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    id,
  )}/market_chart?vs_currency=usd&days=${encodeURIComponent(String(days))}`;

  try {
    const json = await fetchJson<MarketChartResponse>(url);
    const prices = (json.prices ?? [])
      .map((p) => ({ t: p[0], price: p[1] }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price));

    return NextResponse.json({ symbol, days, prices, fetchedAt: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: "history_fetch_failed", message, symbol, days },
      { status: 502 },
    );
  }
}
