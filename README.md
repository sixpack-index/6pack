# 6PACK

The index of Robinhood Chain. Hold one token, own the six deepest.

This is the full source of the site and the service behind it. Nothing is
minified and nothing is hidden — if the page shows a number, the code that
produced it is in this repository.

## What it does

`$6PACK` launches on [Pons](https://pons.fun). Pons pools charge a **1% fee**
on every trade. The venue keeps 30% of that; the rest — **0.7% of turnover** —
is what this project distributes.

Every 3 hours the collected fee buys the six deepest tokens on the chain in
equal weight and pays them out to holders in kind. Not in `$6PACK`, not in a
wrapper — the actual six tokens.

The basket is not curated. It is whatever the chain says is deepest, read live
from DexScreener and Blockscout, refreshed every minute. Stablecoins and
wrapped ETH are excluded: an index of memecoins that holds USDC is not an
index of memecoins.

## What is provably fixed

Three things cannot be changed after launch, and that is the whole reason to
launch on Pons rather than write our own token:

| | |
|---|---|
| pool fee | 1%, set by the factory at creation |
| venue share | 30%, **frozen per token when liquidity locks** |
| liquidity | permanently locked — there is no withdraw function |

Everything else — the fee recipient, the basket contents — is visible on
chain at any moment.

## Layout

```
index.html      the page
app.js          rendering, the calculator, the basket cards
chain.js        talking to our API, wallet-side overrides
core.js         the model: fee, epoch size, weights, formatting
                shared verbatim by the browser, the server and the crank
canpack.js      the six-can pack on the first screen
canlabel.js     labels drawn on canvas from live basket data
stage.js        the 3D stage, with ASCII fallbacks when WebGL is absent
server/         API and the collector: reads the chain, stores snapshots
crank/          the epoch engine: collect, buy the six, distribute
docs/           how it works, in plain English
check.js        tests for the model — `npm run check`
```

`core.js` is the piece worth reading first. The fee rate, the epoch length and
the seat weights live there and nowhere else: the page, the server and the
crank all import the same numbers. A second copy of a rule is a rule that
drifts, silently.

## Running it

```
npm install
npm run check      # tests: the model and the server rules
npm start          # the API; needs DATABASE_URL
```

The site is static — open `index.html`, or serve the folder. It works without
the API too, falling back to reading the chain directly from the browser.

## Notes on the code

Comments are in Russian. They explain *why*, not *what*: most of them record a
measurement or a bug that cost an evening, so that the next person does not
repeat it. If you are reading this to check whether the mechanism is honest,
`docs/` and `core.js` are in English.

## Third-party

The can model is *"Aluminium can 500ml"* by
[YouniqueIdeaStudio](https://sketchfab.com/YouniqueIdeaStudio), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). three.js is BSD-3.

## Licence

MIT — see `LICENSE`.
