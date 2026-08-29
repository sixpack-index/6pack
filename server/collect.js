/* =========================================================================
   The collector. It goes to the chain itself, on a schedule, and puts what
   it has read into the database.

   Why it exists, if the browser can do the same: other people's free APIs
   fall over. On a large request DexScreener silently hands back zero pairs,
   Blockscout drops a 500 about every other time. While the browser was
   doing the reading, the visitor saw this — the page blinked dashes out of
   nowhere. Now it is the collector that sees the failure, and the visitor
   gets the last good value and its age.

   From that follows the main rule of this file: **a failed read never
   overwrites a successful one**. Only what actually arrived is written to
   the database.
   ========================================================================= */

import './../core.js';
import { q, settings } from './db.js';
/* The gas an epoch costs is computed by the crank — the same function, not
   a copy of it. Two arithmetics answering one question will diverge, and
   they will diverge silently: the console says "forty epochs of runway",
   the crank stops on the third. */
import { gasForEpoch } from './../crank/plan.js';

const C = globalThis.SixpackCore;

/* The schedule. The basket and the market — once a minute: more often is
   pointless, other people's APIs did not ask for it. Holders — once every
   ten minutes, Blockscout is slow. The treasury — once every five minutes,
   nothing there changes faster than a three-hour epoch. */
const EVERY = {
  basket: 60_000,
  self: 60_000,
  holders: 10 * 60_000,
  vault: 5 * 60_000,
  gas: 5 * 60_000,
};

/* What happened last time. Handed back in /api/health: a silent collector
   is the worst kind of breakage, so its state is always visible from the
   outside. */
export const health = {
  startedAt: Date.now(),
  basket: { at: null, ok: null, why: null, source: null },
  self: { at: null, ok: null, why: null },
  holders: { at: null, ok: null, why: null },
  vault: { at: null, ok: null, why: null, added: 0 },
  gas: { at: null, ok: null, why: null, eth: null, epochs: null },
};

function mark(what, ok, why, extra) {
  health[what] = { ...health[what], at: Date.now(), ok, why: why || null, ...(extra || {}) };
  if (!ok) console.warn('collector ' + what + ': ' + why);
}

/* ---------- the basket of the chain ---------- */
async function collectBasket() {
  try {
    const d = await C.readBasket();
    if (!d.basket.length) throw new Error('the basket came back empty');
    await q(
      'insert into basket (source, scanned, priced, rows, ranking) values ($1, $2, $3, $4, $5)',
      [d.source, d.scanned, d.priced, JSON.stringify(d.basket),
       JSON.stringify(d.ranking || d.basket)]
    );
    mark('basket', true, null, { source: d.source });
  } catch (e) {
    mark('basket', false, e.message);
  }
}

/* ---------- our own token ---------- */
async function collectSelf() {
  try {
    const s = await settings();
    const token = s.token;
    /* No address — nothing to read, and that is not an error. This is
       exactly what switches the whole calculation off: erase the address
       in the console — the site lives, the numbers go dark. */
    if (!C.isAddress(token)) { mark('self', true, null); return; }

    const m = await C.marketOf(token);
    /* We do not write an empty read: otherwise a single DexScreener
       failure would zero the cards out, although the market has not gone
       anywhere. */
    if (m.price === null && m.liq === null) throw new Error('the market did not read');

    await q(
      `insert into market (token, price, market_cap, liq, vol24, pools, pair_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [token, m.price, m.marketCap, m.liq, m.vol24, m.pools, m.pairId]
    );
    mark('self', true);
  } catch (e) {
    mark('self', false, e.message);
  }
}

/* ---------- holders ---------- */
async function collectHolders() {
  try {
    const s = await settings();
    const token = s.token;
    if (!C.isAddress(token)) { mark('holders', true, null); return; }
    const n = await C.holdersOf(token);
    if (!Number.isFinite(n)) throw new Error('the explorer did not give a number');
    /* A minute is precise enough for a snapshot, and it is also the key:
       two collectors within one minute do not double the row. */
    await q(
      `insert into holders (token, at, count)
       values ($1, date_trunc('minute', now()), $2)
       on conflict (token, at) do update set count = excluded.count`,
      [token, n]
    );
    mark('holders', true);
  } catch (e) {
    mark('holders', false, e.message);
  }
}

/* ---------- the treasury ---------- */

/* A reserve of confirmations. Reading right up to the freshest block is
   not allowed: it may be reorganised, and a payout shown on the site would
   disappear from the chain. Five blocks on Orbit — seconds of waiting and
   no risk at all. */
const CONFIRMATIONS = 5;

/**
 * The history of payouts.
 *
 * The whole history of the address is read from the very beginning, not
 * "from now". This is not extra work but a lesson: a watcher that starts
 * from the current moment sees nothing that arrived before the address was
 * typed in — and the first epochs are lost forever. Blockscout hands back
 * the history in full, and a key on the hash makes rereading it free.
 */
async function collectVault() {
  try {
    const s = await settings();
    const vault = s.vault;
    if (!C.isAddress(vault)) { mark('vault', true, null, { added: 0 }); return; }

    let head = null;
    try {
      const b = await C.ask(C.CHAIN.explorer + '/api/v2/blocks?type=block', 2);
      head = Number(b && b.items && b.items[0] && b.items[0].height);
    } catch (_) { /* with no head we simply will not cut the tail off */ }

    const d = await C.ask(
      C.CHAIN.explorer + '/api/v2/addresses/' + vault + '/token-transfers?type=ERC-20', 3);
    const items = (d && d.items) || [];

    let added = 0;
    for (const t of items) {
      const hash = t.transaction_hash || t.tx_hash;
      if (!hash) continue;
      const block = Number(t.block_number ?? t.block);
      if (Number.isFinite(head) && Number.isFinite(block) && head - block < CONFIRMATIONS) continue;

      const dec = Number((t.token && t.token.decimals) ?? 18);
      const raw = t.total && (t.total.value ?? t.total);
      const amount = raw !== undefined && raw !== null && Number.isFinite(dec)
        ? Number(raw) / Math.pow(10, dec)
        : null;

      const r = await q(
        `insert into epochs (hash, at, block, symbol, token, amount, raw)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (hash) do nothing`,
        [hash, t.timestamp, Number.isFinite(block) ? block : null,
         t.token && t.token.symbol, t.token && t.token.address,
         Number.isFinite(amount) ? amount : null, JSON.stringify(t)]
      );
      added += r.rowCount;
    }
    mark('vault', true, null, { added });
  } catch (e) {
    mark('vault', false, e.message);
  }
}

/* ---------- the operator's gas ----------

   Under the scheme of 29 August the fee is forwarded by hand and the
   working wallet is topped up by hand. So the balance will run out one day
   — and it will look like nothing at all: the crank simply stops closing
   epochs, the site keeps showing the basket, and nobody notices until the
   first holder complains.

   So the balance is read here and shown on the console. Read by a direct
   call to the node: the explorer is not needed for a single number and
   answers 403 without a header, while eth_getBalance is on every node
   always.

   There is no key here and there cannot be: the server knows the address
   and can only look. Signing is the crank's job, on its own machine. */
async function collectGas() {
  try {
    const s = await settings();
    const who = s.operator;
    /* Wipe ALL the fields, not just the balance. `mark` merges the new into
       the old, and without this the runway in epochs survived the address
       being cleared: no address, no balance, and yet "enough for 3 epochs".
       A field that outlives its cause lies to its first reader. */
    if (!C.isAddress(who)) {
      mark('gas', true, null, { eth: null, epochs: null, wei: null,
                                gasPriceWei: null, address: '' });
      return;
    }

    const r = await fetch(C.CHAIN.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [who, 'latest'],
      }),
    });
    if (!r.ok) throw new Error('the node answered ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'the node returned an error');
    if (typeof j.result !== 'string') throw new Error('the node gave no balance');

    /* Through BigInt, not Number: the balance arrives in wei, and 0.05 ETH
       is 5e16 — past the integer range of a double. Divide afterwards. */
    const wei = BigInt(j.result);
    const eth = Number(wei) / 1e18;

    /* "0.031 ETH" on its own answers nothing: it is unclear whether that is
       a lot or whether everything stops tomorrow. So the balance is turned
       into epochs straight away — into the one thing this ether is for.

       The number of recipients comes from the latest holder snapshot:
       distribution is transfers, and there are more of them the more
       holders there are. While holders have not been read yet, the rules'
       ceiling is used (10,000 wallets): better to alarm early than to
       reassure wrongly. */
    let epochs = null, gasPriceWei = null;
    try {
      const g = await fetch(C.CHAIN.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
      });
      const gj = await g.json();
      if (typeof gj.result === 'string') {
        gasPriceWei = BigInt(gj.result);
        const hold = s.token
          ? (await q('select count from holders where token = $1 order by at desc limit 1',
                     [s.token])).rows[0]
          : null;
        const recipients = hold && Number.isFinite(Number(hold.count))
          ? Number(hold.count)
          : 10_000;
        const perEpoch = BigInt(gasForEpoch(recipients)) * gasPriceWei;
        if (perEpoch > 0n) epochs = Number(wei / perEpoch);
      }
    } catch (_) { /* without a gas price there is simply no runway in epochs */ }

    mark('gas', true, null, {
      eth, wei: wei.toString(), address: who, epochs,
      gasPriceWei: gasPriceWei === null ? null : gasPriceWei.toString(),
    });
  } catch (e) {
    mark('gas', false, e.message);
  }
}

/* ---------- launching ---------- */

/**
 * Every job spins on a timer of its own and catches its own errors. A
 * shared loop would mean that a fallen Blockscout stops the DexScreener
 * read — and they are connected by nothing except that both are free.
 */
export function startCollector() {
  const run = (fn, ms) => { fn(); setInterval(fn, ms); };
  run(collectBasket, EVERY.basket);
  run(collectSelf, EVERY.self);
  run(collectHolders, EVERY.holders);
  run(collectVault, EVERY.vault);
  run(collectGas, EVERY.gas);
}

export const jobs = { collectBasket, collectSelf, collectHolders, collectVault, collectGas };
