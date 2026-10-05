-- Run once in Supabase SQL Editor
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  passenger_name text not null,
  pickup text not null,
  drop_location text not null,
  fare int not null check (fare > 0),
  status text not null default 'searching'
    check (status in ('searching','assigned','ontheway','arrived','completed','cancelled')),
  rider_name text
);

alter table public.bookings enable row level security;

-- PROTOTYPE ONLY – replace with authenticated policies before production
drop policy if exists "Allow all for anon" on public.bookings;
create policy "Allow all for anon"
  on public.bookings
  for all
  using (true)
  with check (true);

-- Enable Realtime
alter publication supabase_realtime add table public.bookings;
