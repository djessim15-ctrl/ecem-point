-- ---------------------------------------------------------------------------
-- 0015 · Code d'accès administrateur
--
--   Permet à un compte existant de devenir administrateur en saisissant un
--   code (Profil → Administration → Débloquer l'administration).
--
--   Le code n'est JAMAIS écrit en clair, ni ici ni dans le dépôt public :
--   la base ne stocke que son empreinte sha256. Pour le définir ou le changer :
--
--     insert into public.admin_secrets (id, code_hash)
--     values (1, encode(extensions.digest('<LE_CODE>', 'sha256'), 'hex'))
--     on conflict (id) do update
--        set code_hash = excluded.code_hash, updated_at = now();
--
--   Garde-fous : 5 essais par quart d'heure et par compte, compte connecté
--   obligatoire, et la fonction reste SECURITY DEFINER (aucun accès direct
--   aux tables admin_*).
-- ---------------------------------------------------------------------------

create table if not exists public.admin_secrets (
  id         integer primary key default 1 check (id = 1),
  code_hash  text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_secrets enable row level security;
revoke all on public.admin_secrets from anon, authenticated;

create table if not exists public.admin_claims (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists admin_claims_idx on public.admin_claims (user_id, at desc);
alter table public.admin_claims enable row level security;
revoke all on public.admin_claims from anon, authenticated;

create or replace function public.admin_claim(p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_tries integer;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'ELEVE_INTROUVABLE';
  end if;

  select count(*) into v_tries
    from public.admin_claims
   where user_id = v_uid and at > now() - interval '15 minutes';

  if v_tries >= 5 then
    raise exception 'TROP_DE_TENTATIVES';
  end if;

  insert into public.admin_claims (user_id) values (v_uid);

  v_hash := encode(extensions.digest(btrim(coalesce(p_code, '')), 'sha256'), 'hex');

  if not exists (select 1 from public.admin_secrets s where s.code_hash = v_hash) then
    raise exception 'CODE_INVALIDE';
  end if;

  insert into public.admins (user_id) values (v_uid) on conflict do nothing;

  delete from public.admin_claims where user_id = v_uid;

  return jsonb_build_object('admin', true);
end;
$fn$;

revoke all on function public.admin_claim(text) from public;
grant execute on function public.admin_claim(text) to authenticated;
