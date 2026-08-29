# Rehearsing an epoch on a fork

A fork is a local copy of the live chain on your own machine. It takes the
chain's real state — Pons's contracts, the pools, the balances — and lets
you sign anything with fake ether. Nothing leaves the machine and nothing
costs money.

This rehearsal is what the whole crank was written for. It catches what
code can catch: whether `claim` goes through, whether the swap settles
against the real pools, whether the payout survives its five-hundredth
transfer, whether the journal counts one distribution twice.

---

## What you need

**Foundry** — only `anvil` is used:

```
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Project dependencies** — once:

```
npm install
```

They are needed only by the signing layer (`ethers`); the other checks run
on bare node.

---

## 1. Start the fork

```
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663
```

`--chain-id 4663` is optional but useful: without it anvil comes up as
network 31337 and the crank will correctly say this is not Robinhood
Chain. The contracts are real either way.

Anvil prints ten ready wallets with their private keys and 10,000 fake ETH
on each. The first of them is the operator.

The node lives at `http://127.0.0.1:8545` for as long as the window stays
open.

---

## 2. Dry run against the fork

```
SIXPACK_RPC=http://127.0.0.1:8545 \
SIXPACK_TOKEN=0x…   \
SIXPACK_OPERATOR=0x… \
node crank/index.js
```

The crank's first line says which node it connected to. Check that it
reads `OWN NODE · http://127.0.0.1:8545` and not "live node" — on a fork
everything looks exactly like production, and that line is the only thing
that tells them apart.

The token at this step is any live one on Robinhood Chain: ours does not
exist yet, and what is being checked is the path, not the name. The
operator is anvil's first wallet.

---

## 3. Live run against the fork

The same plus a key and `--live`:

```
SIXPACK_RPC=http://127.0.0.1:8545 \
SIXPACK_TOKEN=0x… \
SIXPACK_OPERATOR=0x… \
SIXPACK_KEY=0x…      \
node crank/index.js --live
```

The key belongs to that same first anvil wallet. It is fake and lives only
in that window; there is no reason to put a real key here.

**If the node line says "live node" rather than "OWN NODE" — do not
run it.** With `--live` against the live node the transactions go out for
real, and the crank warns about it on a line of its own.

---

## What should happen

The crank walks the whole path: collect the fee, wrap the ether, buy six
tokens, distribute to holders, and write every step to the journal. If it
stops somewhere, that stop is the result of the rehearsal: until today
nobody knew about that break.

A couple of things look different on a fork and are not faults:

- **Gas prices.** They are the fork's own and bear no relation to the live
  ones. Measuring the cost of an epoch by them is meaningless.
- **Block time.** Anvil mines a block per transaction instantly; the live
  chain does not. Races that only show up under real latency will not
  appear on a fork.
- **The double-payout journal** needs a real Postgres:
  `DATABASE_URL=… node crank/check-journal.js`. A fake one would not check
  the thing the journal exists for.

---

## If something goes wrong

The fork can be restarted at any moment — its state resets to the current
live block and the rehearsal starts from a clean sheet. That is its main
property: making a mistake here costs nothing.
