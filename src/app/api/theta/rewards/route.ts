import { NextResponse } from "next/server";

const EXPLORER_API = "https://explorer-api.thetatoken.org/api";

const CACHE_TTL_MS = 45_000;
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

type ExplorerAccountResponse = {
  type?: string;
  body?: {
    address?: string;
    balance?: {
      thetawei?: string;
      tfuelwei?: string;
    };
  };
};

type ExplorerStakeResponse = {
  type?: string;
  body?: {
    sourceRecords?: Array<{
      type?: string;
      amount?: string;
      withdrawn?: boolean;
    }>;
  };
};

type ExplorerAccountTxResponse = {
  type?: string;
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

async function getAccount(address: string) {
  return fetchJson<ExplorerAccountResponse>(`${EXPLORER_API}/account/${address}`);
}

async function getStake(address: string) {
  return fetchJson<ExplorerStakeResponse>(`${EXPLORER_API}/stake/${address}`);
}

async function getCoinbaseTxs(address: string, limit: number) {
  const url = `${EXPLORER_API}/accounttx/${address}?type=0&pageNumber=1&limitNumber=${encodeURIComponent(
    String(limit),
  )}&isEqualType=true`;
  return fetchJson<ExplorerAccountTxResponse>(url);
}

async function getCoinbaseTxPage(address: string, page: number, limit: number) {
  const url = `${EXPLORER_API}/accounttx/${address}?type=0&pageNumber=${encodeURIComponent(
    String(page),
  )}&limitNumber=${encodeURIComponent(String(limit))}&isEqualType=true`;
  return fetchJson<ExplorerAccountTxResponse>(url);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const addressesRaw = searchParams.get("addresses") ?? "";

  const cacheKey = `addresses:${addressesRaw.toLowerCase()}`;
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

  const nowSec = Math.floor(Date.now() / 1000);
  const sec7d = 7 * 24 * 60 * 60;
  const sec30d = 30 * 24 * 60 * 60;
  const oldestNeeded = nowSec - sec30d;

  const pageLimit = 50;
  const maxPages = 25;

  const results = await Promise.all(
    addresses.map(async (address) => {
      const [acct, stake, txs] = await Promise.all([
        getAccount(address),
        getStake(address),
        getCoinbaseTxs(address, pageLimit),
      ]);

      const tfuelBalance = acct.body?.balance?.tfuelwei
        ? weiToNumber(acct.body.balance.tfuelwei, 18)
        : null;

      const stakedTheta = (stake.body?.sourceRecords ?? [])
        .filter((r) => r.withdrawn === false)
        .map((r) => (r.amount ? weiToNumber(r.amount, 18) : null))
        .filter((v): v is number => v != null)
        .reduce((a, b) => a + b, 0);

      let rewards7d = 0;
      let rewards30d = 0;
      let lastRewardAt: number | null = null;

      function ingest(list: ExplorerAccountTxResponse["body"]) {
        for (const tx of list ?? []) {
          const ts = tx.timestamp ? Number(tx.timestamp) : null;
          if (!ts || !Number.isFinite(ts)) continue;
          if (ts < oldestNeeded) continue;

          const outputs = tx.data?.outputs ?? [];
          const match = outputs.find(
            (o) => o.address?.toLowerCase() === address,
          );
          const tfuelwei = match?.coins?.tfuelwei;
          if (!tfuelwei) continue;

          const amt = weiToNumber(tfuelwei, 18);
          if (amt == null || amt <= 0) continue;

          if (lastRewardAt == null || ts > lastRewardAt) lastRewardAt = ts;
          if (ts >= nowSec - sec7d) rewards7d += amt;
          if (ts >= nowSec - sec30d) rewards30d += amt;
        }
      }

      ingest(txs.body);

      // The explorer endpoint is paginated newest-first.
      // We keep paginating until we have covered the full 30-day window.
      let oldestTsSeen: number | null = (() => {
        const oldestTx = (txs.body ?? []).at(-1);
        const ts = oldestTx?.timestamp ? Number(oldestTx.timestamp) : null;
        return ts != null && Number.isFinite(ts) ? ts : null;
      })();

      let page = 2;
      while (page <= maxPages) {
        if (oldestTsSeen != null && oldestTsSeen < oldestNeeded) break;

        const pageRes = await getCoinbaseTxPage(address, page, pageLimit);
        const body = pageRes.body ?? [];
        if (body.length === 0) break;

        ingest(body);

        const oldestTx = body.at(-1);
        const ts = oldestTx?.timestamp ? Number(oldestTx.timestamp) : null;
        oldestTsSeen = ts != null && Number.isFinite(ts) ? ts : oldestTsSeen;

        const totalPages = pageRes.totalPageNumber ?? null;
        const currentPage = pageRes.currentPageNumber ?? page;
        if (totalPages != null && currentPage >= totalPages) break;

        page += 1;
      }

      return {
        address,
        tfuelBalance,
        stakedTheta: stakedTheta || null,
        rewards7d: rewards7d || null,
        rewards30d: rewards30d || null,
        lastRewardAt,
      };
    }),
  );

  const payload = {
    addresses,
    results,
    fetchedAt: Date.now(),
  };

  responseCache.set(cacheKey, { ts: Date.now(), payload });
  return NextResponse.json(payload);
}
