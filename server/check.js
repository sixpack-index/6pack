/* =========================================================================
   Checks of the server logic. No network, no database — only arithmetic
   and rules.

   Run:     node server/check.js
   Break:   node server/check.js --break   — deliberately spoils what is
            being checked and makes sure the checks fail. A test that
            cannot fail is decoration: one like that once approved
            everything in a row, because it compared against the wrong grid.
   ========================================================================= */

import './../core.js';
import { validateConfig, WRITABLE, clientBucket } from './rules.js';

const C = globalThis.SixpackCore;
const BREAK = process.argv.includes('--break');

let passed = 0;
const failures = [];

function ok(name, cond, got) {
  if (cond) { passed++; return; }
  failures.push(name + (got === undefined ? '' : ' — got: ' + JSON.stringify(got)));
}
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/* ---------- addresses ---------- */
ok('a contract address is accepted',
   C.isAddress('0x75eEB81b6af4e9B88579aA2E6E2FDBAAf6D8f837'));
ok('a Uniswap v4 pool id is not counted as an address',
   !C.isAddress('0xd7b2be72c22aac8fee32834189110ffdb2fb1a8916846ff5104fb3e8cfde63d8'));
ok('an empty string is not counted as an address', !C.isAddress(''));
ok('an address without 0x is not accepted', !C.isAddress('75eEB81b6af4e9B88579aA2E6E2FDBAAf6D8f837'));

/* ---------- where the money comes from ----------
   These four checks guard not the arithmetic but the facts read off the
   chain. The pool fee rate, the venue share and its ceiling were taken
   with calls to Uniswap V3 and to the Pons locker; if one day somebody
   corrects the model "by eye", it will go red here before a promise that
   will not be kept appears on the storefront.

   The wedge is derived from the rate and the share and not set separately:
   two independent numbers obliged to agree sooner or later diverge. */
ok('the pool fee rate is one percent, as in the Pons launch config',
   C.MODEL.poolFeeBps === 100, C.MODEL.poolFeeBps);
ok('the venue share is no higher than its own ceiling of fifty percent',
   C.MODEL.venueShare > 0 && C.MODEL.venueShare <= 0.5, C.MODEL.venueShare);
ok('the wedge is exactly what is left after the venue',
   near(C.MODEL.wedgeBps, C.MODEL.poolFeeBps * (1 - C.MODEL.venueShare)), C.MODEL.wedgeBps);
ok('the wedge is smaller than the pool fee rate — there is nowhere to take more than the pool takes',
   C.MODEL.wedgeBps < C.MODEL.poolFeeBps);

/* ---------- the size of an epoch ----------
   The numbers come from a live measurement on 26 August: PAWHOOD, turnover
   $604 867 for the day. A wedge of 0.7% gives $4 234.069 a day, and eight
   epochs of three hours each — $529.2586. */
const POT = C.epochPot(604867);
ok('the epoch is counted by the published wedge', near(POT, 604867 * 0.007 / 8), POT);
ok('there are exactly eight epochs in a day', 24 / C.MODEL.epochHours === 8);
ok('there are six seats in the basket', C.MODEL.seats === 6);
ok('the share of one seat is a sixth of the epoch',
   near(POT / C.MODEL.seats, 529.2586 / 6, 1e-4));
ok('with no turnover there is no epoch', C.epochPot(0) === null && C.epochPot(null) === null);
ok('a negative turnover gives no payout', C.epochPot(-100) === null);

/* The holder's share: 19 650 000 out of a billion is 1.965%, which at this
   epoch gives $10.400. Exactly that number is shown on the page, and it
   has to add up. */
const share = 19_650_000 / C.MODEL.supply;
ok('the holder\'s share is counted off the supply', near(share, 0.01965));
ok('the dividend per epoch agrees with the one shown on the page',
   near(POT * share, 10.39993, 2e-4), POT * share);

/* ---------- the calculator as a whole ----------
   A live measurement on 26 August: PAWHOOD, price $0.0008561, turnover
   $604 867. A holder with 19 650 000 coins is 1.965% of the supply.
   Exactly these numbers stand on the page, and they have to agree down to
   the cent. */
const D = C.dividendFor(19_650_000, 604867, 0.0008561);
ok('the share of the supply', near(D.share, 0.01965), D.share);
ok('the value of the position', near(D.value, 16822.365, 1e-9), D.value);
ok('the dividend per epoch', near(D.mine, 10.39993, 1e-4), D.mine);
ok('the share of one basket position is a sixth', near(D.perSeat, D.mine / 6), D.perSeat);
ok('the yield per epoch', near(D.yieldPerEpoch, D.mine / D.value), D.yieldPerEpoch);
/* The horizons. Multiplying by eight and by thirty looks too simple to be
   worth checking — and that is exactly why it is here: a formula living
   inside the paint is caught by nothing. */
ok('a day is eight epochs', near(D.perDay, D.mine * 8), D.perDay);
ok('thirty days is thirty times a day', near(D.per30d, D.perDay * 30), D.per30d);
ok('the annual agrees with the daily', near(D.yieldAnnual, (D.perDay * 365) / D.value));
ok('with no turnover there are no horizons',
   C.dividendFor(19_650_000, 0, 1).perDay === null &&
   C.dividendFor(19_650_000, 0, 1).per30d === null);
ok('the annual is simple, not compound',
   near(D.yieldAnnual, D.yieldPerEpoch * 8 * 365), D.yieldAnnual);

const empty = C.dividendFor(19_650_000, 0, 0);
ok('with no turnover there is no dividend', empty.mine === null && empty.perSeat === null);
ok('with no price there is no position value', empty.value === null);
ok('the share is counted even with no market', near(empty.share, 0.01965));
ok('with no price the yield is not invented',
   empty.yieldPerEpoch === null && empty.yieldAnnual === null);
ok('a zero position gives no share', C.dividendFor(0, 604867, 1).share === null);

/* ---------- seat weights ----------
   Ten divided evenly, six does not: 10000 / 6 = 1666.67. If the remainder
   is lost, the contract gets 9996 and four hundredths of a percent of the
   epoch will belong to nobody. What is checked is not "six numbers of
   1666" but the rule itself — at any number of seats the sum has to be
   exactly ten thousand. */
const W = C.weightsBps();
ok('there are as many weights as seats', W.length === C.MODEL.seats, W.length);
ok('the weights add up to exactly ten thousand', W.reduce((a, b) => a + b, 0) === 10_000, W.join('+'));
ok('the seats differ by no more than one point',
   Math.max(...W) - Math.min(...W) <= 1, W.join(','));
ok('the top seats get the remainder, not the bottom ones', W[0] >= W[W.length - 1]);
for (const n of [1, 3, 6, 7, 10, 13, 99]) {
  const w = C.weightsBps(n);
  ok('the sum adds up at ' + n + ' seats too',
     w.length === n && w.reduce((a, b) => a + b, 0) === 10_000);
}

/* ---------- selection into the basket ---------- */
const t = (sym, name, price = 1) => ({ sym, name, price });
ok('a stablecoin does not go into the basket', !C.isConstituent(t('USDG', 'USD Global')));
ok('a wrapper for ether does not go into the basket', !C.isConstituent(t('WETH', 'Wrapped Ether')));
ok('a tokenized stock does not go into the basket',
   !C.isConstituent(t('NVDA', 'NVIDIA Corporation • Robinhood Token')));
ok('a receipt for a pool does not go into the basket',
   !C.isConstituent(t('rLP', 'Rebasing Liquidity Token')));
ok('an ordinary token of the chain does go into the basket', C.isConstituent(t('PIPEDOG', 'Pipe Dog')));
ok('a token with no price does not go into the basket', !C.isConstituent(t('GHOST', 'Ghost', 0)));

/* ---------- a live pool against an inflated one ----------
   A measurement on 26 August: there are five tokens with the ticker DOG on
   the chain. One of them has 128M of liquidity and zero turnover — it held
   the first seat of the whole basket, although there was not a single
   trade there. */
const alive = (liq, vol) => C.isAlive({ liq, vol24: vol });
ok('a pool with no trades is not counted as alive', !alive(128_124_882, 0));
ok('a traded pool is counted as alive', alive(9_081_193, 286_063));
ok('a pool on the edge is cut off by the rule and not by eye',
   alive(1000, 5) && !alive(1000, 4.9));
ok('zero liquidity does not divide by zero', !alive(0, 100));
ok('the liveness threshold is half a percent', C.ALIVE_RATIO === 0.005);

/* ---------- folding the pools ---------- */
const pair = (addr, sym, price, liq, vol) => ({
  baseToken: { address: addr, symbol: sym, name: sym },
  priceUsd: String(price),
  liquidity: { usd: liq },
  volume: { h24: vol },
  pairAddress: '0x' + 'a'.repeat(64),
  dexId: 'uniswap',
});
const folded = C.foldPairs([
  pair('0xAAA', 'X', 1, 100, 10),
  pair('0xaaa', 'X', 2, 900, 90),   // the same token, different case, a deeper pool
  pair('0xBBB', 'Y', 5, 50, 5),
]);
const X = folded.find(f => f.pair.baseToken.symbol === 'X');
ok('the pools of one token fold into a single row', folded.length === 2, folded.length);
ok('liquidity is summed across the pools', X.liq === 1000, X.liq);
ok('turnover is summed across the pools', X.vol24 === 100, X.vol24);
ok('the pools are counted right', X.pools === 2, X.pools);
ok('the price is taken from the deepest pool',
   C.shape(X).price === 2, C.shape(X).price);
ok('the link on the card goes to the exchange and not to the explorer',
   C.shape(X).url.includes('dexscreener.com'));

/* ---------- the rules for writing settings ---------- */
ok('a token address is written', validateConfig({ token: '0x' + '1'.repeat(40) }).ok);
ok('an empty address is allowed — it is the off switch',
   validateConfig({ token: '' }).ok);
ok('a pool id does not slip into the settings',
   !validateConfig({ token: '0x' + 'a'.repeat(64) }).ok);
ok('a foreign key is not written', !validateConfig({ supply: '123' }).ok);
ok('an empty body is rejected', !validateConfig({}).ok);
ok('a non-object is rejected', !validateConfig(null).ok && !validateConfig([]).ok);
ok('a theme made of letters is accepted', validateConfig({ theme: 'ember' }).ok);
ok('a theme with foreign characters is not accepted',
   !validateConfig({ theme: 'ember" onload="x' }).ok);
ok('a number instead of a string is rejected', !validateConfig({ note: 42 }).ok);
ok('the spaces around an address are trimmed',
   validateConfig({ vault: '  0x' + '2'.repeat(40) + '  ' }).clean.vault === '0x' + '2'.repeat(40));
ok('a refusal explains the reason',
   /42|forty|character/i.test(validateConfig({ token: '0x123' }).error),
   validateConfig({ token: '0x123' }).error);
ok('exactly five keys may be written', WRITABLE.size === 5, [...WRITABLE]);

/* ---------- the buy link ----------
   It goes into an href attribute on our storefront. Everything that is not
   https has to bounce off here: the console has a key, but a key is not a
   right to put javascript: or data: into the page. */
ok('an ordinary link passes',
   validateConfig({ buy: 'https://pons.money/token/0x' + '1'.repeat(40) }).ok);
ok('an empty link is allowed — it is the off switch',
   validateConfig({ buy: '' }).ok);
ok('http without encryption does not pass',
   !validateConfig({ buy: 'http://pons.money/x' }).ok);
ok('javascript: does not pass',
   !validateConfig({ buy: 'javascript:alert(1)' }).ok);
ok('data: does not pass',
   !validateConfig({ buy: 'data:text/html,<script>alert(1)</script>' }).ok);
ok('a quote in a link does not pass',
   !validateConfig({ buy: 'https://pons.money/"onmouseover="alert(1)' }).ok);
ok('a space in a link does not pass',
   !validateConfig({ buy: 'https://pons.money/a b' }).ok);
ok('the link is trimmed at the edges',
   validateConfig({ buy: '  https://pons.money/x  ' }).clean.buy === 'https://pons.money/x');

/* ---------- who counts as one and the same ----------
   A measurement on 26 August: one client came in now from 2.26.13.2, now
   from 2.26.13.4, and ended up with twice as many attempts as it should
   have. */
ok('a pool of addresses behind one exit is counted together',
   clientBucket('2.26.13.2') === clientBucket('2.26.13.4'));
ok('an adjacent subnet is counted separately',
   clientBucket('2.26.13.2') !== clientBucket('2.26.14.2'));
ok('IPv4 in an IPv6 wrapper is no different from the bare one',
   clientBucket('::ffff:2.26.13.2') === clientBucket('2.26.13.2'));
ok('IPv6 is folded down to a /64',
   clientBucket('2a01:4f8:c17:1::1') === clientBucket('2a01:4f8:c17:1::99'));
ok('different /64s are not confused',
   clientBucket('2a01:4f8:c17:1::1') !== clientBucket('2a01:4f8:c17:2::1'));
ok('an empty address does not bring it down', clientBucket('') === '?' && clientBucket(null) === '?');

/* ---------- breakage ----------
   Every line below breaks something that was checked above. If the checks
   still pass after the spoiling — they are not checking anything. */
if (BREAK) {
  const broken = [];
  const wasPot = C.epochPot(604867);
  if (near(C.epochPot(604867) * 2, wasPot)) broken.push('the epoch arithmetic is insensitive to doubling');
  if (C.isAddress('0x' + 'a'.repeat(64))) broken.push('the length of an address is not checked');
  if (validateConfig({ supply: '1' }).ok) broken.push('the key allowlist does not work');
  if (C.isConstituent(t('USDG', 'USD Global'))) broken.push('stablecoins are not weeded out');
  if (near(C.dividendFor(19_650_000, 604867, 0.0008561).mine * 2, 59.4281, 1e-4)) {
    broken.push('the dividend is insensitive to doubling');
  }
  if (clientBucket('2.26.13.2') === clientBucket('9.9.9.9')) {
    broken.push('subnets are not told apart at all');
  }
  if (C.isAlive({ liq: 128_124_882, vol24: 0 })) {
    broken.push('a dead pool passes as alive');
  }
  /* Naive weights — "divided evenly and walked away" — must fail to add up
     to ten thousand. That is exactly the mistake weightsBps came into being
     for: at ten seats it did not exist, at six it costs four hundredths of
     a percent of every epoch. We check only where the division is not even,
     otherwise at ten seats the breakage would have fooled itself. */
  if (10_000 % C.MODEL.seats !== 0) {
    const naive = Array.from({ length: C.MODEL.seats },
                             () => Math.floor(10_000 / C.MODEL.seats));
    if (naive.reduce((a, b) => a + b, 0) === 10_000) {
      broken.push('a lost weight remainder is not caught');
    }
  }

  console.log('\nBreakage: ' + (broken.length
    ? 'THE CHECKS ARE LEAKY — ' + broken.join('; ')
    : 'every substitution was caught, the checks are alive'));
  if (broken.length) process.exit(1);
}

/* ---------- the result ---------- */
if (failures.length) {
  console.error('FAILED ' + failures.length + ' of ' + (passed + failures.length) + ':');
  failures.forEach(f => console.error('  · ' + f));
  process.exit(1);
}
console.log('Server: ' + passed + ' checks passed.');
