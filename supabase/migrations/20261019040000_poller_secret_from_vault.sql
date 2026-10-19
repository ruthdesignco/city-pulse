-- The poller secret lives only in Vault (SPEC decision log, 2026-10-18).
--
-- pg_cron already reads Vault's poller_secret for the x-poller-secret header
-- (20261018210000_poller_cron.sql). Now the Edge Function reads the same
-- secret through this function instead of keeping its own POLLER_SECRET
-- copy, so there is one value, generated in SQL, that no human ever sees.
--
-- Rotate (in the SQL editor of project jegmwhfbdhohvysbmjdw; returns nothing,
-- displays nothing):
--   select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
--   from vault.secrets where name = 'poller_secret';
-- Running isolates pick the new value up on the next cron tick (secret.ts).
--
-- Never select decrypted_secret by hand: that puts the value on screen.

create function public.poller_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'poller_secret'
$$;

comment on function public.poller_secret() is
  'The poller''s shared secret from Vault. service_role only: the poller Edge Function checks x-poller-secret against it.';

-- Supabase's default privileges grant new functions to anon and
-- authenticated; this one must be callable by service_role alone.
revoke all on function public.poller_secret() from public, anon, authenticated;
grant execute on function public.poller_secret() to service_role;
