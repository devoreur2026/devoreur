-- UMBRA real-money economy — LEDGER MODE schema.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
--
-- The server (using the SERVICE ROLE key) is the only writer; it owns balances
-- in memory and mirrors every movement here as an append-only row. Clients get
-- NO direct access (RLS denies them) — the server serves wallet + history over
-- the game socket. The ledger is truly append-only: UPDATE/DELETE are blocked
-- for everyone, including the service role.

-- ── append-only transaction ledger ──────────────────────────────────────────
create table if not exists public.umbra_ledger (
  id            bigint primary key,        -- assigned by the server (matches in-memory row id)
  tx            text        not null,      -- idempotency key of the transaction this row belongs to
  account       text        not null,      -- Supabase user id, or 'house' / 'mint' / 'pot:<round>'
  bucket        text        not null,      -- 'credit' | 'earnings'
  type          text        not null,      -- entry | rake | kill_pvp | kill_reward | payout | ...
  amount        bigint      not null,      -- signed delta (coins)
  balance_after bigint      not null,      -- account/bucket balance after this row
  round         text,                      -- round id, if part of a round (for the audit)
  counterparty  text,
  ts            timestamptz not null default now()
);
create index if not exists umbra_ledger_account_idx on public.umbra_ledger (account);
create index if not exists umbra_ledger_round_idx   on public.umbra_ledger (round);

-- ── fireball inventory (persists on the account) ─────────────────────────────
create table if not exists public.umbra_inventory (
  account    text primary key,
  fireballs  integer     not null default 0,
  updated_at timestamptz not null default now()
);

-- ── lock clients out: RLS on, no policies -> only the service role can touch it
alter table public.umbra_ledger    enable row level security;
alter table public.umbra_inventory enable row level security;

-- ── append-only: block UPDATE and DELETE on the ledger for everyone ──────────
create or replace function public.umbra_ledger_no_edit() returns trigger
  language plpgsql as $$
begin
  raise exception 'umbra_ledger is append-only — % is not allowed', tg_op;
end $$;

drop trigger if exists umbra_ledger_no_edit_trg on public.umbra_ledger;
create trigger umbra_ledger_no_edit_trg
  before update or delete on public.umbra_ledger
  for each row execute function public.umbra_ledger_no_edit();
