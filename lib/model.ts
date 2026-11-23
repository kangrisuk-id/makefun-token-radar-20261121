// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries that is not an exchange or a
// versioned pool of another protocol: the whole watchlist first (the floor, never a ceiling),
// then every other qualifying protocol below it, the early rows the radar exists to find.
// Protocols whose token already trades are kept apart and shown at the market's own values.
//
// Implied value is priced off the snapshot's own comparables, never a hand-kept list of names:
//
//   multiple   = the category's peer multiple: the median market-cap/TVL of the tokenised
//                protocols in the same category, shrunk toward the global median by the
//                peer count (weight n/(n+4)) and clamped to [0.03, 2.5]
//   base       = tvl_usd x multiple
//   momentum   = 1 + 0.6 x clamp(change_7d, -50, 100)/100      (no report: 1)
//   maturity   = 0.75 + 0.25 x ln(1+age_days)/ln(1+1825)       (unknown age: the set's median)
//   breadth    = 1 + 0.02 x min(chains - 1, 10)
//   implied    = max(1, round(base x momentum x maturity x breadth))
//
// v2 (peer-multiple-3) adds three things on the same base price, all derived from the snapshot:
//   range      = the same formula priced at the peer set's shrunk 25th and 75th percentile
//                multiples (see peerMultiples): implied_low / implied_high bracket the base.
//   farm meta  = every farm step carries a structured gas cost and active minutes; the row's
//                farm_summary is their aggregate (plus the hold window, in weeks).
//   backtest   = a leave-one-out test over the snapshot's tokenised protocols: each one's
//                market cap is predicted with itself removed from its peer set, and the
//                aggregate error is reported beside the flat 0.25 x TVL starter baseline's.
//
// The same function scores every row, and the dashboard states the whole formula with each
// row's own four factors, so a reader can recompute any row from the snapshot alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peer-multiple-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** The shrinkage weight: a category's own median counts n/(n+SHRINK) of its multiple. */
const SHRINK = 4;
const MULT_FLOOR = 0.03;
const MULT_CAP = 2.5;

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  /** The confidence range: the base formula priced at the peer set's shrunk p25 / p75 multiples. */
  implied_low_usd: number;
  implied_high_usd: number;
  /** Structured cost (gas/fees, USD) and active time per farm step, aligned with farm_steps. */
  farm_step_meta: { cost_usd: number; minutes: number }[];
  /** The farm plan's totals, aggregated from farm_step_meta plus the hold window. */
  farm_summary: { cost_usd: number; time_hours: number; weeks: number; capital_usd: number };
  model: {
    peer_multiple: number;
    peer_count: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures plus its farm plan. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One category's peer multiple, as the dashboard's method panel states it. */
export interface PeerRow {
  category: string;
  peers: number;
  median_multiple: number | null;
  used_multiple: number;
}

/** The leave-one-out backtest over the snapshot's tokenised protocols (see backtest()). */
export interface Backtest {
  n: number;
  model: { median_abs_pct_error: number; median_ratio: number; within_2x_pct: number };
  baseline: { median_abs_pct_error: number; median_ratio: number; within_2x_pct: number };
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_multiple: number;
  global_p25_multiple: number;
  global_p75_multiple: number;
  backtest: Backtest;
  peers: PeerRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A percentile of a non-empty list, linearly interpolated between closest ranks. */
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (pos - lo);
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another protocol's token, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whole words that mark a wrapped or staked product of a token that already trades. */
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a product may begin with: the exchange's own wrapper, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades (the watchlist's own exclusions, applied at every size:
 * a bridged Bitcoin wrapper records no token of its own in the snapshot, but it is not waiting
 * on a launch, and a radar that prices it as one is wrong on its top row).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_WORDS.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

interface CategoryPeers {
  peers: number;
  median: number | null;
  used: number;
  /** Shrunk 25th / 75th percentile multiples: the confidence range's edges for this category. */
  usedLow: number;
  usedHigh: number;
}

/** Shrink one statistic toward its global counterpart by the peer count, then clamp. */
function shrink(stat: number, globalStat: number, n: number): number {
  return Math.min(MULT_CAP, Math.max(MULT_FLOOR, (n * stat + SHRINK * globalStat) / (n + SHRINK)));
}

/**
 * The peer multiples: one shrunk multiple per category, from the tokenised protocols, plus the
 * shrunk p25/p75 band the confidence range prices at. `excludeSlug` drops one protocol from
 * every set it belongs to (the backtest's leave-one-out).
 */
export function peerMultiples(snapshot: Snapshot, excludeSlug?: string): { globalMedian: number; globalP25: number; globalP75: number; byCategory: Map<string, CategoryPeers> } {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.slug === excludeSlug) continue;
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const cat = p.category ?? 'Uncategorised';
    const list = perCategory.get(cat) ?? [];
    list.push(ratio);
    perCategory.set(cat, list);
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const globalP25 = ratios.length > 0 ? percentile(ratios, 0.25) : globalMedian;
  const globalP75 = ratios.length > 0 ? percentile(ratios, 0.75) : globalMedian;
  const byCategory = new Map<string, CategoryPeers>();
  for (const [cat, list] of perCategory) {
    byCategory.set(cat, {
      peers: list.length,
      median: median(list),
      used: shrink(median(list), globalMedian, list.length),
      usedLow: shrink(percentile(list, 0.25), globalP25, list.length),
      usedHigh: shrink(percentile(list, 0.75), globalP75, list.length),
    });
  }
  return { globalMedian, globalP25, globalP75, byCategory };
}

/** The multiples a category prices at: its shrunk peer median and band, or the global set's when it has no peers. */
function multipleFor(ctx: PeerContext, category: string | null): { multiple: number; peers: number; low: number; high: number } {
  const entry = ctx.byCategory.get(category ?? 'Uncategorised');
  if (entry === undefined) {
    const clamp = (n: number) => Math.min(MULT_CAP, Math.max(MULT_FLOOR, n));
    return { multiple: clamp(ctx.globalMedian), peers: 0, low: clamp(ctx.globalP25), high: clamp(ctx.globalP75) };
  }
  return { multiple: entry.used, peers: entry.peers, low: entry.usedLow, high: entry.usedHigh };
}

interface PeerContext {
  globalMedian: number;
  globalP25: number;
  globalP75: number;
  byCategory: Map<string, CategoryPeers>;
  medianAge: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four factors, the implied value one protocol gets, and its peer-band range. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  ctx: PeerContext,
): { implied: number; low: number; high: number; multiple: number; peers: number; momentum: number; maturity: number; breadth: number; age: number | null } {
  const { multiple, peers, low: lowMult, high: highMult } = multipleFor(ctx, p.category);
  const age = ageDays(asOf, p.listed_at);
  const chg = p.change_7d === null ? 0 : Math.min(100, Math.max(-50, p.change_7d));
  const momentum = p.change_7d === null ? 1 : 1 + 0.6 * (chg / 100);
  const ageForModel = age ?? ctx.medianAge;
  const maturity = 0.75 + 0.25 * (Math.log(1 + Math.min(ageForModel, 1825)) / Math.log(1 + 1825));
  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  const rest = momentum * maturity * breadth;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * rest));
  // The range reprices the same row at the band's edges; the shrunk percentiles preserve the
  // median's order, so low <= implied <= high holds by construction.
  const low = Math.max(1, Math.round(p.tvl_usd * lowMult * rest));
  const high = Math.max(1, Math.round(p.tvl_usd * highMult * rest));
  return { implied, low, high, multiple, peers, momentum, maturity, breadth, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; ctx: PeerContext } {
  const peersInfo = peerMultiples(snapshot);
  // The watchlist is the floor: its slugs rank whatever the filters say (they pass them by
  // construction, but coverage is the gate's row and is never gambled on a filter change).
  const watch = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const ages = rankable.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const ctx: PeerContext = { globalMedian: peersInfo.globalMedian, globalP25: peersInfo.globalP25, globalP75: peersInfo.globalP75, byCategory: peersInfo.byCategory, medianAge: ages.length > 0 ? median(ages) : 365 };
  const scored = rankable.map((p) => ({ p, v: impliedValue(p, snapshot.as_of, ctx) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => {
    const plan = farmPlan(s.p, s.v.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watch.has(s.p.slug),
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      implied_low_usd: s.v.low,
      implied_high_usd: s.v.high,
      farm_step_meta: plan.meta,
      farm_summary: plan.summary,
      model: {
        peer_multiple: round4(s.v.multiple),
        peer_count: s.v.peers,
        momentum_multiplier: round4(s.v.momentum),
        maturity_multiplier: round4(s.v.maturity),
        breadth_multiplier: round4(s.v.breadth),
        age_days: s.v.age,
      },
      farm_steps: plan.steps,
    };
  });
  return { board, ctx };
}

/**
 * The leave-one-out backtest: for every tokenised protocol in the snapshot, predict its market
 * cap with the full model while it is removed from its own peer set, and do the same with the
 * starter's flat 0.25 x TVL. Nothing is tuned on the result; it is reported as computed.
 * The maturity factor's fallback age is the tokenised set's own median age.
 */
export function backtest(snapshot: Snapshot): Backtest {
  const tokenised = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ages = tokenised.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) : 365;
  const agg = (preds: number[]) => {
    const apes = preds.map((pred, i) => Math.abs(pred - tokenised[i]!.mcap_usd!) / tokenised[i]!.mcap_usd!);
    const ratios = preds.map((pred, i) => pred / tokenised[i]!.mcap_usd!);
    const within = ratios.filter((r) => r >= 0.5 && r <= 2).length;
    return {
      median_abs_pct_error: Math.round(median(apes) * 1000) / 10,
      median_ratio: round4(median(ratios)),
      within_2x_pct: tokenised.length > 0 ? Math.round((within / tokenised.length) * 1000) / 10 : 0,
    };
  };
  const modelPreds = tokenised.map((p) => {
    const loo = peerMultiples(snapshot, p.slug);
    const ctx: PeerContext = { globalMedian: loo.globalMedian, globalP25: loo.globalP25, globalP75: loo.globalP75, byCategory: loo.byCategory, medianAge };
    return impliedValue(p, snapshot.as_of, ctx).implied;
  });
  const basePreds = tokenised.map((p) => Math.round(0.25 * p.tvl_usd));
  return { n: tokenised.length, model: agg(modelPreds), baseline: agg(basePreds) };
}

// ------------------------------------------------------------- farm plans

/** Roughly what one on-chain action costs in gas on a chain, in dollars, late 2026. */
const GAS_USD: Record<string, number> = {
  Ethereum: 8, Arbitrum: 0.25, Base: 0.15, Optimism: 0.2, Polygon: 0.05, 'BNB Chain': 0.3,
  Avalanche: 0.4, Solana: 0.05, 'zkSync Era': 0.2, Linea: 0.2, Scroll: 0.25, Mantle: 0.2,
  Gnosis: 0.05, Sonic: 0.05, Fantom: 0.05, Tron: 1.5, Bitcoin: 2, Sui: 0.05, Aptos: 0.05,
  Near: 0.02, TON: 0.1, Starknet: 0.15, Blast: 0.15, Mode: 0.15, Fraxtal: 0.15, Berachain: 0.2,
  Monad: 0.1, Hyperliquid: 0.05, CosmosHub: 0.1, Osmosis: 0.05, Sei: 0.02, Injective: 0.02,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 0.5;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The category's core action and follow-up, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string; cadence: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator'))
    return {
      core: `Deposit ${money(capital)} of USDC into a ${name} curated vault on ${chain}; curator vaults track depositors by shares held over time`,
      second: `Keep the vault shares in the same wallet and do not rotate vaults mid-season: share-age is what curator points and snapshots usually weight`,
      cadence: `Add a small top-up deposit each week so the wallet shows continuous, growing activity rather than one parked lump sum`,
    };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply ${money(capital)} of USDC to ${name} on ${chain} as lending collateral and leave the supply position open`,
      second: `Borrow a small amount (under 30% of the supplied value) against the position and repay it after a week, so the wallet has both supply and borrow history`,
      cadence: `Make one small supply or repayment each week to stay active across the protocol's weekly snapshots`,
    };
  if (c.includes('dex'))
    return {
      core: `Provide ${money(capital)} of liquidity to ${name}'s deepest stable or majors pool on ${chain} and keep the LP position open`,
      second: `Route a few swaps a week through ${name} itself rather than an aggregator, so the volume is credited to your wallet`,
      cadence: `Swap a small amount and rebalance the LP position weekly; volume plus liquidity is the pair most DEX point systems count`,
    };
  if (c.includes('rwa'))
    return {
      core: `Mint or buy ${money(capital)} of ${name}'s tokenised real-world asset on ${chain} through its own app and hold the position`,
      second: `Complete the protocol's investor onboarding (identity or eligibility checks) early: RWA issuers usually snapshot eligible holders, not just balances`,
      cadence: `Hold through each monthly attestation or distribution date; RWA rewards weight holders of record on those dates`,
    };
  if (c.includes('chain'))
    return {
      core: `Bridge ${money(capital)} of USDC or ETH to ${name} through its official bridge and keep the funds on the chain`,
      second: `Use two or three of the chain's native apps (a DEX, a lending market, a name service) so the wallet looks like a real early user, not a bridge tourist`,
      cadence: `Make two or three transactions a week on the chain across different apps; chain launches weight distinct active days most`,
    };
  if (c.includes('basis'))
    return {
      core: `Deposit ${money(capital)} of USDC into ${name}'s basis-trading vault on ${chain} and keep the shares`,
      second: `Read the vault's funding and hedge report once a month: basis vaults can de-peg in stressed markets, and the exit window matters more than the entry`,
      cadence: `Top up the vault monthly rather than weekly; basis strategies snapshot balances at epoch ends`,
    };
  if (c.includes('staking') || c.includes('restak'))
    return {
      core: `Stake ${money(capital)} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet`,
      second: `Restake or deposit the receipt token into one integrated vault if ${name} lists one: stacked receipts are what restaking points usually multiply`,
      cadence: `Add a small stake monthly and never unstake the whole position before a snapshot date you can see announced`,
    };
  if (c.includes('stable'))
    return {
      core: `Mint or deposit ${money(capital)} of the stable asset through ${name} on ${chain} and hold the stablecoin itself`,
      second: `Provide the stablecoin to one lending market or pool the protocol names as a partner, so the balance works in two places at once`,
      cadence: `Hold the stablecoin across each weekly balance snapshot; stablecoin issuers weight average balances, not peak balances`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge ${money(capital)} of USDC through ${name} to ${chain} and use the bridged funds in one app at the far end`,
      second: `Bridge back a smaller amount a week later rather than the same day: round trips in one session are the pattern sybil filters remove first`,
      cadence: `Make one bridge a week in varying amounts and directions; bridge points count routes and distinct days`,
    };
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return {
      core: `Deposit ${money(capital)} of USDC as margin on ${name} and open one small hedged position (long and short of similar size)`,
      second: `Keep total leverage under 2x and the position small: the goal is counted volume and open-interest days, not trading profit`,
      cadence: `Trade a small amount two or three days a week; perps points weight volume spread over distinct days`,
    };
  if (c.includes('payment'))
    return {
      core: `Fund a ${name} account or card with ${money(capital)} from ${chain} and make one real payment with it`,
      second: `Set up one recurring or repeat payment (a subscription or a transfer to your own second account) so the account shows ongoing use`,
      cadence: `Make at least one payment a week; payment products weight active weeks and transaction counts`,
    };
  if (c.includes('insurance'))
    return {
      core: `Buy ${money(capital)} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to expiry`,
      second: `Also stake a small amount in the protocol's underwriting pool if it offers one: underwriters and cover buyers are usually scored separately`,
      cadence: `Renew the cover when it expires rather than letting cover lapse; continuous cover is the visible signal`,
    };
  if (c.includes('yield') || c.includes('farm'))
    return {
      core: `Deposit ${money(capital)} of USDC into ${name}'s main yield vault on ${chain} and keep the vault shares`,
      second: `Turn on auto-compounding if the vault offers it, and screenshot your share balance monthly for your own records`,
      cadence: `Top up the vault with a small deposit each week so the wallet's activity spans many snapshots`,
    };
  return {
    core: `Deposit ${money(capital)} of USDC into ${name} on ${chain} through its own app and keep the position open`,
    second: `Use one second feature of the app (a vote, a stake of the receipt, a referral-free second deposit) so the wallet is more than a single transaction`,
    cadence: `Repeat one small action each week so the wallet stays active across the protocol's snapshots`,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text}. Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Each step also carries structured meta — its gas/fee cost in USD (position capital excluded:
 * it stays in the position, and the summary reports it separately) and its active minutes,
 * with the weekly steps counted once per week of the hold window. The summary is exactly
 * those meta rows aggregated, so the totals a reader sees are the steps' own numbers added up.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; meta: { cost_usd: number; minutes: number }[]; summary: { cost_usd: number; time_hours: number; weeks: number; capital_usd: number } } {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const a = actionsFor(p, capital, chain);
  const multi = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; after two weeks, repeat the core action on ${p.chains[1]} as well, because multi-chain activity is cheap breadth most farmers skip.` : '';
  const steps = [
    stepText(
      `Set up a fresh wallet for ${p.name} alone and fund it on ${chain} with ${money(capital + 20)} of USDC plus the chain's gas token; keep the seed phrase offline and never farm from your main wallet`,
      `about ${money(gas)} of gas to make the wallet's first transaction`,
      '10 minutes',
    ),
    stepText(a.core, `${money(capital)} of capital and about ${money(gas * 2)} of gas`, '15 minutes to set up'),
    stepText(a.second, `about ${money(gas)} of gas`, '10 minutes'),
    stepText(`${a.cadence}.${multi}`, `about ${money(gas)} of gas a week`, '10 minutes a week'),
    stepText(
      `Hold the position for at least ${hold} days without withdrawing below half the starting balance, so the activity counts in several snapshots rather than one`,
      `the ${money(capital)} stays in the position; the real cost is the opportunity cost of the capital`,
      `${hold} days`,
    ),
    stepText(
      `Once a week, check ${p.name}'s own site and official announcements for a points, rewards or season page, and join it from the link the protocol itself publishes`,
      'nothing to check, and never pay a fee to claim or unlock an allocation',
      '5 minutes a week',
    ),
    stepText(
      `Keep a farm log (wallet, dates, amounts, transaction hashes) and, when a token or claim is announced, claim only from the protocol's official page and unwind the position in two or three tranches`,
      `about ${money(gas * 2)} of gas to unwind`,
      '20 minutes, when the time comes',
    ),
  ];
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  // Aligned with the steps above: setup gas, core gas, second-action gas, the weekly cadence
  // step repeated for each week of the hold, the hold itself (no fee, no active minutes), the
  // weekly check repeated likewise, and the unwind gas.
  const meta = [
    { cost_usd: round2(gas), minutes: 10 },
    { cost_usd: round2(gas * 2), minutes: 15 },
    { cost_usd: round2(gas), minutes: 10 },
    { cost_usd: round2(gas * weeks), minutes: 10 * weeks },
    { cost_usd: 0, minutes: 0 },
    { cost_usd: 0, minutes: 5 * weeks },
    { cost_usd: round2(gas * 2), minutes: 20 },
  ];
  const summary = {
    cost_usd: round2(meta.reduce((s, m) => s + m.cost_usd, 0)),
    time_hours: Math.round((meta.reduce((s, m) => s + m.minutes, 0) / 60) * 10) / 10,
    weeks,
    capital_usd: capital,
  };
  return { steps, meta, summary };
}

/** The seven farm step strings alone (kept for callers that only need the board's text). */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  return farmPlan(p, age).steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, ctx } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const peers: PeerRow[] = [...ctx.byCategory.entries()]
    .map(([category, e]) => ({ category, peers: e.peers, median_multiple: e.median === null ? null : round4(e.median), used_multiple: round4(e.used) }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median_multiple: round4(ctx.globalMedian),
    global_p25_multiple: round4(ctx.globalP25),
    global_p75_multiple: round4(ctx.globalP75),
    backtest: backtest(snapshot),
    peers,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd)) return `${r.slug} has a range that does not bracket its implied value`;
    if (r.farm_step_meta.length !== steps.length) return `${r.slug} has farm meta for ${r.farm_step_meta.length} of ${steps.length} steps`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
