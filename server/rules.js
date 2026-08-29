/* =========================================================================
   The rules for writing settings.

   Moved out of the server into a file of its own for exactly one reason:
   so that it can be checked without bringing up either the server or the
   database. As long as a check needs everything running, nobody runs it.
   ========================================================================= */

import './../core.js';

const C = globalThis.SixpackCore;

/* An allowlist, not "whatever came in": otherwise the console will create
   any key at all in the database, and one day it will create a typo
   instead of an address — silently, and it will turn up only when the site
   shows a dash while the console is filled in. */
/* The operator's address lives in the settings too.

   Under the scheme adopted 29 August the operator is a personal wallet and
   the ether sits on it in advance: the fee is forwarded by hand and the
   wallet is topped up by hand. It used to refill itself from the fee it
   collected; now the balance will run out one day — and between "ran out"
   and "noticed" epochs simply stop closing, silently.

   So the server needs the address: it reads the balance and shows it on
   the console. There is no key here and there cannot be — address only,
   read only. */
export const WRITABLE = new Set(['token', 'vault', 'note', 'buy', 'operator']);

/* The buy link lives in the settings and not in the code.

   The address of a token page on Pons cannot be guessed: their storefront
   is a single-page application, the cards are opened by a script, and
   `/token/0x…` hands back that same front page. I checked this in a
   browser rather than assuming it.

   Baking in a guessed path means putting a "buy" button on the storefront
   that with some probability leads nowhere. On the previous project a
   button like that sent a buyer to a 404, and that is the worst possible
   first step there is.

   So: after the launch you open your own coin on Pons, copy the address
   out of the browser's bar and paste it into the console. While the field
   is empty there is no button at all — the same off switch as the one on
   the token address. */
const BUY_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i;

/**
 * Checks the body of a request to write settings.
 * Returns either { ok: true, clean } or { ok: false, error } with the
 * reason in human words — there must be no silent refusals.
 */
export function validateConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'an object with fields was expected' };
  }
  const entries = Object.entries(body);
  if (!entries.length) return { ok: false, error: 'nothing to change' };

  const clean = {};
  for (const [k, v] of entries) {
    if (!WRITABLE.has(k)) return { ok: false, error: 'the key "' + k + '" may not be written' };
    if (v !== null && v !== undefined && typeof v !== 'string') {
      return { ok: false, error: 'the field "' + k + '" must be a string' };
    }
    const val = (v ?? '').trim();

    /* The address is checked here and not only in the browser: the browser
       can be gone around, and a typo in the treasury address costs the
       launch. An empty string is allowed on purpose — it is the off
       switch: erase the address, the calculation goes dark, the site lives. */
    if ((k === 'token' || k === 'vault' || k === 'operator') && val !== '' && !C.isAddress(val)) {
      return { ok: false, error: 'the address "' + k + '" must be 0x and forty hex digits, characters given: ' + val.length };
    }
    if (k === 'note' && val.length > 500) {
      return { ok: false, error: 'the note is longer than five hundred characters' };
    }
    /* Only https and only something that looks like an address. The button
       leads outwards from our storefront: javascript: and data: must never
       get in here. */
    if (k === 'buy' && val !== '' && !BUY_RE.test(val)) {
      return { ok: false, error: 'the buy link must start with https:// and look like a page address' };
    }
    if (k === 'buy' && val.length > 300) {
      return { ok: false, error: 'the link is longer than three hundred characters' };
    }
    clean[k] = val;
  }
  return { ok: true, clean };
}


/* =========================================================================
   Who counts as "one and the same" when attempts are counted.

   Counting by the exact address turned out to be too fine-grained: a
   measurement showed that one and the same client comes in now from
   2.26.13.2, now from 2.26.13.4 — the exit has a pool of addresses. It
   ends up with twice as many attempts as it should have, and the counter
   silently stops being a counter. Behind a mobile carrier the address
   wanders in exactly the same way.

   So the key is the subnet: /24 for IPv4, /64 for IPv6. That is exactly
   the trade-off needed here: one's own pool of addresses collapses into a
   single counter, while the provider next door stays separate.
   ========================================================================= */
export function clientBucket(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '?';
  /* ::ffff:1.2.3.4 is an ordinary IPv4 wrapped in IPv6. */
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const addr = mapped ? mapped[1] : raw;

  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return v4[1] + '.' + v4[2] + '.' + v4[3] + '.0/24';

  if (addr.includes(':')) {
    /* The first four groups are the /64, the usual size of what is handed
       out to a single subscriber. We do not expand the shortened form: for
       a key it is enough that identical addresses give an identical key. */
    const head = addr.split(':').slice(0, 4).join(':');
    return head + '::/64';
  }
  return addr;
}
