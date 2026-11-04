-- ---------------------------------------------------------------------------
-- 0014 · Administration du site
--
--   • Table public.admins : liste blanche des comptes qui peuvent administrer.
--   • Suspension (ban) d'un compte, avec motif et date.
--   • Suppression définitive d'un compte (profil + compte de connexion).
--   • Changement de rôle, réinitialisation de mot de passe, création de codes.
--   • Un compte suspendu ne peut plus écrire nulle part : les triggers
--     « garde » bloquent toute nouvelle ligne (points, tchats, réactions, roue).
--
--   Toutes les fonctions sont SECURITY DEFINER et vérifient is_admin().
-- ---------------------------------------------------------------------------

-- 1. Liste blanche des administrateurs --------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Aucun accès direct : uniquement via les fonctions SECURITY DEFINER.
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- 2. Suspension --------------------------------------------------------------
alter table public.profiles
  add column if not exists banned_at   timestamptz,
  add column if not exists ban_reason  text;

create index if not exists profiles_banned_idx on public.profiles (banned_at)
  where banned_at is not null;

comment on column public.profiles.banned_at  is 'Date de suspension. NULL = compte actif.';
comment on column public.profiles.ban_reason is 'Motif affiché à l''élève et dans le journal.';

-- 3. Helpers -----------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

create or replace function public.is_banned()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.banned_at is not null from public.profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function public.am_i_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_admin();
$$;

-- 4. Garde : un compte suspendu n'écrit plus rien ----------------------------
create or replace function public.garde_compte_suspendu()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_banned() then
    raise exception 'COMPTE_SUSPENDU';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['point_events', 'class_messages', 'private_messages',
                           'class_reactions', 'staff_messages', 'wheel_spins']
  loop
    execute format('drop trigger if exists garde_suspendu on public.%I', t);
    execute format(
      'create trigger garde_suspendu before insert on public.%I
         for each row execute function public.garde_compte_suspendu()', t);
  end loop;
end $$;

-- 5. Lecture de la liste des comptes ----------------------------------------
create or replace function public.admin_list()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  return coalesce((
    select jsonb_agg(ligne order by ligne->>'prenom')
      from (
        select jsonb_build_object(
                 'id',        p.id,
                 'prenom',    p.prenom,
                 'role',      p.role,
                 'points',    p.points,
                 'banned_at', p.banned_at,
                 'ban_reason', p.ban_reason,
                 'created_at', p.created_at,
                 'last_seen_at', p.last_seen_at,
                 'admin',     (a.user_id is not null)
               ) as ligne
          from public.profiles p
          left join public.admins a on a.user_id = p.id
      ) s
  ), '[]'::jsonb);
end;
$fn$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  select jsonb_build_object(
    'comptes',    (select count(*) from public.profiles),
    'bannis',     (select count(*) from public.profiles where banned_at is not null),
    'admins',     (select count(*) from public.admins),
    'codes',      (select count(*) from public.staff_codes),
    'codes_libres', (select count(*) from public.staff_codes where claimed_token is null),
    'mouvements_7j', (select count(*) from public.point_events
                       where created_at > now() - interval '7 days'),
    'messages_7j',  (select count(*) from public.class_messages
                       where created_at > now() - interval '7 days')
  ) into v;

  return v;
end;
$fn$;

-- 6. Suspension / réactivation ----------------------------------------------
create or replace function public.admin_ban(p_user uuid, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;
  if p_user = auth.uid() then raise exception 'CIBLE_INVALIDE'; end if;

  select * into v_cible from public.profiles where id = p_user for update;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  if exists (select 1 from public.admins a where a.user_id = p_user)
     and (select count(*) from public.admins) <= 1 then
    raise exception 'DERNIER_ADMIN';
  end if;

  update public.profiles
     set banned_at = now(),
         ban_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_user;

  return jsonb_build_object('prenom', v_cible.prenom, 'suspendu', true);
end;
$fn$;

create or replace function public.admin_unban(p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;

  select * into v_cible from public.profiles where id = p_user for update;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  update public.profiles set banned_at = null, ban_reason = null where id = p_user;

  return jsonb_build_object('prenom', v_cible.prenom, 'suspendu', false);
end;
$fn$;

-- 7. Suppression définitive --------------------------------------------------
create or replace function public.admin_delete(p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;
  if p_user = auth.uid() then raise exception 'CIBLE_INVALIDE'; end if;

  select * into v_cible from public.profiles where id = p_user;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  if exists (select 1 from public.admins a where a.user_id = p_user)
     and (select count(*) from public.admins) <= 1 then
    raise exception 'DERNIER_ADMIN';
  end if;

  -- Le profil part en cascade ; le compte de connexion aussi.
  delete from auth.users where id = p_user;

  return jsonb_build_object('prenom', v_cible.prenom, 'supprime', true);
end;
$fn$;

-- 8. Rôle et administration --------------------------------------------------
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;
  if p_role is null or p_role not in ('eleve', 'suppleant', 'delegue') then
    raise exception 'ROLE_INVALIDE';
  end if;
  if p_user = auth.uid() then
    raise exception 'CIBLE_INVALIDE';   -- on ne change pas son propre rôle
  end if;

  select * into v_cible from public.profiles where id = p_user for update;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  update public.profiles set role = p_role where id = p_user;

  return jsonb_build_object('prenom', v_cible.prenom, 'role', p_role);
end;
$fn$;

create or replace function public.admin_set_admin(p_user uuid, p_admin boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;

  select * into v_cible from public.profiles where id = p_user;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  if p_admin then
    insert into public.admins (user_id) values (p_user) on conflict do nothing;
  else
    if p_user = auth.uid() then raise exception 'CIBLE_INVALIDE'; end if;
    if (select count(*) from public.admins) <= 1 then raise exception 'DERNIER_ADMIN'; end if;
    delete from public.admins where user_id = p_user;
  end if;

  return jsonb_build_object('prenom', v_cible.prenom, 'admin', p_admin);
end;
$fn$;

-- 9. Réinitialiser un mot de passe ------------------------------------------
create or replace function public.admin_reset_password(p_user uuid, p_password text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cible public.profiles;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'MOT_DE_PASSE_TROP_COURT';
  end if;

  select * into v_cible from public.profiles where id = p_user;
  if not found then raise exception 'ELEVE_INTROUVABLE'; end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;

  return jsonb_build_object('prenom', v_cible.prenom, 'reinitialise', true);
end;
$fn$;

-- 10. Codes d'encadrement ----------------------------------------------------
create or replace function public.admin_add_code(p_role text, p_code text, p_label text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hash text;
  v_id   uuid;
begin
  if not public.is_admin() then raise exception 'INTERDIT'; end if;
  if p_role is null or p_role not in ('suppleant', 'delegue') then
    raise exception 'ROLE_INVALIDE';
  end if;
  if p_code is null or char_length(btrim(p_code)) < 4 or char_length(btrim(p_code)) > 64 then
    raise exception 'CODE_INVALIDE';
  end if;

  v_hash := encode(extensions.digest(btrim(p_code), 'sha256'), 'hex');

  insert into public.staff_codes (label, role, code_hash)
  values (coalesce(nullif(btrim(p_label), ''), 'ajouté par admin'), p_role, v_hash)
  on conflict (code_hash) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'CODE_DEJA_PRESENT';
  end if;

  return jsonb_build_object('role', p_role, 'ajoute', true);
end;
$fn$;

-- 11. Droits ----------------------------------------------------------------
revoke all on function public.admin_list()                        from public;
revoke all on function public.admin_stats()                       from public;
revoke all on function public.admin_ban(uuid, text)               from public;
revoke all on function public.admin_unban(uuid)                   from public;
revoke all on function public.admin_delete(uuid)                  from public;
revoke all on function public.admin_set_role(uuid, text)          from public;
revoke all on function public.admin_set_admin(uuid, boolean)      from public;
revoke all on function public.admin_reset_password(uuid, text)    from public;
revoke all on function public.admin_add_code(text, text, text)    from public;

grant execute on function public.is_admin()                      to authenticated;
grant execute on function public.is_banned()                     to authenticated;
grant execute on function public.am_i_admin()                    to authenticated;
grant execute on function public.admin_list()                    to authenticated;
grant execute on function public.admin_stats()                   to authenticated;
grant execute on function public.admin_ban(uuid, text)           to authenticated;
grant execute on function public.admin_unban(uuid)               to authenticated;
grant execute on function public.admin_delete(uuid)              to authenticated;
grant execute on function public.admin_set_role(uuid, text)      to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean)  to authenticated;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
grant execute on function public.admin_add_code(text, text, text) to authenticated;
