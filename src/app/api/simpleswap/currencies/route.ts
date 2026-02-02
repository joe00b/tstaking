import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  const apiKey = process.env.SIMPLESWAP_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing SIMPLESWAP_API_KEY" },
      { status: 500 },
    );
  }

  const url = new URL("https://api.simpleswap.io/get_all_currencies");
  url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: `SimpleSwap HTTP ${res.status}`,
        details: txt ? txt.slice(0, 500) : undefined,
      },
      { status: 502 },
    );
  }

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    return NextResponse.json(
      { error: "Unexpected response" },
      { status: 502 },
    );
  }

  const currencies = data
    .filter((c) => {
      if (!q) return true;
      if (!c || typeof c !== "object") return false;
      const obj = c as Record<string, unknown>;
      return Object.values(obj).some((v) =>
        typeof v === "string" ? v.toLowerCase().includes(q) : false,
      );
    })
    .map((c) => {
      if (!c || typeof c !== "object") return c;
      const obj = c as Record<string, unknown>;
      return {
        symbol: obj.symbol,
        name: obj.name,
        network: obj.network,
        code: obj.code,
      };
    })
    .slice(0, 200);

  return NextResponse.json({
    q,
    count: currencies.length,
    currencies,
  });
}
