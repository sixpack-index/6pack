/* =========================================================================
   6PACK. Layout and typography copy the original; the behavior is written
   from scratch: the shape spins in a real renderer, the numbers are read
   from the chain.

   The split that matters here:
     READ FROM THE CHAIN — the basket, prices, 24h change, liquidity,
       volumes. This is the truth.
     COMPUTED FROM THE MODEL — how much the vault would collect and how
       much a holder would get. Arithmetic on live numbers and one
       assumption, stated out loud.
     DOES NOT EXIST — the $6PACK price, holders, payout history. None of
       that is on the page: the site must not promise more than the code
       can do.
   ========================================================================= */

const BRAND = {
  name: '6PACK',         // project name, changed only here
  ticker: '6PACK',
};

/* The wallet lives in a separate file and cannot reach BRAND — so we put
   the ticker on window ourselves. wallet.js used to read
   `window.DimehoodBrand`, which nobody ever set, and silently showed the
   fallback name written into it: a second copy of the same thing, one that
   would have diverged on the first rename. */
window.SixpackBrand = BRAND.ticker;

/* Where this file lives.

   Needed for exactly one thing: loading stage.js on demand. A dynamic
   `import()` inside an ordinary (non-module) script resolves the path
   **relative to the page URL**, not to the script URL. While there is one
   page and it sits at the root there is no difference; on a page in a
   subfolder `./stage.js` turns into `/subfolder/stage.js`, which is not
   there, and the shape silently fails to start — what stays instead is the
   static drawing from the markup, and that looks like it is working.

   That is exactly what happened on the draft variants: the sphere was in
   place and not spinning, and it was invisible in a screenshot. So resolve
   from the script itself. */
const HERE = (document.currentScript && document.currentScript.src) || location.href;

/* The mechanics rules live in core.js — one set of numbers for the whole
   project: the calculator here computes from them, so does the epoch size
   on the server, and /docs describes those same ones in words. A copy here
   would mean two lists of the same thing; they diverge on the first patch,
   and silently. */
const MODEL = globalThis.SixpackCore.MODEL;

/* Seat weights in basis points: [1667, 1667, 1667, 1667, 1666, 1666].
   Computed by the core, not copied in here as numbers. */
const WEIGHTS = globalThis.SixpackCore.weightsBps();

/* The project accent is SIGNAL. It is also first in the list: both
   applyTheme and the reset take THEMES[0] as the default, so the order
   here is not cosmetic. */
const THEMES = [
  { id: 'signal',  label: 'SIGNAL',  c: '#00e05a', bg: '#06100a' },
  /* The first six sit next to Robinhood Chain's signature acid: its exact
     lime is already used by another project on this chain, so we take
     neighbours of it rather than a copy. */
  { id: 'lime',    label: 'LIME',    c: '#b8ff2b', bg: '#0c0f07' },
  { id: 'acid',    label: 'ACID',    c: '#9ef01a', bg: '#0a0e08' },
  { id: 'spring',  label: 'SPRING',  c: '#55e630', bg: '#070f08' },
  { id: 'mint',    label: 'MINT',    c: '#4fe0a0', bg: '#07100c' },
  { id: 'teal',    label: 'TEAL',    c: '#2fe0c8', bg: '#06100f' },
  /* Everything else follows. */
  { id: 'ice',     label: 'ICE',     c: '#66e8ff', bg: '#080d11' },
  { id: 'azure',   label: 'AZURE',   c: '#4d9dff', bg: '#070b12' },
  { id: 'violet',  label: 'VIOLET',  c: '#b98bff', bg: '#0b0912' },
  { id: 'magenta', label: 'MAGENTA', c: '#ff5cc8', bg: '#100913' },
  { id: 'rose',    label: 'ROSE',    c: '#ff4d6d', bg: '#110809' },
  { id: 'ember',   label: 'EMBER',   c: '#ff5b3d', bg: '#110a08' },
  { id: 'amber',   label: 'AMBER',   c: '#ffb02e', bg: '#100e0a' },
  { id: 'gold',    label: 'GOLD',    c: '#e8c547', bg: '#0f0e09' },
  { id: 'bone',    label: 'BONE',    c: '#e8e6e1', bg: '#0d0d0c' },
];


let BASKET = [];
let DISP = null;
let SELF = null;   // our token: fills in as soon as there is an address
let META = { source: null, scanned: 0, priced: 0, at: 0, failed: null, via: null, age: null };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* =========================================================================
   Formatting
   ========================================================================= */

const nf = (v, d = 0) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Money. Nobody should read 249999.99999999997 — on MAOMAO they did. */
function money(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + nf(v / 1e9, 2) + 'B';
  if (a >= 1e6) return '$' + nf(v / 1e6, 2) + 'M';
  if (a >= 1e3) return '$' + nf(v, 0);
  if (a >= 1)   return '$' + nf(v, 2);
  if (a > 0)    return '$' + nf(v, 4);
  return '$0';
}

/** Price: small values use a zero counter, as on exchanges and in the original. */
function price(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1) return '$' + nf(v, 2);
  if (v >= 0.0001) return '$' + Number(v.toPrecision(4));
  const [m, e] = v.toExponential(4).split('e');
  const zeros = Math.abs(Number(e)) - 1;
  const digits = m.replace('.', '').replace(/0+$/, '').slice(0, 4);
  const sub = String(zeros).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
  return '$0.0' + sub + digits;
}

const pct = (v, d = 2) => (v >= 0 ? '+' : '') + nf(v, d) + '%';

function units(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return nf(v / 1e6, 2) + 'M';
  if (v >= 1e3) return nf(v / 1e3, 1) + 'K';
  if (v >= 1)   return nf(v, 2);
  // Trailing zeros on fractions lie about precision: 0.29 is 0.29, not 0.2900.
  return String(Number(v.toPrecision(3)));
}

const esc = s => String(s ?? '').replace(/[<>&"]/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  return Math.round(s / 3600) + 'h ago';
}

/* =========================================================================
   Derived values
   ========================================================================= */
const totalLiq = () => BASKET.reduce((s, t) => s + t.liq, 0);
const totalVol = () => BASKET.reduce((s, t) => s + t.vol24, 0);

/** A constituent's weight is its share of the basket's liquidity. */
function weights() {
  const L = totalLiq();
  return L > 0 ? BASKET.map(t => t.liq / L) : BASKET.map(() => 1 / (BASKET.length || 1));
}

const NA = '—';


/* =========================================================================
   The shape in the stage. The renderer itself lives in stage.js and loads
   separately — together with three.js that is 670 KB, and there is no
   reason to pull it into the first screen.

   The startup order is taken from the original: wait until the stage shows
   up on screen, then for the visitor's first movement — or eight seconds
   of silence.
   ========================================================================= */
let stopStage = null;

/* API base for the stage: it pulls token icons through our proxy. Empty
   means the same domain — /api/* is rewritten to Railway via vercel.json.
   An absolute address is only needed when opening from file://, where
   there is no domain. */
const API_BASE = (location.protocol === 'file:')
  ? 'https://api-production-2cac.up.railway.app'
  : '';

/* The basket contents for the pack.

   The stage wakes on the visitor's first movement, and the basket arrives
   in its own time — the order of those two events is undefined. Hence a
   promise here rather than a value: if the basket is already there it is
   ready at once, and if it is not, the stage waits for it instead of
   assembling six nameless cans. */
function basketReady() {
  if (BASKET && BASKET.length) return Promise.resolve(BASKET);
  return new Promise(resolve => {
    let left = 40;                       // 40 × 250 ms = ten seconds
    const tick = setInterval(() => {
      if (BASKET && BASKET.length) { clearInterval(tick); resolve(BASKET); }
      else if (--left <= 0) { clearInterval(tick); resolve(null); }
    }, 250);
  });
}

function wireStage() {
  const stage = $('.stage');
  const pre = $('pre.ascii');
  const fps = $('.stage .cn.tr');
  if (!stage || !pre || !fps) return;

  const WAKE = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  let timer = 0;

  const unwatch = () => {
    WAKE.forEach(ev => window.removeEventListener(ev, boot));
    clearTimeout(timer);
  };

  function boot() {
    unwatch();
    import(new URL('stage.js?v=6', HERE).href)
      .then(m => { stopStage = m.start(stage, pre, fps, basketReady(), API_BASE); })
      .catch(e => {
        console.error('the shape did not load:', e);
        // A silent stage is not acceptable: let it say what happened.
        fps.textContent = 'no render';
      });
  }

  const io = new IntersectionObserver(es => {
    if (!es.some(x => x.isIntersecting)) return;
    io.disconnect();
    WAKE.forEach(ev => window.addEventListener(ev, boot, { passive: true, once: true }));
    timer = window.setTimeout(boot, 8000);
  }, { rootMargin: '200px' });
  io.observe(stage);
}

/* =========================================================================
   Tape
   ========================================================================= */
function paintTape() {
  if (!BASKET.length) return;
  const html = BASKET.map(t =>
    '<span class="tk"><b>' + esc(t.sym) + '</b>' +
    '<span class="p">' + price(t.price) + '</span>' +
    '<span class="' + (t.chg24 >= 0 ? 'up' : 'dn') + '">' + pct(t.chg24) + '</span></span>'
  ).join('');
  /* The tape only scrolls forever if one of its halves is wider than the
     screen.

     The trick: two identical halves, the tape travels exactly 50% and
     comes back — the seam is invisible because a copy sits in its place.
     But that works only while a half covers the whole screen. When the
     seats went from ten to six, a half shrank by almost half, and on a
     wide monitor emptiness opened up behind its tail: the tape literally
     "ran out" and kept scrolling empty.

     So the list is repeated as many times as it takes for a half to
     outgrow the screen. Not eyeballed: measure the width and pad until it
     is enough, with a ceiling in case the measurement returns zero (a
     hidden tab reports zero sizes, and the loop would never end). */
  $$('.tape-half').forEach(h => { h.innerHTML = html; });
  padTape();
}

/**
 * Pad the tape until it is endless.
 *
 * The two-halves trick works only while one half is wider than the
 * screen: the tape travels exactly 50% and comes back, and a copy sits in
 * the place of the seam. When the seats went from ten to six, a half
 * shrank by almost half, and on a wide monitor emptiness opened up behind
 * its tail — the tape literally ran out and kept scrolling empty.
 *
 * Called twice: right at load, from the markup, and again once the data
 * arrives. The first call matters no less than the second: if the chain is
 * slow to answer or never answers, the person is looking at a short tape
 * that whole time, and "no data yet" looks like "the site is broken".
 */
function padTape() {
  const halves = $$('.tape-half');
  const first = halves[0];
  if (!first) return;
  const seed = halves.map(h => h.innerHTML);
  if (!seed[0]) return;

  /* The ceiling is mandatory: in a hidden tab and before the fonts load
     the browser reports zero sizes, and a measurement loop would never
     have stopped. */
  const need = Math.max(window.innerWidth, 1) * 1.2;
  for (let k = 0; k < 8 && first.scrollWidth > 0 && first.scrollWidth < need; k++) {
    halves.forEach((h, i) => { h.innerHTML += seed[i]; });
  }
}

/* =========================================================================
   Section 1 — the summary. Eight cards; the headings and captions are his,
   word for word. All of them are about our token: market cap, the
   liquidity of its pool, its volume, holders, payouts. There is no token,
   so a dash everywhere except the clock. He does exactly this with holders
   himself: "— / not indexed yet".
   ========================================================================= */
function paintSummary() {
  const k = $$('.kpi');
  if (k.length < 8) return;

  const set = (el, key, val, sub) => {
    if (!el) return;
    $('.k', el).textContent = key;
    const v = $('.v', el);
    v.textContent = val;
    v.removeAttribute('data-cu');       // we do not need the original's counter
    $('.s', el).innerHTML = sub;
  };

  const S = SELF || {};
  const has = v => Number.isFinite(v) && v > 0;

  set(k[0], 'market cap', has(S.marketCap) ? money(S.marketCap) : NA,
      has(S.marketCap)
        ? '<b>' + nf(MODEL.supply) + '</b> supply, fully circulating'
        : 'no token deployed');

  set(k[1], 'liquidity', has(S.liq) ? money(S.liq) : NA,
      'across <b>' + (S.pools || '—') + '</b> pools');

  set(k[2], 'total volume', has(S.vol24) ? money(S.vol24) : NA,
      has(S.vol24) ? 'last 24h' : 'not trading yet');

  set(k[3], BRAND.name.toLowerCase() + ' holders',
      Number.isFinite(S.holders) ? nf(S.holders) : NA,
      Number.isFinite(S.holders) ? 'read from the explorer' : 'not indexed yet');

  const paid = (S.epochs || []).length;
  set(k[4], 'dividends paid out', NA,
      'across <b>' + (paid || '—') + '</b> epochs, in kind');
  set(k[5], 'last epoch paid', NA, '<b>—</b> per constituent, equal weight');
  set(k[6], 'eligible supply', NA, '<b>—</b> qualified at snapshot');

  // The clock really runs; tick() drives it. The caption is his.
  $('.k', k[7]).textContent = 'next distribution';
  $('.s', k[7]).innerHTML =
    'checked every <b>three hours</b> · closes once the pot covers settlement';

  // 24h dispersion belongs to the basket — computed here, shown there.
  const best = BASKET.length ? BASKET.reduce((a, b) => (b.chg24 > a.chg24 ? b : a)) : null;
  const worst = BASKET.length ? BASKET.reduce((a, b) => (b.chg24 < a.chg24 ? b : a)) : null;
  DISP = best ? { pts: nf(best.chg24 - worst.chg24, 0), best, worst } : null;
}

/* =========================================================================
   Section 2 — the basket. On his left: how much was handed out over nine
   epochs; we have no epochs, so a dash. On the right, two metrics about
   the basket pools themselves: 24h volume and dispersion. Those are read
   from the chain both for him and for us — so we show them live.
   ========================================================================= */
function paintBasket() {
  const big = $('.big-g');
  if (!big) return;

  const hdrs = $$('.hdr span', big);
  const nums = $$('.n-xxl, .n-xl, .n-l', big);
  const fns = $$('.fn', big);

  const rows = [
    ['distributed to holders', NA,
     'across <b>—</b> settled epochs · ' + MODEL.seats + ' constituents · <b>equal weight</b>, '
     + nf(100 / MODEL.seats, 1) + '% each'],
    ['eligible supply, last epoch', NA, '<b>—</b> of supply qualified at the snapshot'],
    ['24h basket volume', BASKET.length ? money(totalVol()) : NA, 'across all six pools'],
    ['dispersion, 24h', DISP ? DISP.pts + 'pts' : NA,
     DISP ? 'best <b>' + pct(DISP.best.chg24, 2) + '</b> · worst <b>' + pct(DISP.worst.chg24, 2) + '</b>'
          : 'reading chain…'],
  ];
  rows.forEach((r, i) => {
    if (hdrs[i]) hdrs[i].textContent = r[0];
    if (nums[i]) { nums[i].textContent = r[1]; nums[i].removeAttribute('data-cu'); }
    if (fns[i]) fns[i].innerHTML = r[2];
  });

  // The "last epoch" and "all epochs" bars: there were no epochs, so empty.
  $$('.bvm .lb').forEach((lb, i) => {
    lb.innerHTML = '<span>' + (i ? 'all epochs' : 'last epoch') + '</span><b>' + NA + '</b>';
    const trk = lb.parentElement.querySelector('.trk i');
    if (trk) { trk.style.width = '0%'; trk.removeAttribute('data-fill'); }
  });
}

/* =========================================================================
   Section 3 — the calculator
   ========================================================================= */
const MIN_HOLD = 100_000, MAX_HOLD = 500_000_000;

/* Rounding to a "round" number: one significant digit, step 1 / 2.5 / 5.
   Someone dragging the slider expects 10,000,000, not 9,970,000 — and an
   unround number reads as a bug, not as precision. */
function roundNice(v) {
  if (!Number.isFinite(v) || v <= 0) return MIN_HOLD;
  const mag = 10 ** Math.floor(Math.log10(v));
  const r = v / mag;
  const step = r < 1.5 ? 0.1 : r < 3 ? 0.25 : 0.5;
  return Math.round(v / (mag * step)) * (mag * step);
}

const s2a = s => {
  const lo = Math.log10(MIN_HOLD), hi = Math.log10(MAX_HOLD);
  const raw = 10 ** (lo + (hi - lo) * (s / 1000));
  return Math.min(Math.max(roundNice(raw), MIN_HOLD), MAX_HOLD);
};
const a2s = a => {
  const lo = Math.log10(MIN_HOLD), hi = Math.log10(MAX_HOLD);
  const c = Math.min(Math.max(a, MIN_HOLD), MAX_HOLD);
  return Math.round(((Math.log10(c) - lo) / (hi - lo)) * 1000);
};

/* How many coins are in the calculator right now.

   Kept separately from the slider position, and that is not a redundant
   variable. The slider is discrete: a thousand steps on a logarithmic
   scale. Clicking "1M" set the position, and what got shown was whatever
   was computed back out of that position — 997,000 instead of a million.
   The exact value now lives here, and the slider stays what it always was:
   a way to change it. */
let HOLD = 19_650_000;

/** Set the amount from outside: a chip, a wallet balance, anything. */
function setHold(amount, { moveSlider = true } = {}) {
  HOLD = Math.min(Math.max(Number(amount) || 0, 0), MAX_HOLD);
  const input = $('.calc input[type="range"]');
  if (input && moveSlider) input.value = a2s(HOLD);
  paintCalc();
}

function paintCalc() {
  const input = $('.calc input[type="range"]');
  if (!input) return;
  const amount = HOLD;
  /* The core computes it — the same thing the server computes, and the
     thing the tests check. All that is left here is to display it. While
     the formula lived in this function, swapping a multiplier inside it
     slipped past every check. */
  const D = globalThis.SixpackCore.dividendFor(amount, SELF && SELF.vol24, SELF && SELF.price);

  /* Leave the input field alone while someone is typing in it: rewriting
     the text moves the caret to the end, and typing a number longer than
     two digits becomes impossible. */
  const field = $('.calc-amount');
  if (field && document.activeElement !== field) field.value = nf(amount);
  const unit = $('.calc-unit');
  if (unit) unit.textContent = BRAND.ticker;
  input.setAttribute('aria-valuetext', nf(amount) + ' ' + BRAND.ticker);

  const put = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  put('.cs-value', D.value ? money(D.value) : NA);
  put('.cs-share', nf(D.share * 100, 3) + '%');

  /* Three horizons instead of one. Per epoch is what actually gets paid;
     per day and per thirty days are what a person is really asking about
     when looking at a three-hour payout. The core computes all three. */
  put('.calc-big', D.mine === null ? NA : money(D.mine));
  put('.cs-day', D.perDay === null ? NA : money(D.perDay));
  put('.cs-30d', D.per30d === null ? NA : money(D.per30d));
  put('.cs-yield', D.yieldPerEpoch === null ? NA : nf(D.yieldPerEpoch * 100, 2) + '%');
  put('.cs-apr', D.yieldAnnual === null ? NA : nf(D.yieldAnnual * 100, 0) + '%');
  put('.calc-per', 'per epoch · every ' + MODEL.epochHours + 'h');

  const caveat = $('.caveat');
  if (caveat) {
    caveat.innerHTML = D.mine === null
      ? '<b>No token address is set,</b> so there is no volume to compute from. '
        + 'The moment the contract is live this fills in by itself.'
      : '<b>Model, not a record.</b> Computed from live 24h volume at the '
        + 'published rate: the pool charges ' + nf(MODEL.poolFeeBps / 100, 0)
        + '%, the venue keeps ' + nf(MODEL.venueShare * 100, 0)
        + '% of it, and the remaining ' + nf(MODEL.wedgeBps / 100, 1)
        + '% goes to holders in full, split six ways every ' + MODEL.epochHours
        + ' hours. Day and month figures assume this volume holds. '
        + 'No epoch has settled yet.';
  }

  /* The per-token breakdown: the wedge is split evenly across the six
     seats — "equal weight", as in the rules. The coin amounts are computed
     from each constituent's live price. */
  const perSeat = D.perSeat;

  $$('.crow').forEach((row, i) => {
    const t = BASKET[i];
    if (!t) { row.hidden = true; return; }
    row.hidden = false;
    const name = $('span > b', row);
    if (name) name.textContent = t.sym;
    const q = $('.q', row), d = $('.d', row);
    if (q) q.textContent = perSeat === null ? NA : units(perSeat / t.price);
    if (d) d.textContent = perSeat === null ? NA : money(perSeat);
    setRowIcon(row, t);
  });
}

/* =========================================================================
   FONTS AND THE OLD SWITCHES

   Five switches used to live here: ?bg= for the card texture, ?fig= for
   the shape, ?render= for the display method, ?type= and ?mono= for the
   fonts. They were needed while the decisions were being made by eye on a
   live page: arguing about texture over messages is pointless, you have to
   see it.

   The decisions are made: foil, a six-can pack, Azeret Mono. Everything
   surplus is deleted — every unused variant is code you have to avoid
   breaking with any nearby edit, for the sake of a look nobody will see.

   WHY THE KEYS ARE ERASED. The choice was remembered in localStorage, and
   that memory outlives a deploy. For anyone who had ever opened
   `?render=ascii`, the browser remembered "ascii" — and after the
   parameters were removed they would still have seen the old shape made of
   characters instead of the pack. That is exactly what happened. To stop
   reading the keys is not enough; they have to be removed.
   ========================================================================= */
(function forgetOldChoices() {
  try {
    for (const k of ['sixpack.bg', 'sixpack.fig', 'sixpack.render',
                     'sixpack.type', 'sixpack.mono']) {
      localStorage.removeItem(k);
    }
  } catch (_) { /* private mode — there was nowhere to store it anyway */ }
})();

(function loadFonts() {
  /* preconnect before the link itself: without it the browser first
     resolves the domain and shakes hands, and only then finds out it needs
     a font. */
  for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    const l = document.createElement('link');
    l.rel = 'preconnect'; l.href = href;
    if (href.includes('gstatic')) l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@300;400;500&display=swap';
  document.head.appendChild(link);
})();

/**
 * The real token icon in the breakdown row under the calculator.
 *
 * The rows read as mini-cards of the same basket as the six big ones
 * above — so the coin in them has to be the same one, not our abstract
 * mark. The mark stays underneath the image and becomes visible by itself
 * if the image did not load.
 *
 * The two traps here are exactly the ones from the big cards, and both
 * cost an evening — so they are repeated word for word, not "from memory":
 *
 *   1. The redraw key is the symbol AND the image URL. Keyed on the symbol
 *      alone, the row recorded "drawn" on the first read, where there were
 *      no icons yet, and skipped the next read — the one with the icon.
 *   2. No loading="lazy". The image is created outside the document and
 *      only enters it after onload; a lazy image does not load until it is
 *      in the document, which means it never loads. No event arrives at
 *      all — neither onload nor onerror — and the console is empty.
 */
/* =========================================================================
   TOKEN TONE

   The icon window on a card is painted in the token's own color, pushed
   into shadow. The color is stored nowhere and cannot be written in by
   hand: the basket contents change every three hours, and a list of six
   colors would be stale the same day. So it has to be MEASURED from the
   icon itself.

   THE MAIN RULE: a color counts only if there is A LOT of it in the icon.

   The first version took the most saturated hue, and on CASHCAT that gave
   brown — even though the icon is almost entirely white. The measurement
   explains why: colored pixels there are 11.5% at saturation 0.17, meaning
   all of that "color" is fur and shadows on a white photo. For comparison,
   STONKBROKER is 54% colored at saturation 1.00, DOGO — 25% at 0.90.

   So what decides is the share multiplied by the saturation:
     STONKBROKER 0.54 × 1.00 = 0.54     AI      0.73 × 0.34 = 0.25
     DOGO        0.25 × 0.90 = 0.23     PIPEDOG 0.23 × 0.39 = 0.09
     CASHCAT     0.12 × 0.17 = 0.02     PONS    0.00        = 0.00
   A threshold of 0.05 cuts off CASHCAT and PONS and keeps PIPEDOG, whose
   brown is honest — it is a dog's fur filling the whole icon. The gap
   between CASHCAT and PIPEDOG is almost fivefold, so the threshold is not
   borderline.

   HOW THE HUE IS COMPUTED. The icon is scaled down to 32×32. Pixels that
   lie about color are dropped: near-gray ones (channel spread under 0.12),
   near-black and near-white ones — their "hue" is compression noise — and
   transparent ones. The rest are spread across twenty-four hue bins
   weighted by saturation, and inside the winning bin the hue is averaged
   ON A CIRCLE, through sine and cosine: a plain average of 350° and 10°
   would give 180°, turning red into turquoise.

   The saturation of the result is taken from the measurement too, not set:
   a weak color has to come out muted, otherwise a pale icon gets a window
   as bright as STONKBROKER's.

   The icon must go through our /api/icon: a third-party CDN does not send
   CORS, and getImageData on a tainted canvas throws instead of giving a
   color.
   ========================================================================= */
const TONES = new Map();

/* The "there is enough color in the icon" threshold. Derived from
   measuring the six basket icons, see the table above. */
const TONE_MIN = 0.05;

/* The neutral tone is written with theme variables, not numbers: there are
   fifteen themes, and the gray window has to be gray in the tone of the
   current one. */
const NEUTRAL_TONE = {
  base: 'color-mix(in srgb, var(--color-block-2) 62%, #000)',
  hi:   'color-mix(in srgb, var(--color-block) 70%, transparent)',
};

function dominantTone(img) {
  const N = 32;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return NEUTRAL_TONE;

  let px;
  try {
    g.drawImage(img, 0, 0, N, N);
    px = g.getImageData(0, 0, N, N).data;
  } catch (_) {
    return NEUTRAL_TONE;               // canvas tainted — at least a flat tone
  }

  const BINS = 24;
  const w = new Float64Array(BINS), hx = new Float64Array(BINS), hy = new Float64Array(BINS);
  const sats = [];
  let opaque = 0;

  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < .5) continue;
    opaque++;

    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
    if (d < .12) continue;                       // gray
    const l = (mx + mn) / 2;
    if (l < .06 || l > .96) continue;            // near-black and near-white

    const s = d / (1 - Math.abs(2 * l - 1));
    sats.push(s);

    let hh;
    if (mx === r) hh = ((gg - b) / d + 6) % 6;
    else if (mx === gg) hh = (b - r) / d + 2;
    else hh = (r - gg) / d + 4;
    hh *= 60;

    const k = Math.floor(hh / (360 / BINS)) % BINS;
    w[k] += s;
    hx[k] += Math.cos(hh * Math.PI / 180) * s;
    hy[k] += Math.sin(hh * Math.PI / 180) * s;
  }

  if (!opaque || !sats.length) return NEUTRAL_TONE;

  /* Median, not mean: one bright red pixel on a white photo would shift
     the mean noticeably, the median it would not. */
  sats.sort((a, b) => a - b);
  const medS = sats[sats.length >> 1];
  const share = sats.length / opaque;
  if (share * medS < TONE_MIN) return NEUTRAL_TONE;

  let best = 0;
  for (let k = 1; k < BINS; k++) if (w[k] > w[best]) best = k;
  const hue = (Math.atan2(hy[best], hx[best]) * 180 / Math.PI + 360) % 360;
  const sat = Math.round(Math.min(70, Math.max(14, medS * 90)));

  /* The lightness is set here, not taken from the icon. The card is dark,
     and the window has to stay dark no matter how bright the token is:
     otherwise a glowing rectangle would hang next to a black card. */
  return {
    base: `hsl(${hue.toFixed(0)} ${sat}% 9%)`,
    hi:   `hsl(${hue.toFixed(0)} ${Math.min(78, sat + 8)}% 21%)`,
  };
}

function tokenTone(url) {
  if (!url) return Promise.resolve(null);
  if (TONES.has(url)) return TONES.get(url);
  const p = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(dominantTone(img));
    img.onerror = () => resolve(null);
    img.src = API_BASE + '/api/icon?u=' + encodeURIComponent(url);
  });
  TONES.set(url, p);
  return p;
}

function setRowIcon(row, t) {
  const host = $('.sv', row);
  if (!host) return;
  if (host.dataset.sym === t.sym && host.dataset.icon === (t.icon || '')) return;
  host.dataset.sym = t.sym;
  host.dataset.icon = t.icon || '';
  host.classList.remove('has-icon');
  const old = $('img', host);
  if (old) old.remove();
  if (!t.icon) return;

  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => { host.classList.add('has-icon'); host.appendChild(img); };
  img.onerror = () => { /* our mark stays */ };
  img.src = t.icon;
}

function wireCalc() {
  const input = $('.calc input[type="range"]');
  if (!input) return;

  /* Typing by hand. The slider is logarithmic and rounds to round numbers
     — you cannot enter "19,650,000" with it, and that is exactly how many
     coins the person is holding. Before this field existed, the only way
     to set your own number was the four presets. */
  const field = $('.calc-amount');
  if (field) {
    const read = () => {
      const raw = field.value.replace(/[^\d]/g, '');
      const n = Number(raw || 0);
      HOLD = Math.min(Math.max(n, 0), MAX_HOLD);
      input.value = a2s(HOLD);
      paintCalc();
    };
    field.addEventListener('input', read);
    /* On leaving the field, draw the separators back in and clamp to the
       bounds: show the correction right away rather than silently changing
       the number under someone's fingers. */
    field.addEventListener('blur', () => {
      HOLD = Math.min(Math.max(HOLD, 0), MAX_HOLD);
      field.value = nf(HOLD);
      paintCalc();
    });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') field.blur(); });
  }
  /* The slider is the source of the value only while it is being dragged.
     The rest of the time the value is exact and comes from outside. */
  input.addEventListener('input', () => { HOLD = s2a(Number(input.value)); paintCalc(); });
  const map = [1e6, 1e7, 5e7, 2.5e8];
  $$('.chip').forEach((chip, i) => {
    chip.addEventListener('click', () => {
      setHold(map[i]);
      $$('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
    });
  });
}

/* =========================================================================
   Section 4 — the basket cards
   ========================================================================= */

/** A sparkline from what is actually known: the 5m, 1h, 6h, 24h changes. */
function sparkPoints(t) {
  const past = [t.chg24, t.chg6, t.chg1, t.chg5, 0];
  const vals = past.map(c => 1 / (1 + (c || 0) / 100));   // price relative to the current one
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  return vals.map((v, i) =>
    (i * (100 / (vals.length - 1))).toFixed(1) + ',' +
    (35 - ((v - min) / span) * 30).toFixed(1)
  ).join(' ');
}

function paintBasketCards() {
  const cards = $$('.tc');
  const w = weights();
  cards.forEach((card, i) => {
    const t = BASKET[i];
    /* A seat without data is not hidden. A hidden card reads as "there are
       five of them" — on a site with a six in its name that is the first
       thing a person notices, and they will be right: what went missing is
       not decoration, it is a basket position. The seat stays and says
       that it is being read. */
    if (!t) {
      card.hidden = false;
      card.classList.add('waiting');
      const bw = $('.tc-top b', card);
      if (bw) bw.textContent = '—';
      const nw = $('.nm', card);
      if (nw) nw.textContent = 'reading chain…';
      const pw = $('.pr', card);
      if (pw) pw.textContent = NA;
      const rkw = $('.rk', card);
      if (rkw) rkw.innerHTML = String(i + 1).padStart(2, '0') + '<b>/' + MODEL.seats + '</b>';
      card.onclick = null;
      card.style.cursor = 'default';
      return;
    }
    card.hidden = false;
    card.classList.remove('waiting');

    const b = $('.tc-top b', card);
    if (b) b.textContent = t.sym;
    /* The number with a denominator: "01" on its own does not say out of
       how many. The denominator comes from the model rather than being
       typed in as a six — a typed number would survive a change of basket
       size and lie silently. */
    const rk = $('.rk', card);
    if (rk) rk.innerHTML = String(i + 1).padStart(2, '0') + '<b>/' + MODEL.seats + '</b>';
    const nm = $('.nm', card);
    if (nm) nm.textContent = t.name;
    const pr = $('.pr', card);
    if (pr) pr.textContent = price(t.price);

    const ch = $('.ch span:first-child', card);
    if (ch) {
      ch.className = t.chg24 >= 0 ? 'up' : 'dn';
      ch.textContent = (t.chg24 >= 0 ? '▲ ' : '▼ ') + pct(t.chg24);
    }
    /* The card art is the real token icon, not our abstract mark. That is
       what turns a table row into a card: a card needs an object people
       recognize.

       The icons live on third-party CDNs (DexScreener and CoinGecko via
       the explorer), and every one of them has to be treated as one that
       will not load: the domain goes down, the image gets deleted, a new
       basket constituent has none at all. So our mark always sits under
       the image, and it is what stays alone if onerror fired. An empty
       frame instead of art looks like broken layout, not like "there is no
       icon". */
    let art = $('.tc-art', card);
    if (!art) {
      art = document.createElement('span');
      art.className = 'tc-art';
      art.setAttribute('aria-hidden', 'true');
      card.insertBefore(art, card.firstChild);
    }
    /* Compare both the symbol and the icon URL. At first it was the symbol
       alone, and the icons never appeared at all: the first read came from
       the database, where the records had been written before icons were
       being collected. The card recorded "PIPEDOG is drawn" and on the
       next read — the one with the icon — decided there was nothing to
       redraw. The data arrived later than the rendering decided it was
       finished. */
    if (art.dataset.sym !== t.sym || art.dataset.icon !== (t.icon || '')) {
      art.dataset.sym = t.sym;
      art.dataset.icon = t.icon || '';
      art.classList.remove('has-icon');
      const mark = $('.tc-top .sv svg', card);
      art.innerHTML = '<span class="tc-art-in">' + (mark ? mark.outerHTML : '') + '</span>';
      if (t.icon) {
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        /* No loading="lazy", and that is not an oversight.

           The image is created outside the document and only enters it
           after onload. The browser defers loading lazy images until they
           are in the markup near the viewport — and this one never gets
           there, because it is waiting on its own onload. Measured: with
           lazy no event arrives at all, neither onload nor onerror, and
           the card stands forever with the mark instead of the icon.

           No error, no trace in the console: it looks exactly like "there
           is no icon". */
        /* Show it only after a successful load: an <img> inserted straight
           away with a broken URL draws the broken-image icon on top of our
           mark — worse than showing nothing. */
        img.onload = () => { art.classList.add('has-icon'); art.appendChild(img); };
        img.onerror = () => { /* the mark stays */ };
        img.src = t.icon;

        /* The window tone is the measured color of the icon itself. The
           dataset check before applying it is mandatory: the basket is
           re-read every minute, and by the time the color is computed a
           different token may already be in this card. It would then get
           somebody else's color. */
        const want = t.icon;
        tokenTone(want).then(tone => {
          if (!tone || art.dataset.icon !== want) return;
          card.style.setProperty('--tone', tone.base);
          card.style.setProperty('--tone-hi', tone.hi);
          card.classList.add('has-tone');
        });
      } else {
        card.classList.remove('has-tone');
      }
    }

    const poly = $('.spark polyline', card);
    if (poly) poly.setAttribute('points', sparkPoints(t));

    /* Equal weight is a rule of the basket, not a measurement. The number
       comes from weightsBps: six seats do not divide into ten thousand
       basis points, so the top seats get one point more. Typing "16.67%"
       by hand would lie by four hundredths and diverge from the contract. */
    const bar = $('.wbar .t i', card);
    if (bar) bar.style.width = (w[i] * 100).toFixed(1) + '%';
    const em = $('.wbar + em, .tc-foot em', card);
    if (em) em.textContent = nf(WEIGHTS[i] / 100, 2) + '%';
    /* The footer holds the pool liquidity, which is exactly what the seat
       was given for. There used to be a dash here in place of "how much
       was bought": honest but useless — nothing will be bought before the
       first epoch, while the basket seat is earned already, and the depth
       shows it. */
    const val = $('.val', card);
    if (val) val.textContent = t.liq > 0 ? money(t.liq) : NA;

    // The card leads to the explorer: check the address without trusting the page.
    card.style.cursor = 'pointer';
    card.onclick = () => window.open(t.url, '_blank', 'noopener');
    card.title = t.address;
  });

  const foot = $('.tc-foot-note') || null;
  if (foot) foot.textContent = 'scanned ' + META.scanned + ' tokens · ' + META.priced + ' priced';
}

/* =========================================================================
   Section 5 — the ledger. There were no payouts, so there are no rows and
   inventing them is not allowed. The empty state says why it is empty.
   ========================================================================= */
/**
 * The captions in the section footers. In the original they carry his
 * totals — "total cost $312,880", "5 epochs", "paid in kind … total
 * $128,470". We have none of those numbers, and leaving them would mean
 * promising more than the code can do.
 */
function paintFootlines() {
  /* We do not rewrite his captions — they are part of the layout. Only
     the spots with his numbers change: where he has the money of settled
     epochs, we have a dash. Match against the whole text: the captions are
     written with <b> inside, and a filter for nodes without children
     skipped them — three numbers went on standing at the bottom of the
     calculator, the basket and the ledger. */
  const swap = (re, text) => {
    $$('.corners span, .mid, .ann, .fn, .btm span').forEach(el => {
      if (el.closest('.prev') || $('.src', el)) return;
      if (re.test(el.textContent.trim())) el.innerHTML = text;
    });
  };
  const spot = SELF && SELF.price;
  swap(/^supply [\d,]+ · spot .*/i,
       'supply <b>' + nf(MODEL.supply) + '</b> · spot <b>' +
       (spot ? price(spot) : '—') + '</b>');
  swap(/^last epoch bought .*/i, 'last epoch bought <b>—</b> · <b>—</b> per seat');
  swap(/^total \$[\d,]+$/i, 'total <b>—</b>');
  swap(/^constituents · as of.*/i,
       'constituents · as of ' + new Date().toISOString().slice(0, 10));
  swap(/^\d+ epochs?$/i, '— epochs');
}

function paintLedger() {
  const rows = $$('.lr');
  if (!rows.length) return;
  const head = rows[0];                       // the table header
  rows.slice(1).forEach(r => r.remove());
  head.insertAdjacentHTML('afterend',
    '<div class="ledger-empty"><b>No epochs yet.</b> ' +
    'Nothing has been paid, so there is nothing to file. The first row appears ' +
    'once the vault takes its first fee — and it will be a transaction hash on ' +
    'Robinhood Chain, not a number typed into this page.</div>');
  head.remove();                              // a header with no rows reads as breakage

  const ann = $$('.ann').find(el => /epochs?$/i.test(el.textContent.trim()));
  if (ann) ann.textContent = 'none yet';
}

/* =========================================================================
   The epoch clock. Counted from real UTC, not from a variable somebody
   will forget to move.
   ========================================================================= */
function tick() {
  const k = $$('.kpi')[7];   // the eighth card, last one across the two rows
  if (!k) return;
  const now = new Date();
  const ms = MODEL.epochHours * 3600 * 1000;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const left = ms - ((now.getTime() - start) % ms);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('.v', k).textContent = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/* =========================================================================
   Source status — out loud, not in the console
   ========================================================================= */
function paintStatus() {
  let box = $('.src');
  if (!box) {
    box = document.createElement('span');
    box.className = 'src';
    box.innerHTML = '<i class="dot"></i><span class="txt"></span>';
    /* The original has "index · rotating" in the corner of the stage — we
       do not take that spot. The source badge lives in the tag next to the
       first section's heading, beside his text rather than instead of it:
       clearing out somebody else's node means erasing the very thing the
       layout was copied for. */
    const host = $('.prev') || $('.corners');
    if (host) host.appendChild(box); else document.body.appendChild(box);
  }
  const txt = $('.txt', box);
  if (META.failed) {
    box.className = 'src bad';
    txt.textContent = '· chain did not answer';
    return;
  }
  if (!BASKET.length) { box.className = 'src'; txt.textContent = '· reading…'; return; }
  box.className = 'src ok';
  const bits = [];
  if (META.source === 'fallback') bits.push('partial list');
  /* Who went for the data is part of the truth about it. When the service
     is unavailable the page reads the chain itself: it works the same, but
     third-party free APIs fail more often, and "partial list" is then not
     an accident but a consequence. Staying quiet about it means passing
     one off as the other. */
  if (META.via === 'direct') bits.push('read in-browser');
  /* Show the server-side age: if the collector is stuck, "2s ago" by the
     browser clock would lie about freshness — the page refreshed, not the
     data. */
  const seenMs = Number.isFinite(META.age) ? Date.now() - META.age : META.at;
  bits.push(ago(seenMs));
  txt.textContent = '· ' + bits.join(' · ');
}

/* =========================================================================
   The palette. Temporary: once the accent is picked, the panel and the
   surplus themes go away.
   ========================================================================= */
const THEME_KEY = 'sixpack.theme';

function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(THEME_KEY, id); } catch (_) { /* private mode */ }
  const t = THEMES.find(x => x.id === id) || THEMES[0];
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t.bg;
  $$('.pal-item').forEach(el =>
    el.setAttribute('aria-pressed', String(el.dataset.pal === id)));
  const now = $('.pal-now');
  if (now) now.textContent = t.label;
}

function wirePalette() {
  const pal = document.createElement('aside');
  pal.className = 'pal';
  /* The attribute is data-pal, not data-theme: the theme selectors match
     [data-theme] and would repaint every button in its own theme. */
  pal.innerHTML =
    '<div class="pal-list">' +
    THEMES.map(t =>
      '<button type="button" class="pal-item" data-pal="' + t.id + '" ' +
      'aria-pressed="false" title="' + t.label + '" aria-label="' + t.label + '" ' +
      'style="--sw-bg:' + t.bg + ';--sw-neon:' + t.c + '"></button>').join('') +
    '</div><div class="pal-meta"><span class="pal-now"></span>' +
    '<span>' + THEMES.length + ' themes</span>' +
    '<button type="button" aria-label="Close palette">✕</button></div>';
  document.body.appendChild(pal);

  $$('.pal-item', pal).forEach(el =>
    el.addEventListener('click', () => applyTheme(el.dataset.pal)));
  $('.pal-meta button', pal).addEventListener('click', () => { pal.hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') pal.hidden = true;
    if (e.key === 'p' && !/input|textarea/i.test(e.target.tagName)) pal.hidden = !pal.hidden;
  });

  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  applyTheme(THEMES.some(t => t.id === saved) ? saved : THEMES[0].id);
}

/* =========================================================================
   The X and GitHub links. The accounts do not exist yet, so the buttons
   say so honestly instead of leading nowhere. Once the addresses exist,
   put them in SOCIAL and the buttons become ordinary links; nothing else
   needs changing.
   ========================================================================= */
const SOCIAL = {
  x: '',        // https://x.com/…
  github: '',   // https://github.com/…
};

function wireSocial() {
  $$('.soc').forEach(el => {
    const key = el.dataset.soc;
    const href = SOCIAL[key];
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; return; }
    el.classList.add('soon');
    el.addEventListener('click', e => {
      e.preventDefault();
      /* On an icon button there is no text to swap out — it has none. So
         "soon" is said with a tooltip and a short blink of the border
         rather than a substituted string: the button must not behave
         silently. */
      const icon = !el.textContent.trim();
      if (icon) {
        const was = el.getAttribute('title');
        el.setAttribute('title', 'link goes live at launch');
        el.classList.add('blink');
        setTimeout(() => { el.classList.remove('blink'); if (was) el.setAttribute('title', was); }, 1400);
        return;
      }
      const prev = el.textContent;
      el.textContent = 'SOON';
      setTimeout(() => { el.textContent = prev; }, 1400);
    });
  });
}

/* The wallet lives in wallet.js: connecting, the network, balances. All we
   do here is hand it the button. It used to answer honestly with "NO
   CONTRACT YET" — that was true while there was nothing to connect to, but
   the network and gas exist without our token too, and looking at them is
   already useful. */
function wireConnect() {
  if (window.SixpackWallet) {
    window.SixpackWallet.wire();
    window.SixpackWallet.restore();
  }
}

/* The wallet feeds the real balance in here — once; after that the person
   moves the slider themselves. What we expose is a function, not the
   slider itself: let the rule for how a number turns into a position stay
   in one place. */
window.SixpackCalc = function (amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  /* The wallet balance goes in as-is, without rounding: it is their real
     number, and swapping it for a "pretty" one is not allowed. */
  setHold(Math.min(amount, MODEL.supply));
  $$('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
};

/* The contract address under the heading: the first thing people look for
   when they arrive from an exchange or a feed. It appears together with
   the address and disappears without it — an empty "contract: —" line
   helps nobody.

   The copy button has to respond to a press. On loothood the same button
   lived for a month looking flawless and copying nothing: nobody saw the
   error, because it stayed silent. */
function paintContract() {
  const box = $('.ca');
  if (!box) return;
  const token = window.SixpackChain.launchAddress('token');
  if (!token) { box.hidden = true; return; }
  box.hidden = false;
  const v = $('.ca-v', box);
  const scan = $('.ca-scan', box);
  if (v) v.textContent = token;
  if (scan) scan.href = window.SixpackChain.CHAIN.explorer + '/token/' + token;
}

function wireContract() {
  const btn = $('.ca-copy');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const token = window.SixpackChain.launchAddress('token');
    if (!token) return;
    const say = (text, ok) => {
      const prev = btn.textContent;
      btn.textContent = text;
      btn.classList.toggle('bad', !ok);
      setTimeout(() => { btn.textContent = prev; btn.classList.remove('bad'); }, 1400);
    };
    try {
      await navigator.clipboard.writeText(token);
      say('copied', true);
    } catch (_) {
      /* The clipboard is closed off — for example, the page is not served
         over https. Then select the text so the person can copy it
         themselves instead of guessing. */
      const v = $('.ca-v');
      if (v) {
        const r = document.createRange();
        r.selectNodeContents(v);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        say('select+C', false);
      } else say('copy failed', false);
    }
  });
}

/* The buy link. It appears only once the token address is known: a "buy"
   button that leads nowhere is worse than no button — on the previous
   project one like it sent a buyer to a 404. */
function paintBuy() {
  const token = window.SixpackChain.launchAddress('token');
  const url = window.SixpackChain.buyLink();
  let a = $('.acts .btn.buy');
  /* No token address or no link means no button.

     The link now appears by itself: as soon as the token has a pool,
     chain.js assembles the address of its page on the venue. Before, there
     was no button until somebody typed the link into the console by hand,
     and that made the launch depend on whether a live person remembered it
     in the first minutes.

     It stays empty here only until launch — while there is no pool yet. */
  if (!token || !url) { if (a) a.remove(); return; }
  if (!a) {
    a = document.createElement('a');
    a.className = 'btn f buy';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Buy $' + BRAND.ticker;
    const acts = $('.acts');
    if (acts) acts.insertBefore(a, acts.firstChild);
  }
  a.href = url;
}

/* =========================================================================
   Assembly
   ========================================================================= */
function paintAll() {
  paintTape();
  paintSummary();
  paintBasket();
  paintBasketCards();
  paintCalc();
  paintFootlines();
  paintBuy();
  paintContract();
  paintStatus();
}

async function load() {
  /* Our own token is read separately and silently: while there is no
     address it returns an object of zeros and the page shows dashes. Put
     the address in and the same fields fill from the chain; nothing else
     needs editing. */
  window.SixpackChain.readLaunch(part => { SELF = part; paintAll(); })
    .then(s => { SELF = s; paintAll(); })
    .catch(e => console.warn('our own token did not read:', e));

  try {
    const d = await window.SixpackChain.readChain();
    BASKET = d.basket;
    META = { source: d.source, scanned: d.scanned, priced: d.priced, at: d.at, failed: null, via: d.via, age: d.age };
    if (!BASKET.length) throw new Error('the basket came back empty');
  } catch (e) {
    console.error('reading the chain failed:', e);
    META.failed = e.message || 'unknown error';
  }
  paintAll();
}

document.querySelectorAll('[data-brand-name]').forEach(el => { el.textContent = BRAND.name; });
/* The tape is padded right away, from the markup, without waiting for the
   chain: while there is no data a person is looking at the tape anyway,
   and a short one reads as breakage rather than as "still loading". */
padTape();
window.addEventListener('resize', padTape, { passive: true });
wireStage();
wireCalc();
setHold(HOLD);
wirePalette();
wireConnect();
wireSocial();
wireContract();
paintLedger();
paintCalc();
paintStatus();
tick();
setInterval(tick, 1000);
setInterval(() => { if (BASKET.length) paintStatus(); }, 15000);
load();
