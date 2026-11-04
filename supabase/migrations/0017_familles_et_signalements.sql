-- ---------------------------------------------------------------------------
-- 0017 · Les neuf familles de violences : détection, réécriture, alerte
--
-- Le filtre ne se contente plus de repérer les insultes. Il couvre aussi :
--   1. insulte ou humiliation          6. exclusion organisée
--   2. menace ou intimidation          7. rumeur ou diffamation
--   3. propos discriminatoire          8. attaque indirecte ou codée
--   4. harcèlement sexuel              9. usurpation ou manipulation
--   5. acharnement ciblé
--
-- • `contenu_interdit()` : garde serveur. Les familles les plus graves
--   (menace, harcèlement sexuel, discrimination, usurpation, exclusion
--   explicite) et les insultes sont refusées, même si le navigateur tentait
--   de contourner le filtre.
-- • `cible` : la personne visée, devinée par le client ou par l'IA. Elle
--   permet de compter l'acharnement (même cible, plusieurs messages).
-- • `class_reports` + `class_report()` : n'importe qui peut signaler un
--   message (attaque indirecte, rumeur, usurpation) ; l'encadrement le voit.
-- • `class_climate()` renvoie désormais `alertes` (acharnement par cible).
-- ---------------------------------------------------------------------------

-- 1. Colonnes ----------------------------------------------------------------
alter table public.class_messages
  add column if not exists cible text,
  add column if not exists motif text;

alter table public.private_messages
  add column if not exists cible text,
  add column if not exists motif text;

create index if not exists class_messages_cible_idx
  on public.class_messages (cible) where cible is not null;
create index if not exists class_messages_motif_idx
  on public.class_messages (motif) where motif is not null;

comment on column public.class_messages.cible is
  'Personne visée par le message (prénom), pour repérer l''acharnement.';
comment on column public.class_messages.motif is
  'Famille principale repérée par le filtre (insulte, menace, exclusion…).';

-- 2. Garde serveur : les familles les plus graves --------------------------
create or replace function public.contenu_interdit(p_texte text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  with t as (select coalesce(p_texte, '') as x)
  select case
    when public.contient_insulte(x) then 'insulte'
    when x ~* '(envoie|envoies|envoi)[ -]moi[^.!?]{0,20}(photo|nue?s?|nudes?|video)'
      or x ~* 'photo de (toi|ton corps|tes fesses)'
      or x ~* 'arr[eê]te de dire non'
      or x ~* '(montre|d[eé]shabille)[ -]toi'
      or x ~* 'suce[ -]moi'
      or x ~* 'tu es (bonne|bandante)'
      then 'harcelement_sexuel'
    when x ~* 'tu vas (le|la|me|nous) ?(regretter|payer)'
      or x ~* 'je vais te (casser|frapper|tuer|buter|faire mal)'
      or x ~* '(attention|gare) [aà] toi'
      or x ~* 'je sais o[uù] tu habites'
      or x ~* 'tu vas voir ce que'
      then 'menace'
    when x ~* 'retourne dans ton pays'
      or x ~* 'sale (arabe|juif|noir|musulman|gouine|p[eé]d[eé]|pd)'
      or x ~* '[aà] cause de (ton|ta|tes) (origine|religion|couleur|peau|handicap|accent)'
      or x ~* 'pas [aà] ta place'
      then 'discrimination'
    when x ~* 'en pr[eé]tendant [eê]tre'
      or x ~* 'fais[ -]toi passer pour'
      or x ~* 'fais semblant d.?[eê]tre'
      or x ~* '(prends|pirate|vole) (son|le) (compte|pseudo)'
      then 'usurpation'
    when x ~* 'ne (la|le) laissez pas rejoindre'
      or x ~* 'personne ne (lui )?parle plus'
      or x ~* 'on ne (lui )?parle plus'
      or x ~* 'faites[ -](le|la) partir'
      then 'exclusion'
    else null
  end
  from t;
$fn$;

comment on function public.contenu_interdit(text) is
  'Renvoie la famille d''agression détectée (ou null). Utilisée pour refuser un message côté serveur.';

-- 3. Signalements ------------------------------------------------------------
create table if not exists public.class_reports (
  id          bigserial primary key,
  message_id  bigint not null references public.class_messages(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  motif       text not null default 'signale',
  created_at  timestamptz not null default now(),
  unique (message_id, reporter_id)
);

create index if not exists class_reports_message_idx
  on public.class_reports (message_id, created_at desc);

alter table public.class_reports enable row level security;

create or replace function public.class_report(p_id bigint, p_motif text default 'signale')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_deja boolean;
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if not exists (select 1 from public.class_messages where id = p_id) then
    raise exception 'MESSAGE_INTROUVABLE';
  end if;

  if exists (select 1 from public.class_messages where id = p_id and author_id = v_uid) then
    raise exception 'CIBLE_INVALIDE';
  end if;

  select exists (
    select 1 from public.class_reports where message_id = p_id and reporter_id = v_uid
  ) into v_deja;

  if not v_deja then
    insert into public.class_reports (message_id, reporter_id, motif)
    values (p_id, v_uid, left(coalesce(nullif(btrim(p_motif), ''), 'signale'), 40));
  end if;

  return jsonb_build_object('signale', true, 'deja', v_deja);
end;
$fn$;

create or replace function public.class_reports_feed(p_limit int default 40)
returns table (
  id         bigint,
  message_id bigint,
  auteur     text,
  extrait    text,
  motif      text,
  nb         bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not (public.is_staff() or public.is_admin()) then
    raise exception 'INTERDIT';
  end if;

  return query
    select min(r.id) as id,
           r.message_id,
           p.prenom as auteur,
           left(m.body, 180) as extrait,
           max(r.motif) as motif,
           count(*) as nb,
           max(r.created_at) as created_at
      from public.class_reports r
      join public.class_messages m on m.id = r.message_id
      join public.profiles p on p.id = m.author_id
     group by r.message_id, p.prenom, m.body
     order by max(r.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 40), 200));
end;
$fn$;

-- 4. Climats + alertes d'acharnement ---------------------------------------
create or replace function public.class_climate()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_total     bigint;
  v_drapeaux  bigint;
  v_paires    jsonb;
  v_alertes   jsonb;
  v_nb_paires integer;
  v_nb_alertes integer;
  v_score     integer;
begin
  if auth.uid() is null then
    raise exception 'NON_CONNECTE';
  end if;

  select count(*) into v_total
    from public.class_messages
   where created_at > now() - interval '7 days';

  select count(*) into v_drapeaux
    from public.class_messages
   where created_at > now() - interval '7 days' and flagged;

  select coalesce(jsonb_agg(jsonb_build_object(
           'a', s.prenom, 'b', r.prenom, 'n', t.n) order by t.n desc), '[]'::jsonb),
         count(*)
    into v_paires, v_nb_paires
    from (
      select sender_id, recipient_id, count(*) as n
        from public.private_messages
       where flagged and created_at > now() - interval '30 days'
       group by 1, 2
      having count(*) >= 3
    ) t
    join public.profiles s on s.id = t.sender_id
    join public.profiles r on r.id = t.recipient_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cible', t.cible, 'messages', t.n, 'auteurs', t.auteurs) order by t.n desc), '[]'::jsonb),
         count(*)
    into v_alertes, v_nb_alertes
    from (
      select cible, count(*) as n, count(distinct author_id) as auteurs
        from public.class_messages
       where flagged and cible is not null
         and created_at > now() - interval '30 days'
       group by cible
      having count(*) >= 2
       order by 2 desc
       limit 5
    ) t;

  if v_total = 0 then
    v_score := 100;
  else
    v_score := greatest(0, least(100,
      round(100.0 * (1 - (v_drapeaux::numeric / v_total::numeric)))::int
      - 5 * coalesce(v_nb_paires, 0)
      - 3 * coalesce(v_nb_alertes, 0)
    ));
  end if;

  return jsonb_build_object(
    'score', v_score,
    'messages_7j', v_total,
    'drapeaux_7j', v_drapeaux,
    'paires', coalesce(v_paires, '[]'::jsonb),
    'nb_paires', coalesce(v_nb_paires, 0),
    'alertes', coalesce(v_alertes, '[]'::jsonb),
    'nb_alertes', coalesce(v_nb_alertes, 0)
  );
end;
$fn$;

-- 5. Droits -----------------------------------------------------------------
revoke all on function public.class_report(bigint, text) from public;
revoke all on function public.class_reports_feed(int) from public;

grant execute on function public.contenu_interdit(text) to authenticated;
grant execute on function public.class_report(bigint, text) to authenticated;
grant execute on function public.class_reports_feed(int) to authenticated;
grant execute on function public.class_climate() to authenticated;

revoke all on table public.class_reports from anon, authenticated;
