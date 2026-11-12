-- ---------------------------------------------------------------------------
-- 0022 · Voir l'IP et l'appareil de chaque session (encadrement)
--
-- Supabase enregistre déjà, pour chaque session ouverte, l'adresse IP et le
-- user-agent du client (`auth.sessions`). Cette fonction les expose à
-- l'administration, compte par compte : c'est le seul endroit où l'IP d'un
-- élève est conservée, et elle disparaît avec sa session quand le compte est
-- supprimé (d'où l'intérêt de la lire avant de supprimer quelqu'un).
--
-- Réservée aux administrateurs (`is_admin()`), en lecture seule.
-- ---------------------------------------------------------------------------

create or replace function public.admin_connexions(p_limit integer default 60)
returns table (
  prenom            text,
  role              text,
  ip                text,
  agent             text,
  session_created   timestamptz,
  session_refreshed timestamptz,
  derniere_connexion timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  return query
    select p.prenom::text,
           p.role::text,
           host(s.ip)::text,
           s.user_agent::text,
           s.created_at,
           s.refreshed_at,
           u.last_sign_in_at
      from auth.sessions s
      join public.profiles p on p.id = s.user_id
      left join auth.users u on u.id = s.user_id
     order by s.created_at desc
     limit greatest(1, least(coalesce(p_limit, 60), 200));
end;
$fn$;

revoke all on function public.admin_connexions(integer) from public;
grant execute on function public.admin_connexions(integer) to authenticated;
