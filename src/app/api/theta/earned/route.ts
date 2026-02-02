import { NextResponse } from "next/server";

const EXPLORER_API = "https://explorer-api.thetatoken.org/api";

const CACHE_TTL_MS = 120_000;
const responseCache = new Map<string, { ts: number; payload: unknown }>();

function toAddressList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function isHexAddress(s: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(s);
}

function weiToNumber(wei: string, decimals: number): number | null {
  try {
    const bi = BigInt(wei);
    const denom = BigInt(10) ** BigInt(decimals);
    const whole = bi / denom;
    const frac = bi % denom;
    const frac6 = (frac * BigInt(1_000_000)) / denom;
    return Number(whole) + Number(frac6) / 1_000_000;
  } catch {
    return null;
  }
}

type ExplorerAccountTxResponse = {
  body?: Array<{
    timestamp?: string;
    data?: {
      outputs?: Array<{
        address?: string;
        coins?: {
          tfuelwei?: string;
        };
      }>;
    };
  }>;
  totalPageNumber?: number;
  currentPageNumber?: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 15 },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Theta Explorer HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

async function getCoinbasePage(address: string, page: number, limit: number) {
  const url = `${EXPLORER_API}/accounttx/${address}?type=0&pageNumber=${encodeURIComponent(
    String(page),
  )}&limitNumber=${encodeURIComponent(String(limit))}&isEqualType=true`;
  return fetchJson<ExplorerAccountTxResponse>(url);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const addressesRaw = searchParams.get("addresses") ?? "";
  const sinceRaw = searchParams.get("since") ?? "";

  const cacheKey = `addresses:${addressesRaw.toLowerCase()}|since:${sinceRaw}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  const addresses = toAddressList(addressesRaw);
  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "Missing addresses" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  if (!addresses.every(isHexAddress)) {
    return NextResponse.json(
      { error: "Invalid address" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const sinceSec = Number(sinceRaw);
  if (!Number.isFinite(sinceSec) || sinceSec <= 0) {
    return NextResponse.json(
      { error: "Invalid since" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const limit = 50;
  const maxPages = 40; // cap to avoid hammering explorer

  const results = await Promise.all(
    addresses.map(async (address) => {
      let total = 0;
      let lastRewardAt: number | null = null;
      let pagesFetched = 0;

      for (let page = 1; page <= maxPages; page++) {
        pagesFetched++;
        const txs = await getCoinbasePage(address, page, limit);
        const body = txs.body ?? [];

        if (body.length === 0) break;

        let reachedBeforeSince = false;

        for (const tx of body) {
          const ts = tx.timestamp ? Number(tx.timestamp) : null;
          if (!ts || !Number.isFinite(ts)) continue;
          if (ts < sinceSec) {
            reachedBeforeSince = true;
            continue;
          }

          const outputs = tx.data?.outputs ?? [];
          const match = outputs.find((o) => o.address?.toLowerCase() === address);
          const tfuelwei = match?.coins?.tfuelwei;
          if (!tfuelwei) continue;

          const amt = weiToNumber(tfuelwei, 18);
          if (amt == null || amt <= 0) continue;

          total += amt;
          if (lastRewardAt == null || ts > lastRewardAt) lastRewardAt = ts;
        }

        if (reachedBeforeSince) break;

        const totalPages = txs.totalPageNumber ?? null;
        const currentPage = txs.currentPageNumber ?? page;
        if (totalPages != null && currentPage >= totalPages) break;
      }

      return {
        address,
        earned: total || null,
        lastRewardAt,
        pagesFetched,
      };
    }),
  );

  const payload = {
    sinceSec,
    addresses,
    results,
    fetchedAt: Date.now(),
  };

  responseCache.set(cacheKey, { ts: Date.now(), payload });
  return NextResponse.json(payload);
}
