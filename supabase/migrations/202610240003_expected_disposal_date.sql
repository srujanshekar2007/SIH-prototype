-- Separate disposal expectations from operational next-action tracking.
-- Nullable and additive: existing complaint records are preserved unchanged.
alter table public.complaints
  add column if not exists expected_disposal_at date,
  add column if not exists next_action_required text;
