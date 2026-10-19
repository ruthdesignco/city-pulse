-- Hygiene (board of vibes, weekend 1, fix 11): public.rls_auto_enable() is a
-- Supabase-platform event-trigger function (SECURITY DEFINER, fires on
-- CREATE TABLE to turn on RLS automatically) that isn't defined in any of our
-- migrations. The security advisor flags it WARN because Supabase's default
-- privileges grant execute on new functions to anon and authenticated.
--
-- It's an event-trigger function, so Postgres never lets it be called
-- directly as a statement or an RPC regardless of these grants -- but the
-- grant is still drift in the exposed schema, and the advisor is right to
-- flag anything anon/authenticated can reach that we didn't put there.
--
-- Not in our control: the function's own definition, which the platform
-- owns and may recreate (and re-grant) on its own schedule.
--
-- After applying, confirm ensure_rls still fires on a scratch table:
--   create table public._rls_check (id int);
--   select relrowsecurity from pg_class where oid = 'public._rls_check'::regclass; -- expect true
--   drop table public._rls_check;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
