/* =========================================================================
   The database. Postgres on Railway, a volume is mounted — the data
   survives a redeploy.

   Why this matters enough to be put in the very first comment: on the
   previous project the storage was not durable, and spent payments were
   forgotten on every restart — an old transaction became valid again. Here
   the epochs table plays the same role: a payout that has been seen must
   stay seen.
   ========================================================================= */

import pg from 'pg';

/* The pool is small on purpose. On a cheap plan Railway gives out few
   connections, and a greedy pool eats them away from itself on a restart:
   the old connections are still hanging around, the new ones are already
   asking. */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', e => console.error('the database pool:', e.message));

export const q = (text, params) => pool.query(text, params);

/**
 * The schema. Run on every start: `if not exists` makes that safe, and a
 * separate migration step for four tables would cost more than it is
 * worth. When there are more tables — rewrite this into numbered steps.
 */
export async function migrate() {
  /* The basket became a six, and the `ten` table stopped naming what lies
     in it. The rename goes BEFORE the tables are created: `create table if
     not exists basket` below would create an empty one, and then there
     would be nowhere left to move to — while the old snapshots would stay
     in a dead table that nobody will remember a month from now.

     The condition is a double one: we rename only if the old table exists
     and the new one does not yet. Otherwise a second start of the server
     would fall over trying to rename something that does not exist, and
     the service would not come up at all. */
  await q(`
    do $$
    begin
      if exists (select from information_schema.tables
                  where table_schema = 'public' and table_name = 'ten')
         and not exists (select from information_schema.tables
                  where table_schema = 'public' and table_name = 'basket') then
        alter table ten rename to basket;
        alter index if exists ten_at rename to basket_at;
      end if;
    end $$;
  `);

  await q(`
    /* Settings: the token and treasury addresses, the chosen theme. One
       row per key. This table is exactly what the whole thing was started
       for — the address is changed in the console, not by a push to the
       repository. */
    create table if not exists settings (
      key        text primary key,
      value      text not null,
      updated_at timestamptz not null default now()
    );

    /* Snapshots of our own token's market. The history is not there for
       looks: it shows that the turnover really was there when an epoch was
       counted. */
    create table if not exists market (
      id         bigserial primary key,
      token      text not null,
      price      double precision,
      market_cap double precision,
      liq        double precision,
      vol24      double precision,
      pools      integer,
      holders    integer,
      pair_id    text,
      at         timestamptz not null default now()
    );
    create index if not exists market_token_at on market (token, at desc);
    /* The column was added later than the table: on the live database the
       table already exists, and create table will not touch it. By a
       separate alter — otherwise the pair address would not appear for
       those whose database is older than this line. */
    alter table market add column if not exists pair_id text;

    /* The basket whole in a single snapshot: it is always read whole, and
       splitting it into rows would mean putting it back together on every
       request. */
    create table if not exists basket (
      id      bigserial primary key,
      at      timestamptz not null default now(),
      source  text not null,
      scanned integer,
      priced  integer,
      rows    jsonb not null
    );
    create index if not exists basket_at on basket (at desc);

    /* Treasury payouts. The key is the transaction hash, so rereading the
       same history doubles nothing: the collector may overlap its windows
       as much as it likes. A race between two simultaneous collectors is
       settled by the database itself. */
    create table if not exists epochs (
      hash    text primary key,
      at      timestamptz not null,
      block   bigint,
      symbol  text,
      token   text,
      amount  double precision,
      raw     jsonb
    );
    create index if not exists epochs_at on epochs (at desc);

    /* Holder snapshots: without a history there is no honest way to say
       how many addresses passed the cut-off — and the eligible supply card
       promises exactly that. */
    create table if not exists holders (
      token text not null,
      at    timestamptz not null,
      count integer not null,
      primary key (token, at)
    );
  `);
}

/** All the settings as a single object. */
export async function settings() {
  const r = await q('select key, value from settings');
  const out = {};
  r.rows.forEach(row => { out[row.key] = row.value; });
  return out;
}

/**
 * Write a setting. An empty value erases the key rather than writing an
 * empty string: "the off switch is designed together with the launch" —
 * removing the token address must be as easy as typing it in, and leave
 * no traces.
 */
export async function setSetting(key, value) {
  if (value === '' || value === null || value === undefined) {
    await q('delete from settings where key = $1', [key]);
    return;
  }
  await q(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, String(value)]
  );
}
