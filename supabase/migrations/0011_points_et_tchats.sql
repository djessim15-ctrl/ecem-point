-- ---------------------------------------------------------------------------
-- 0011 · Progression, justice et vie du tchat
--
--   • Annulation d'un mouvement de points dans les 15 secondes.
--   • Heure dorée : tous les points comptent double pendant N minutes.
--   • Roue de la fortune : un tirage par semaine et par élève.
--   • Réactions emoji, réponses citées et messages épinglés dans le tchat.
--   • Score de climat de classe + paires de harcèlement répété.
-- ---------------------------------------------------------------------------

-- 1. Réglages ---------------------------------------------------------------
alter table public.app_settings
  add column if not exists golden_until     timestamptz,
  add column if not exists golden_multiplier integer not null default 2
    check (golden_multiplier between 1 and 5),
  add column if not exists compliment_force boolean not null default false;

-- 2. Heure dorée : award_points applique le multiplicateur -------------------
create or replace function public.award_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_min    integer;
  v_max    integer;
  v_golden boolean;
  v_mult   integer;
  v_amount integer;
  v_event  uuid;
  v_target public.profiles;
begin
  if not public.can_award() then
    raise exception 'INTERDIT';
  end if;

  select award_min, award_max, golden_multiplier,
         (golden_until is not null and golden_until > now())
    into v_min, v_max, v_mult, v_golden
    from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_actor then
    raise exception 'CIBLE_INVALIDE';
  end if;

  v_amount := p_amount * case when v_golden then coalesce(v_mult, 2) else 1 end;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_target.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;

  update public.profiles set points = points + v_amount where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('gain', v_amount, p_target, v_actor)
  returning id into v_event;

  return jsonb_build_object(
    'prenom', v_target.prenom,
    'points', v_target.points + v_amount,
    'amount', v_amount,
    'bonus', v_amount - p_amount,
    'event_id', v_event
  );
end
$fn$;

-- 3. Annulation d'un mouvement (15 s) ---------------------------------------
create or replace function public.cancel_event(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ev  public.point_events;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  select * into v_ev from public.point_events where id = p_event for update;
  if not found then
    raise exception 'INTROUVABLE';
  end if;

  if v_ev.actor_id is distinct from v_uid then
    raise exception 'INTERDIT';
  end if;

  if v_ev.created_at < now() - interval '15 seconds' then
    raise exception 'TROP_TARD';
  end if;

  if v_ev.kind = 'gain' then
    update public.profiles set points = greatest(0, points - v_ev.amount) where id = v_ev.subject_id;
  elsif v_ev.kind = 'retrait' then
    update public.profiles set points = points + v_ev.amount where id = v_ev.subject_id;
  elsif v_ev.kind = 'transfert' then
    update public.profiles set points = greatest(0, points - v_ev.amount) where id = v_ev.subject_id;
    update public.profiles set points = points + v_ev.amount where id = v_ev.counterparty_id;
  end if;

  delete from public.point_events where id = p_event;

  return jsonb_build_object('annule', true, 'kind', v_ev.kind, 'amount', v_ev.amount);
end;
$fn$;

-- 4. Heure dorée ------------------------------------------------------------
create or replace function public.start_golden(p_minutes integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_fin timestamptz;
begin
  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;

  v_fin := now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 30), 180)));

  update public.app_settings set golden_until = v_fin, updated_at = now() where id = 1;
  return v_fin;
end;
$fn$;

create or replace function public.stop_golden()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;
  update public.app_settings set golden_until = null, updated_at = now() where id = 1;
end;
$fn$;

-- 5. Roue de la fortune (un tour par semaine) -------------------------------
create table if not exists public.wheel_spins (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  amount     integer not null check (amount between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.wheel_spins enable row level security;

create or replace function public.wheel_state()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select jsonb_build_object(
    'deja', exists (
      select 1 from public.wheel_spins
       where user_id = auth.uid()
         and week_start = date_trunc('week', now())::date
    ),
    'dernier', (
      select amount from public.wheel_spins
       where user_id = auth.uid()
         and week_start = date_trunc('week', now())::date
    )
  );
$fn$;

create or replace function public.wheel_spin()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_lundi  date := date_trunc('week', now())::date;
  v_gain   integer;
  v_roue   integer[] := array[1, 1, 1, 2, 2, 3, 5];
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if public.my_role() <> 'eleve' then
    raise exception 'RESERVE_ELEVES';
  end if;

  if exists (select 1 from public.wheel_spins where user_id = v_uid and week_start = v_lundi) then
    raise exception 'DEJA_TOURNE';
  end if;

  v_gain := v_roue[1 + floor(random() * array_length(v_roue, 1))::int];

  insert into public.wheel_spins (user_id, week_start, amount) values (v_uid, v_lundi, v_gain);

  update public.profiles set points = points + v_gain where id = v_uid;
  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('gain', v_gain, v_uid, null);

  return jsonb_build_object('gain', v_gain);
end;
$fn$;

-- 6. Tchat : réponses, épingles, réactions ----------------------------------
alter table public.class_messages
  add column if not exists reply_to  bigint references public.class_messages (id) on delete set null,
  add column if not exists pinned    boolean not null default false,
  add column if not exists pinned_at timestamptz;

drop function if exists public.class_chat_feed(int);
drop function if exists public.class_chat_send(text, text, text, boolean, text[], int, text);

create or replace function public.class_chat_feed(p_limit int default 200)
returns table (
  id         bigint,
  author_id  uuid,
  body       text,
  body_raw   text,
  level      text,
  flagged    boolean,
  categories text[],
  severity   smallint,
  created_at timestamptz,
  reply_to   bigint,
  pinned     boolean
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select m.id, m.author_id, m.body, null::text, m.level, m.flagged,
         m.categories, m.severity, m.created_at, m.reply_to, m.pinned
    from (
      select *
        from public.class_messages
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$fn$;

create or replace function public.class_chat_send(
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'genant',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null,
  p_reply_to   bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_body  text := btrim(coalesce(p_body, ''));
  v_raw   text := nullif(btrim(coalesce(p_body_raw, '')), '');
  v_level text := coalesce(p_level, 'genant');
  v_row   public.class_messages;
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'MESSAGE_VIDE';
  end if;
  if v_level not in ('doux', 'genant', 'ultra') then
    raise exception 'NIVEAU_INVALIDE';
  end if;

  if char_length(v_body) > 800 then v_body := left(v_body, 800); end if;
  if v_raw is not null then v_raw := left(v_raw, 2000); end if;

  if p_reply_to is not null
     and not exists (select 1 from public.class_messages where id = p_reply_to) then
    p_reply_to := null;
  end if;

  if (
    select count(*) from public.class_messages
     where author_id = v_uid and created_at > now() - interval '30 seconds'
  ) >= 8 then
    raise exception 'TROP_VITE';
  end if;

  insert into public.class_messages
    (author_id, body, body_raw, level, flagged, categories, severity, source, reply_to)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source, p_reply_to)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'flagged', v_row.flagged);
end;
$fn$;

create or replace function public.class_chat_pin(p_id bigint, p_pinned boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ok boolean := false;
begin
  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;

  update public.class_messages
     set pinned = coalesce(p_pinned, true),
         pinned_at = case when coalesce(p_pinned, true) then now() else null end
   where id = p_id;

  v_ok := found;
  return v_ok;
end;
$fn$;

create table if not exists public.class_reactions (
  message_id bigint not null references public.class_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists class_reactions_message_idx
  on public.class_reactions (message_id);

alter table public.class_reactions enable row level security;

create or replace function public.class_react(p_message bigint, p_emoji text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if p_emoji is null or char_length(btrim(p_emoji)) = 0 or char_length(p_emoji) > 8 then
    raise exception 'EMOJI_INVALIDE';
  end if;

  if exists (
    select 1 from public.class_reactions
     where message_id = p_message and user_id = v_uid and emoji = p_emoji
  ) then
    delete from public.class_reactions
     where message_id = p_message and user_id = v_uid and emoji = p_emoji;
  else
    insert into public.class_reactions (message_id, user_id, emoji)
    values (p_message, v_uid, p_emoji)
    on conflict do nothing;
  end if;
end;
$fn$;

create or replace function public.class_reactions_feed(p_limit int default 300)
returns table (message_id bigint, emoji text, total bigint, moi boolean)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select r.message_id, r.emoji, count(*) as total,
         bool_or(r.user_id = auth.uid()) as moi
    from public.class_reactions r
    join (
      select id from public.class_messages order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 300), 500))
    ) m on m.id = r.message_id
   group by r.message_id, r.emoji;
$fn$;

-- 7. Climat de classe --------------------------------------------------------
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
  v_score     integer;
  v_nb_paires integer;
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

  if v_total = 0 then
    v_score := 100;
  else
    v_score := greatest(0, least(100,
      round(100.0 * (1 - (v_drapeaux::numeric / v_total::numeric)))::int
      - 5 * coalesce(v_nb_paires, 0)
    ));
  end if;

  return jsonb_build_object(
    'score', v_score,
    'messages_7j', v_total,
    'drapeaux_7j', v_drapeaux,
    'paires', coalesce(v_paires, '[]'::jsonb),
    'nb_paires', coalesce(v_nb_paires, 0)
  );
end;
$fn$;

grant execute on function public.award_points(uuid, int) to authenticated;
grant execute on function public.cancel_event(uuid) to authenticated;
grant execute on function public.start_golden(int) to authenticated;
grant execute on function public.stop_golden() to authenticated;
grant execute on function public.wheel_state() to authenticated;
grant execute on function public.wheel_spin() to authenticated;
grant execute on function public.class_chat_feed(int) to authenticated;
grant execute on function public.class_chat_send(text, text, text, boolean, text[], int, text, bigint) to authenticated;
grant execute on function public.class_chat_pin(bigint, boolean) to authenticated;
grant execute on function public.class_react(bigint, text) to authenticated;
grant execute on function public.class_reactions_feed(int) to authenticated;
grant execute on function public.class_climate() to authenticated;
