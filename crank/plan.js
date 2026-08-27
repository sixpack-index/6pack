/* =========================================================================
   What the crank is about to do — before it does it.

   There is no network here, no keys, no transactions: only rules and
   arithmetic. That is on purpose. A program that spends other people's
   money eight times a day must be able to show its decision before
   execution — and that decision must be checked by tests, not by watching
   what has already happened.

   The dry run comes from the same place: the same functions, the same
   result, only nothing gets signed.
   ========================================================================= */

import './../core.js';

const C = globalThis.SixpackCore;

/* Gas spent per step. The numbers are not invented: the swap was measured
   by the quoter on a live pool (68 200), the rest are ordinary for these
   operations, taken with margin upward. If the chain starts charging more,
   the crank will notice by itself: it checks the estimate against the real
   price before every epoch. */
export const GAS = {
  claim: 150_000,     // take what has accrued off the hook
  wrap: 50_000,       // wrap ETH if it turns out to be needed
  swap: 120_000,      // buying one basket member, with margin over 68 200
  transfer: 45_000,   // one transfer to a recipient
};

/**
 * How much gas a full epoch will eat with this number of recipients.
 * The payout is transfers, and their count is people times coins.
 */
export function gasForEpoch(recipients, seats = C.MODEL.seats) {
  return GAS.claim + GAS.wrap + seats * GAS.swap + recipients * seats * GAS.transfer;
}

/**
 * Whether the epoch is worth closing at all.
 *
 * The rule is the one that was published: three hours is a floor, not a
 * length. The epoch closes only when what has accrued is enough to cover
 * the settlement with a margin. Without this rule, at the start, while
 * there is almost no trading, the crank would burn more on empty epochs
 * than it pays out.
 *
 * The margin is needed because the gas price changes between the decision
 * and the execution, and an epoch that breaks off in the middle of the
 * payout is the worst outcome there is.
 */
export function shouldSettle({ potWei, recipients, gasPriceWei, margin = 3 }) {
  const gas = BigInt(gasForEpoch(recipients));
  const cost = gas * BigInt(gasPriceWei);
  const need = cost * BigInt(margin);
  const enough = potWei >= need;
  return {
    settle: enough,
    costWei: cost,
    needWei: need,
    /* The reason is always in words: a silent refusal cannot be told apart
       from a breakage, and the crank refuses more often than it agrees. */
    why: enough
      ? null
      : 'collected less than the settlement costs with a margin of ×' + margin,
  };
}

/**
 * Who gets the dividend and in what share.
 *
 * Shares are computed off the **eligible supply** — the sum of the balances
 * of those who passed the floor, not off the whole supply. Otherwise part
 * of the basket would stay undistributed and would hang on the operator's
 * wallet.
 *
 * @param holders  [{ address, balance }] — balances at the snapshot block
 * @param supply   the supply
 */
export function shares(holders, supply = C.MODEL.supply, floorRatio = 0.0001) {
  const floor = supply * floorRatio;
  const eligible = holders.filter(h => Number(h.balance) >= floor);
  const total = eligible.reduce((s, h) => s + Number(h.balance), 0);
  return {
    floor,
    eligible: eligible
      .map(h => ({ ...h, share: total > 0 ? Number(h.balance) / total : 0 }))
      .sort((a, b) => b.share - a.share),
    excluded: holders.length - eligible.length,
    eligibleSupply: total,
    /* The eligible supply's share of the whole — the very number that
       stands on the site in the "eligible supply" card. Computed here so
       that the site and the crank do not diverge. */
    eligibleRatio: supply > 0 ? total / supply : 0,
  };
}

/**
 * Who must not be included in the payout, even with a large balance.
 *
 * Pools, the distributor itself and burn addresses are not holders. To pay
 * the pool is to make a gift to the exchange, and the payout will report
 * success while doing it. This has happened on a previous project already,
 * so the exclusion list here is strict, not "where possible".
 */
export function excludeNonHolders(holders, { pools = [], operator = '', token = '', extra = [] } = {}) {
  const dead = new Set([
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
  ]);
  const skip = new Set([
    ...pools.map(a => String(a).toLowerCase()),
    ...extra.map(a => String(a).toLowerCase()),
    ...(operator ? [operator.toLowerCase()] : []),
    ...(token ? [token.toLowerCase()] : []),
    ...dead,
  ]);
  return holders.filter(h => !skip.has(String(h.address).toLowerCase()));
}

/**
 * Picking a pool out of several quotes.
 *
 * It lives here rather than next to the network for exactly the same reason
 * the calculator's arithmetic moved here: a rule that cannot be run under a
 * test will one day turn out to be broken, and we will learn about it from
 * other people's money.
 *
 * The rule: first cut off everything far from the market price, then take
 * the best of what is left. In exactly that order. "Whoever gives more"
 * without the first step is an invitation for a pool with a painted price:
 * the measurement on August 26 found eighty-five pools for one token, and
 * the best one by that rule promised sixty times more coins than the market
 * is worth.
 *
 * @param list [{ out: BigInt, … }] — what the pools answered
 * @param fair how many coins the market price gives for the same amount
 * @param band how many times over it is allowed to deviate either way
 */
export function pickQuote(list, { fair = null, band = 3 } = {}) {
  const alive = (list || []).filter(q => q && q.out > 0n);
  if (!alive.length) return { ok: false, why: 'not a single pool gave a quote' };
  if (!(fair > 0)) {
    /* With no reference point we refuse to choose. To silently take "the
       best" here is to take the bait — it is always the best. */
    return { ok: false, why: 'no market price, nothing to check the quote against' };
  }
  const near = alive.filter(q => {
    const n = Number(q.out) / 1e18;
    return n >= fair / band && n <= fair * band;
  });
  if (!near.length) return { ok: false, why: 'all pools are off the market price — nowhere to buy' };

  near.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
  const best = near[0];
  return {
    ok: true,
    best,
    considered: alive.length,
    alternatives: near.length - 1,
    /* How much better the best option is than the second — that is the
       price of an error, had we chosen without looking. Visible in the dry
       run. */
    edge: near.length > 1 && near[1].out > 0n
      ? Number((best.out - near[1].out) * 10_000n / near[1].out) / 100
      : 0,
  };
}

/**
 * Split an amount in wei into n parts with no losses.
 *
 * The remainder is handed out one wei at a time to the top seats — by the
 * same rule as the weights in basis points (see weightsBps in the core).
 * The difference between the first and the last seat comes out as one wei:
 * a quantity that does not exist in human units, while the sum still adds
 * up exactly, and that can be checked by addition.
 */
export function splitWei(total, n) {
  const parts = BigInt(Math.max(1, Math.floor(n)));
  const base = total / parts;
  const rem = total - base * parts;        // BigInt does not know % for negatives
  return Array.from({ length: Number(parts) },
                    (_, i) => base + (BigInt(i) < rem ? 1n : 0n));
}

/**
 * The full plan for an epoch: what to buy, who gets how much.
 * Returns what the crank prints in a dry run and executes in a live one.
 */
export function planEpoch({ potWei, basket, holders, gasPriceWei, supply, operator, token, exclude = [] }) {
  const clean = excludeNonHolders(holders, {
    pools: basket.map(t => t.address), operator, token, extra: exclude,
  });
  const s = shares(clean, supply);
  const decision = shouldSettle({
    potWei, recipients: s.eligible.length, gasPriceWei,
  });

  /* The wedge is split between the seats evenly — "equal weight", as
     written in the rules. No weighting by market size.

     We divide with a remainder, not simply potWei / n. While there were ten
     seats this meant nothing; six does not divide ten, and integer BigInt
     division would silently drop the remainder on the floor every epoch.
     The sum of the parts must equal exactly what was collected — otherwise
     part of the epoch belongs to nobody, and that would only be found out
     by addition on the chain. */
  const spend = splitWei(potWei, basket.length || 1);

  return {
    ...decision,
    /* The price in ether travels along with the seat in the basket: the
       crank uses it to filter out pools with a painted price when it goes
       for a quote. */
    seats: basket.map((t, i) => ({ sym: t.sym, address: t.address, spendWei: spend[i],
                           priceNative: t.priceNative ?? null,
                           pairId: t.pairId ?? null })),
    recipients: s.eligible.length,
    excluded: s.excluded + (holders.length - clean.length),
    eligibleSupply: s.eligibleSupply,
    eligibleRatio: s.eligibleRatio,
    floor: s.floor,
    transfers: s.eligible.length * basket.length,
    payout: s.eligible.map(h => ({ address: h.address, share: h.share })),
  };
}
