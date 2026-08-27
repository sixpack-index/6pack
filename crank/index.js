/* =========================================================================
   The crank.

   Wakes up every three hours, looks at how much the fee has accrued, and
   if what has accrued is enough to cover the settlement — takes it, buys
   the basket and sends it out to holders.

   RUNNING

     node crank/index.js              one dry run: shows what it would
                                      do and signs nothing
     node crank/index.js --watch      the same thing on a schedule
     node crank/index.js --live       live mode, needs a key

   ENVIRONMENT VARIABLES

     SIXPACK_TOKEN     the token address
     SIXPACK_OPERATOR  the operator address — whom the locker pays the fee
     SIXPACK_KEY       the operator's private key. Needed ONLY in --live

   The pool identifier is no longer needed: on Pons everything the pool key
   knew is asked of the factory by the token address, and the pool itself
   is found by sweeping the enabled fee tiers. One setting fewer that can
   be entered wrong.

   The dry run is the default, and that is not caution for caution's sake.
   The program spends other people's money eight times a day; it must be
   able to show its decision before it executes it, and to show it with the
   same code that executes it afterwards.
   ========================================================================= */

import './../core.js';
import { ADDR, NOT_HOLDERS, poolPot, launchInfo, poolFor, quote, feeLabel,
         gasPrice, head, holders, supplyOf } from './read.js';
import { planEpoch, gasForEpoch, GAS } from './plan.js';

const C = globalThis.SixpackCore;

const ARG = new Set(process.argv.slice(2));
const LIVE = ARG.has('--live');
const WATCH = ARG.has('--watch');

const CFG = {
  token: process.env.SIXPACK_TOKEN || '',
  operator: process.env.SIXPACK_OPERATOR || '',
  key: process.env.SIXPACK_KEY || '',
};

const EVERY_MS = C.MODEL.epochHours * 3600 * 1000;

/* ---------- output ---------- */

const eth = (wei, d = 6) => (Number(wei) / 1e18).toFixed(d);
const nf = (v, d = 0) => Number(v).toLocaleString('en-US',
  { minimumFractionDigits: d, maximumFractionDigits: d });

function line(k, v) { console.log('  ' + String(k).padEnd(26) + v); }
function head2(t) { console.log('\n' + t); console.log('  ' + '─'.repeat(58)); }

/* ---------- one pass ---------- */

export async function tick() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log('\n' + '═'.repeat(62));
  console.log(stamp + '   ' + (LIVE ? 'LIVE MODE' : 'dry run — nothing gets signed'));
  console.log('═'.repeat(62));

  if (!C.isAddress(CFG.token)) {
    console.log('\n  The token address is not set (SIXPACK_TOKEN). While it is');
    console.log('  missing there is nothing to compute — that is the off switch.');
    return { skipped: 'no token address' };
  }
  /* 1. What Pons knows about the launch and how much fee has accrued */
  const info = await launchInfo(CFG.token);
  const [pot, ourPool, gp, blk] = await Promise.all([
    poolPot(CFG.token, info), poolFor(CFG.token), gasPrice(), head(),
  ]);

  head2('accrued on the locked position');
  line('for the payout, ether', eth(pot.ethWei) + ' ETH');
  line('arrived in our own token', nf(Number(pot.tokenWei) / 1e18, 0) + ' — to be burned');
  line('the fee goes to', info.feeTo);
  line('venue share', info.venueShare + '%  · ours ' + (100 - info.venueShare) + '% of what is collected');
  line('pool fee tier', (info.poolFee / 10_000) + '%');
  line('our pool', ourPool.pool + '  (tier ' + feeLabel(ourPool.fee) + ')');
  line('liquidity position', '# ' + nf(info.positionId) + ', locked forever');
  line('gas price', (Number(gp) / 1e9).toFixed(5) + ' gwei');
  line('block', nf(blk));

  /* The fee recipient must match the operator: otherwise collectFees from
     the operator will not go through, and it is better to learn that here
     than in the middle of a live epoch. The locker admits the owner, the
     launcher and the recipient. */
  if (CFG.operator && info.feeTo.toLowerCase() !== CFG.operator.toLowerCase()
      && info.deployer.toLowerCase() !== CFG.operator.toLowerCase()) {
    console.log('\n  ⚠ The fee goes NOT to the operator.');
    console.log('    recipient: ' + info.feeTo);
    console.log('    launcher:  ' + info.deployer);
    console.log('    operator:  ' + CFG.operator);
    console.log('    collectFees from the operator will not go through. Either set');
    console.log('    SIXPACK_OPERATOR right, or move the recipient: setFeeRedirect.');
    return { skipped: 'the fee goes to another address' };
  }

  /* 2. Who is in. Supply comes from the contract: a constant in the code
        will one day diverge from the chain, and the percentages will drift
        silently. */
  const supply = await supplyOf(CFG.token);
  const floor = supply * 0.0001;
  const snap = await holders(CFG.token, floor);
  const hs = snap.holders;

  /* 3. What to buy */
  const basket = await C.readBasket();

  /* 4. The decision.

     The address of our pool goes into the exclusions on its own line, and
     that is no small thing. In V4 all the network's liquidity sat in one
     singleton contract, which was on the list anyway. In V3 every pair has
     its own contract, and it holds almost the whole supply — on the very
     first run of the previous version the pool turned out to be the largest
     recipient with a 5.9% share. To pay the pool is to make a gift to the
     exchange, and the payout will report success while doing it. */
  const plan = planEpoch({
    potWei: pot.ethWei,
    basket: basket.basket,
    holders: hs,
    gasPriceWei: gp,
    supply,
    operator: CFG.operator,
    token: CFG.token,
    exclude: [...NOT_HOLDERS, ourPool.pool, info.feeTo, info.deployer],
  });

  head2('who is in');
  line('snapshot at block', nf(snap.block));
  line('supply from contract', nf(supply));
  line('listed by the explorer', nf(snap.listed));
  line('with a non-zero balance', nf(hs.length) +
       '   (' + nf(snap.listed - hs.length - snap.failed) + ' have already sold out)' +
       (snap.failed ? ' · NOT READ ' + nf(snap.failed) : ''));
  line('sum of their balances', nf(Math.round(hs.reduce((a, h) => a + h.balance, 0))) +
       '  (' + (hs.reduce((a, h) => a + h.balance, 0) / supply * 100).toFixed(2) + '% of supply)');
  line('floor', nf(plan.floor) + ' coins (0.01% of supply)');
  line('pass the floor', nf(plan.recipients));
  line('excluded', nf(plan.excluded) + '  (pools, operator, the token itself, burn addresses)');
  line('eligible supply', nf(plan.eligibleSupply) + '  (' + (plan.eligibleRatio * 100).toFixed(2) + '% of the whole)');

  head2('what the settlement will cost');
  line('transfers', nf(plan.transfers) + '  (' + nf(plan.recipients) + ' × ' + basket.basket.length + ')');
  line('gas', nf(gasForEpoch(plan.recipients)));
  line('cost', eth(plan.costWei) + ' ETH');
  line('needed with margin', eth(plan.needWei) + ' ETH');

  /* The snapshot must be complete. Shares are computed off the sum of the
     balances, and if part of it did not read, every share is computed off
     the wrong total — the payout drifts apart silently, and there will be
     nothing to take it back with. */
  if (!snap.complete) {
    console.log('\n  The epoch is NOT closing: ' + (snap.why ||
      ('the snapshot is incomplete, ' + nf(snap.failed) + ' balances out of ' + nf(snap.listed) + ' were not read')) + '.');
    console.log('  To pay out on an incomplete list is to compute the shares of');
    console.log('  others off the wrong total. We wait for the node to answer fully.');
    return { settled: false, plan, incomplete: true };
  }

  if (!plan.settle) {
    console.log('\n  The epoch is NOT closing: ' + plan.why + '.');
    console.log('  Three hours is a floor, not a length: we keep accruing.');
    return { settled: false, plan };
  }

  /* The ten quotes go at once, not one after another: each of them climbs
     into the chain for the list of pools and polls them, and sequentially
     that is minutes. */
  head2('what it will buy');
  const quotes = await Promise.all(plan.seats.map(s =>
    quote({ token: s.address, amountWei: s.spendWei,
            priceNative: s.priceNative, pairId: s.pairId })
      .then(q => ({ s, q })).catch(e => ({ s, err: e.message || String(e) }))));

  for (const { s, q, err } of quotes) {
    const got = err
      ? '→ nowhere to buy: ' + err
      : '→ ' + nf(Number(q.out) / 1e18, 2) + ' ' + s.sym +
        '   ' + q.venue + ' ' + feeLabel(q.fee) +
        (q.alternatives ? ', ' + q.edge.toFixed(2) + '% better than the next of ' + (q.alternatives + 1)
                        : ', only one usable pool');
    console.log('  ' + s.sym.padEnd(14) + eth(s.spendWei) + ' ETH  ' + got);
  }

  /* A seat with nowhere to buy is not a small annoyance: its share of the
     epoch would otherwise simply hang on the operator's wallet, and the
     basket would in fact not be the basket. Let it be said out loud. */
  const blind = quotes.filter(x => x.err);
  if (blind.length) {
    console.log('\n  ⚠ Seats with no pool: ' + blind.length + ' of ' + plan.seats.length +
                ' — ' + blind.map(x => x.s.sym).join(', ') + '.');
    console.log('    There is nowhere to spend their share of the epoch. Before going');
    console.log('    live, decide what to do with it: split it or carry it forward.');
  }

  head2('who it will pay');
  plan.payout.slice(0, 8).forEach(p =>
    console.log('  ' + p.address + '  ' + (p.share * 100).toFixed(4) + '%'));
  if (plan.payout.length > 8) console.log('  … and another ' + nf(plan.payout.length - 8));

  if (!LIVE) {
    console.log('\n  Dry run: not a single transaction was sent.');
    console.log('  For the live one you need --live and a key in SIXPACK_KEY.');
    return { settled: false, dry: true, plan };
  }

  /* The live part is deliberately not wired up yet: first the whole cycle
     above has to be checked on the live chain dry and on a testnet. To turn
     signing on earlier is to bet money on code that has never once shown
     its decision. */
  console.log('\n  Live mode is not switched on in this build yet.');
  console.log('  The order: dry run → testnet 46630 → live.');
  return { settled: false, plan };
}

/* ---------- schedule ---------- */

async function once() {
  try { await tick(); }
  catch (e) { console.error('\n  The pass failed: ' + (e.message || e)); }
}

if (WATCH) {
  console.log('The crank is running. Checking every ' + C.MODEL.epochHours + ' h.');
  await once();
  setInterval(once, EVERY_MS);
} else {
  await once();
}
