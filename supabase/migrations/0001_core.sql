-- ============================================================================
-- ECEM Point — Migration 0001 : noyau (tables, index, helpers)
-- ============================================================================
-- Rôle des tables :
--   profiles       -> un compte (élève / suppléant / délégué) + son solde de points
--   staff_codes    -> les codes secrets d'inscription suppléant / délégué (hashés)
--   point_events   -> l'historique horodaté de chaque mouvement de points
--   staff_messages -> le tchat réservé aux délégués + suppléants
--   app_settings   -> les règles du jeu (1 ligne unique)
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Comptes
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  prenom        text not null,
  role          text not null check (role in ('eleve', 'suppleant', 'delegue')),
  points        integer not null default 0 check (points >= 0),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint profiles_prenom_len check (char_length(prenom) between 2 and 24)
);

-- Un prénom = un seul compte dans toute la classe (insensible à la casse).
create unique index if not exists profiles_prenom_uniq on public.profiles (lower(prenom));
create index if not exists profiles_role_idx      on public.profiles (role);
create index if not exists profiles_points_idx    on public.profiles (points desc);
create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc);

comment on table  public.profiles is 'Un compte de la classe : prénom, rôle et solde de points.';
comment on column public.profiles.prenom       is 'Prénom affiché, unique dans la classe.';
comment on column public.profiles.points       is 'Solde actuel, toujours >= 0.';
comment on column public.profiles.last_seen_at is 'Dernier battement de coeur : sert à savoir qui est connecté.';

-- ---------------------------------------------------------------------------
-- 2. Codes secrets d'inscription (suppléant / délégué)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_codes (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  role          text not null check (role in ('suppleant', 'delegue')),
  -- Jamais en clair : sha256 hexadécimal du code.
  code_hash     text not null unique,
  -- Réservation temporaire pendant l'inscription (10 min) pour éviter
  -- que deux personnes utilisent le même code en même temps.
  claimed_token uuid,
  claimed_at    timestamptz,
  -- Un code ne sert qu'une seule fois : utilisé => verrouillé.
  used_by       uuid references public.profiles (id) on delete set null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists staff_codes_claim_idx on public.staff_codes (claimed_token);
create index if not exists staff_codes_role_idx  on public.staff_codes (role) where used_by is null;

comment on table public.staff_codes is 'Codes secrets d''inscription. Table invisible pour les clients (RLS sans politique).';

-- ---------------------------------------------------------------------------
-- 3. Historique des points
-- ---------------------------------------------------------------------------
create table if not exists public.point_events (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('gain', 'retrait', 'transfert')),
  amount           integer not null check (amount > 0),
  -- L'élève concerné au premier chef.
  subject_id       uuid not null references public.profiles (id) on delete cascade,
  -- Pour un transfert : l'autre élève.
  counterparty_id  uuid references public.profiles (id) on delete cascade,
  -- Qui a déclenché le mouvement (un délégué, ou l'élève qui envoie).
  actor_id         uuid references public.profiles (id) on delete set null,
  note             text check (note is null or char_length(note) <= 200),
  created_at       timestamptz not null default now()
);

create index if not exists point_events_subject_idx on public.point_events (subject_id, created_at desc);
create index if not exists point_events_created_idx on public.point_events (created_at desc);

comment on table public.point_events is 'Journal immuable : gain, retrait ou transfert de points.';

-- ---------------------------------------------------------------------------
-- 4. Tchat délégués <-> suppléants
-- ---------------------------------------------------------------------------
create table if not exists public.staff_messages (
  id         bigint generated always as identity primary key,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint staff_messages_body_len check (char_length(btrim(body)) between 1 and 1000)
);

create index if not exists staff_messages_created_idx on public.staff_messages (created_at);

comment on table public.staff_messages is 'Messagerie privée réservée aux délégués et suppléants.';

-- ---------------------------------------------------------------------------
-- 5. Réglages (une seule ligne)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                     integer primary key default 1 check (id = 1),
  suppleant_can_award    boolean not null default false,
  award_min              integer not null default 1 check (award_min >= 1),
  award_max              integer not null default 4 check (award_max >= award_min),
  transfer_min           integer not null default 1 check (transfer_min >= 1),
  online_window_seconds  integer not null default 90 check (online_window_seconds >= 10),
  updated_at             timestamptz not null default now()
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

comment on table public.app_settings is 'Règles du jeu. suppleant_can_award = true donne aux suppléants les mêmes pouvoirs qu''un délégué.';

-- ---------------------------------------------------------------------------
-- 6. Fonctions utilitaires (SECURITY DEFINER : elles lisent profiles sans
--    tomber dans la boucle RLS -> fonction -> RLS)
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('suppleant', 'delegue'), false);
$$;

create or replace function public.is_delegue()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'delegue', false);
$$;

-- Un délégué peut toujours donner/retirer ; un suppléant seulement si le
-- réglage suppleant_can_award est activé.
create or replace function public.can_award()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'delegue' or (p.role = 'suppleant' and s.suppleant_can_award)
       from public.profiles p, public.app_settings s
      where p.id = auth.uid() and s.id = 1),
    false);
$$;

comment on function public.can_award() is 'Vrai si le compte connecté a le droit de donner ou retirer des points.';

-- ---------------------------------------------------------------------------
-- 7. Droits
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.profiles      to authenticated;
grant select on public.point_events  to authenticated;
grant select on public.staff_messages to authenticated;
grant select on public.app_settings  to authenticated;

-- staff_codes : volontairement AUCUN droit accordé aux rôles anon/authenticated.
revoke all on public.staff_codes from anon, authenticated;

grant execute on function public.my_role()    to anon, authenticated;
grant execute on function public.is_staff()   to anon, authenticated;
grant execute on function public.is_delegue() to anon, authenticated;
grant execute on function public.can_award()  to anon, authenticated;
