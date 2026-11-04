-- ---------------------------------------------------------------------------
-- 0019 · Cartes à collectionner, anti-bruteforce, rapport de climat
--
-- • `cards` + `card_ownership` : collection de 12 cartes, un paquet par
--   semaine et par élève (tirage pondéré par rareté), doublons comptés.
-- • `login_attempts` : chaque connexion (réussie ou non) est journalisée.
--   `login_guard()` bloque 15 minutes après 5 échecs sur le même prénom.
--   `admin_login_attempts()` montre à l'admin qui essaie d'entrer.
-- • `climat_report()` : rapport de climat complet (familles, cibles,
--   signalements) que l'admin peut exporter en CSV ou imprimer.
-- ---------------------------------------------------------------------------

-- 1. Catalogue des cartes ----------------------------------------------------
create table if not exists public.cards (
  id          serial primary key,
  code        text not null unique,
  nom         text not null,
  rarete      text not null check (rarete in ('commune', 'rare', 'epique', 'legendaire')),
  emoji       text not null default '⭐',
  description text,
  teinte      text not null default 'violet'
);

create table if not exists public.card_ownership (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  card_id  integer not null references public.cards(id) on delete cascade,
  quantite integer not null default 1 check (quantite > 0),
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists public.card_packs (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  last_open timestamptz not null default now(),
  ouverts   integer not null default 0
);

alter table public.cards          enable row level security;
alter table public.card_ownership enable row level security;
alter table public.card_packs     enable row level security;

insert into public.cards (code, nom, rarete, emoji, description, teinte) values
  ('cartable',      'Le Cartable',        'commune',    '🎒', 'Toujours prêt, jamais léger.',            'bleu'),
  ('gomme',         'La Gomme',           'commune',    '🧽', 'Efface les erreurs, pas les efforts.',     'vert'),
  ('stylo',         'Le Stylo',           'commune',    '🖊️', 'Quatre couleurs, mille idées.',           'violet'),
  ('cahier',        'Le Cahier',          'commune',    '📓', 'Le compagnon des bons jours.',             'orange'),
  ('regle',         'La Règle',           'commune',    '📏', 'Toujours droit dans ses bottes.',           'bleu'),
  ('compas',        'Le Compas',          'rare',       '🧭', 'Ne perd jamais le nord.',                  'vert'),
  ('calculatrice',  'La Calculatrice',    'rare',       '🧮', 'Compte les points mieux que personne.',    'violet'),
  ('dictionnaire',  'Le Dictionnaire',    'rare',       '📚', 'Les mots justes, au bon moment.',          'orange'),
  ('trophee',       'Le Trophée',         'epique',     '🏆', 'Pour celles et ceux qui n’abandonnent pas.', 'or'),
  ('medaille',      'La Médaille',        'epique',     '🥇', 'Le mérite se voit de loin.',               'or'),
  ('couronne',      'La Couronne',        'legendaire', '👑', 'Réservée aux légendes de la classe.',      'rose'),
  ('etoile',        'L’Étoile de Classe', 'legendaire', '🌟', 'Une sur cent, comme les vrais champions.', 'rose')
on conflict (code) do nothing;

create or replace function public.cards_catalogue()
returns table (id integer, code text, nom text, rarete text, emoji text, description text, teinte text)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select c.id, c.code, c.nom, c.rarete, c.emoji, c.description, c.teinte
    from public.cards c
   order by case c.rarete
              when 'legendaire' then 1
              when 'epique' then 2
              when 'rare' then 3
              else 4
            end, c.id;
$fn$;

create or replace function public.my_cards()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_cartes jsonb;
  v_dernier timestamptz;
  v_ouverts integer := 0;
  v_peut  boolean;
  v_dans  integer;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', c.code,
           'nom', c.nom,
           'rarete', c.rarete,
           'emoji', c.emoji,
           'description', c.description,
           'teinte', c.teinte,
           'quantite', o.quantite
         ) order by
           case c.rarete
             when 'legendaire' then 1
             when 'epique' then 2
             when 'rare' then 3
             else 4
           end, o.first_at desc), '[]'::jsonb)
    into v_cartes
    from public.card_ownership o
    join public.cards c on c.id = o.card_id
   where o.user_id = v_uid;

  select last_open, ouverts into v_dernier, v_ouverts
    from public.card_packs where user_id = v_uid;

  select count(*) into v_dans from public.cards;

  v_peut := v_dernier is null or v_dernier < now() - interval '7 days';

  return jsonb_build_object(
    'cartes', coalesce(v_cartes, '[]'::jsonb),
    'possibles', v_dans,
    'distinctes', jsonb_array_length(coalesce(v_cartes, '[]'::jsonb)),
    'paquets', coalesce(v_ouverts, 0),
    'peut_ouvrir', v_peut,
    'prochain', case when v_peut then null
                     else v_dernier + interval '7 days' end
  );
end;
$fn$;

create or replace function public.open_card_pack()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_dernier timestamptz;
  v_tirage integer := floor(random() * 100)::integer;
  v_rarete text;
  v_carte  public.cards;
  v_nouvelle boolean;
  v_quantite integer;
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  select last_open into v_dernier from public.card_packs where user_id = v_uid for update;

  if v_dernier is not null and v_dernier >= now() - interval '7 days' then
    raise exception 'PAQUET_DEJA_OUVERT';
  end if;

  /* 55 % commune · 28 % rare · 12 % épique · 5 % légendaire */
  v_rarete := case
    when v_tirage < 55 then 'commune'
    when v_tirage < 83 then 'rare'
    when v_tirage < 95 then 'epique'
    else 'legendaire'
  end;

  select * into v_carte
    from public.cards
   where rarete = v_rarete
   order by random()
   limit 1;

  if v_carte.id is null then
    select * into v_carte from public.cards order by random() limit 1;
  end if;

  select exists (
    select 1 from public.card_ownership where user_id = v_uid and card_id = v_carte.id
  ) into v_nouvelle;

  insert into public.card_ownership (user_id, card_id, quantite, first_at, last_at)
  values (v_uid, v_carte.id, 1, now(), now())
  on conflict (user_id, card_id) do update
     set quantite = public.card_ownership.quantite + 1,
         last_at = now();

  select quantite into v_quantite
    from public.card_ownership where user_id = v_uid and card_id = v_carte.id;

  insert into public.card_packs (user_id, last_open, ouverts)
  values (v_uid, now(), 1)
  on conflict (user_id) do update
     set last_open = now(),
         ouverts = public.card_packs.ouverts + 1;

  return jsonb_build_object(
    'carte', jsonb_build_object(
      'code', v_carte.code,
      'nom', v_carte.nom,
      'rarete', v_carte.rarete,
      'emoji', v_carte.emoji,
      'description', v_carte.description,
      'teinte', v_carte.teinte,
      'quantite', v_quantite
    ),
    'nouvelle', not v_nouvelle
  );
end;
$fn$;

-- 2. Tentatives de connexion -------------------------------------------------
create table if not exists public.login_attempts (
  id     bigserial primary key,
  prenom text,
  email  text,
  ok     boolean not null default false,
  agent  text,
  at     timestamptz not null default now()
);

create index if not exists login_attempts_at_idx on public.login_attempts (at desc);
create index if not exists login_attempts_prenom_idx on public.login_attempts (lower(coalesce(prenom, '')), at desc);

alter table public.login_attempts enable row level security;

create or replace function public.login_guard(p_prenom text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_prenom text := lower(btrim(coalesce(p_prenom, '')));
  v_echecs integer := 0;
  v_dernier timestamptz;
  v_restant integer := 0;
begin
  if v_prenom = '' then
    return jsonb_build_object('bloque', false, 'echecs', 0, 'restant_secondes', 0, 'max', 5);
  end if;

  select count(*), max(at) into v_echecs, v_dernier
    from public.login_attempts
   where lower(prenom) = v_prenom
     and ok = false
     and at > now() - interval '15 minutes';

  if v_echecs >= 5 and v_dernier is not null then
    v_restant := greatest(0, ceil(extract(epoch from (v_dernier + interval '15 minutes' - now())))::integer);
  end if;

  return jsonb_build_object(
    'bloque', v_echecs >= 5,
    'echecs', v_echecs,
    'restant_secondes', v_restant,
    'max', 5
  );
end;
$fn$;

create or replace function public.log_login_attempt(p_prenom text, p_ok boolean, p_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_prenom text := left(btrim(coalesce(p_prenom, '')), 24);
begin
  if v_prenom = '' then
    return;
  end if;

  insert into public.login_attempts (prenom, email, ok, agent)
  values (
    v_prenom,
    lower(regexp_replace(v_prenom, '[^a-zA-Z0-9]+', '.', 'g')) || '@ecem-point.fr',
    coalesce(p_ok, false),
    left(coalesce(p_agent, ''), 180)
  );

  /* On ne garde que 60 jours d'historique. */
  delete from public.login_attempts where at < now() - interval '60 days';
end;
$fn$;

create or replace function public.admin_login_attempts(p_limit int default 60)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_liste jsonb;
  v_essais jsonb;
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'prenom', l.prenom,
           'ok', l.ok,
           'agent', l.agent,
           'at', l.at
         ) order by l.at desc), '[]'::jsonb)
    into v_liste
    from (
      select * from public.login_attempts
       order by at desc
       limit greatest(1, least(coalesce(p_limit, 60), 300))
    ) l;

  select coalesce(jsonb_agg(jsonb_build_object(
           'prenom', t.prenom,
           'echecs', t.echecs,
           'succes', t.succes,
           'dernier', t.dernier,
           'bloque', t.bloque
         ) order by t.dernier desc), '[]'::jsonb)
    into v_essais
    from (
      select prenom,
             count(*) filter (where ok = false) as echecs,
             count(*) filter (where ok) as succes,
             max(at) as dernier,
             count(*) filter (where ok = false and at > now() - interval '15 minutes') >= 5 as bloque
        from public.login_attempts
       where at > now() - interval '30 days'
       group by prenom
      having count(*) filter (where ok = false) > 0
       order by max(at) desc
       limit 30
    ) t;

  return jsonb_build_object(
    'liste', coalesce(v_liste, '[]'::jsonb),
    'essais', coalesce(v_essais, '[]'::jsonb)
  );
end;
$fn$;

create or replace function public.admin_clear_login_attempts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  delete from public.login_attempts;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- 3. Rapport de climat -------------------------------------------------------
create or replace function public.climat_report()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_total    bigint;
  v_drapeaux bigint;
  v_familles jsonb;
  v_cibles   jsonb;
  v_paires   jsonb;
  v_signaux  bigint;
  v_score    integer;
begin
  if not (public.is_staff() or public.is_admin()) then
    raise exception 'INTERDIT';
  end if;

  select count(*) into v_total
    from public.class_messages where created_at > now() - interval '7 days';

  select count(*) into v_drapeaux
    from public.class_messages where created_at > now() - interval '7 days' and flagged;

  select coalesce(jsonb_agg(jsonb_build_object('famille', t.motif, 'nombre', t.n) order by t.n desc), '[]'::jsonb)
    into v_familles
    from (
      select coalesce(motif, 'autre') as motif, count(*) as n
        from public.class_messages
       where flagged and created_at > now() - interval '30 days'
       group by 1
       order by 2 desc
       limit 12
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object('cible', t.cible, 'messages', t.n, 'auteurs', t.auteurs) order by t.n desc), '[]'::jsonb)
    into v_cibles
    from (
      select cible, count(*) as n, count(distinct author_id) as auteurs
        from public.class_messages
       where flagged and cible is not null and created_at > now() - interval '30 days'
       group by cible
      having count(*) >= 2
       order by 2 desc
       limit 10
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object('a', s.prenom, 'b', r.prenom, 'n', t.n) order by t.n desc), '[]'::jsonb)
    into v_paires
    from (
      select sender_id, recipient_id, count(*) as n
        from public.private_messages
       where flagged and created_at > now() - interval '30 days'
       group by 1, 2
      having count(*) >= 3
    ) t
    join public.profiles s on s.id = t.sender_id
    join public.profiles r on r.id = t.recipient_id;

  select count(*) into v_signaux
    from public.class_reports where created_at > now() - interval '30 days';

  -- Score de base : part de messages non signalés (7 jours). On retire
  -- ensuite les pénalités (paires + cibles récurrentes), sans jamais
  -- descendre sous 0.
  v_score := case
    when v_total = 0 then 100
    else greatest(0, least(100,
      round(100.0 * (1 - (v_drapeaux::numeric / v_total::numeric)))::integer
      - 5 * jsonb_array_length(coalesce(v_paires, '[]'::jsonb))
      - 3 * least(5, jsonb_array_length(coalesce(v_cibles, '[]'::jsonb)))
    ))
  end;

  return jsonb_build_object(
    'genere_le', now(),
    'score', v_score,
    'messages_7j', v_total,
    'drapeaux_7j', v_drapeaux,
    'familles', coalesce(v_familles, '[]'::jsonb),
    'cibles', coalesce(v_cibles, '[]'::jsonb),
    'paires', coalesce(v_paires, '[]'::jsonb),
    'signalements_30j', coalesce(v_signaux, 0),
    'comptes', (select count(*) from public.profiles),
    'suspendus', (select count(*) from public.profiles where banned_at is not null)
  );
end;
$fn$;

-- 4. Droits ------------------------------------------------------------------
revoke all on function public.login_guard(text) from public;
revoke all on function public.log_login_attempt(text, boolean, text) from public;
revoke all on function public.admin_login_attempts(int) from public;
revoke all on function public.admin_clear_login_attempts() from public;
revoke all on function public.climat_report() from public;

grant execute on function public.cards_catalogue() to authenticated;
grant execute on function public.my_cards() to authenticated;
grant execute on function public.open_card_pack() to authenticated;
grant execute on function public.login_guard(text) to anon, authenticated;
grant execute on function public.log_login_attempt(text, boolean, text) to anon, authenticated;
grant execute on function public.admin_login_attempts(int) to authenticated;
grant execute on function public.admin_clear_login_attempts() to authenticated;
grant execute on function public.climat_report() to authenticated;

revoke all on table public.cards, public.card_ownership, public.card_packs, public.login_attempts from anon, authenticated;
