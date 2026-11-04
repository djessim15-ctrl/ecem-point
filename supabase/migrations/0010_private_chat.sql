-- ---------------------------------------------------------------------------
-- 0010 · Messages privés + rôles de modération
--
-- • Deux comptes peuvent se parler en privé (private_messages).
-- • Chaque message privé passe par le même filtre de gentillesse : la version
--   brute n'est jamais renvoyée par private_feed(), elle sert uniquement au
--   journal de modération (et reste en base pour l'audit).
-- • Délégués et suppléants sont modérateurs : ils voient les messages privés
--   signalés (private_flagged) et peuvent supprimer n'importe quel message
--   (class_chat_delete / private_delete). Ils ne lisent pas les conversations
--   privées ordinaires.
-- ---------------------------------------------------------------------------

create table if not exists public.private_messages (
  id           bigserial primary key,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 800),
  body_raw     text,
  level        text not null default 'genant' check (level in ('doux', 'genant', 'ultra')),
  flagged      boolean not null default false,
  categories   text[] not null default '{}',
  severity     smallint not null default 0 check (severity between 0 and 3),
  source       text,
  created_at   timestamptz not null default now(),
  constraint private_messages_distincts check (sender_id <> recipient_id)
);

create index if not exists private_messages_sender_idx
  on public.private_messages (sender_id, created_at desc);
create index if not exists private_messages_recipient_idx
  on public.private_messages (recipient_id, created_at desc);
create index if not exists private_messages_flagged_idx
  on public.private_messages (created_at desc) where flagged;

alter table public.private_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Envoi
-- ---------------------------------------------------------------------------
create or replace function public.private_send(
  p_to         uuid,
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'genant',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_body  text := btrim(coalesce(p_body, ''));
  v_raw   text := nullif(btrim(coalesce(p_body_raw, '')), '');
  v_level text := coalesce(p_level, 'genant');
  v_row   public.private_messages;
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if p_to is null or p_to = v_uid then
    raise exception 'DESTINATAIRE_INVALIDE';
  end if;

  if not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'DESTINATAIRE_INTROUVABLE';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'MESSAGE_VIDE';
  end if;

  if v_level not in ('doux', 'genant', 'ultra') then
    raise exception 'NIVEAU_INVALIDE';
  end if;

  if char_length(v_body) > 800 then
    v_body := left(v_body, 800);
  end if;

  if v_raw is not null then
    v_raw := left(v_raw, 2000);
  end if;

  if (
    select count(*)
      from public.private_messages
     where sender_id = v_uid
       and created_at > now() - interval '30 seconds'
  ) >= 10 then
    raise exception 'TROP_VITE';
  end if;

  insert into public.private_messages
    (sender_id, recipient_id, body, body_raw, level, flagged, categories, severity, source)
  values
    (v_uid, p_to, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)), p_source)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'flagged', v_row.flagged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecture d'une conversation (la version brute n'est jamais renvoyée)
-- ---------------------------------------------------------------------------
create or replace function public.private_feed(p_with uuid, p_limit int default 200)
returns table (
  id         bigint,
  sender_id  uuid,
  recipient_id uuid,
  body       text,
  level      text,
  flagged    boolean,
  categories text[],
  severity   smallint,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select m.id, m.sender_id, m.recipient_id, m.body, m.level, m.flagged,
         m.categories, m.severity, m.created_at
    from (
      select *
        from public.private_messages
       where (sender_id = auth.uid() and recipient_id = p_with)
          or (sender_id = p_with and recipient_id = auth.uid())
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$$;

-- ---------------------------------------------------------------------------
-- Liste de mes conversations
-- ---------------------------------------------------------------------------
create or replace function public.private_threads()
returns table (
  other_id  uuid,
  prenom    text,
  role      text,
  last_body text,
  last_at   timestamptz,
  signales  bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select t.other_id,
         p.prenom,
         p.role,
         dernier.body as last_body,
         t.last_at,
         t.signales
    from (
      select case when sender_id = auth.uid() then recipient_id else sender_id end as other_id,
             max(created_at) as last_at,
             count(*) filter (where flagged) as signales
        from public.private_messages
       where sender_id = auth.uid() or recipient_id = auth.uid()
       group by 1
    ) t
    join public.profiles p on p.id = t.other_id
    left join lateral (
      select m.body
        from public.private_messages m
       where (m.sender_id = auth.uid() and m.recipient_id = t.other_id)
          or (m.sender_id = t.other_id and m.recipient_id = auth.uid())
       order by m.created_at desc
       limit 1
    ) dernier on true
   order by t.last_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Modération : réservée à l'encadrement (délégués et suppléants)
-- ---------------------------------------------------------------------------
create or replace function public.private_flagged(p_limit int default 40)
returns table (
  id           bigint,
  sender_id    uuid,
  sender       text,
  recipient_id uuid,
  recipient    text,
  categories   text[],
  severity     smallint,
  level        text,
  excerpt      text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;

  return query
    select m.id,
           m.sender_id,
           s.prenom,
           m.recipient_id,
           r.prenom,
           m.categories,
           m.severity,
           m.level,
           left(coalesce(m.body_raw, m.body), 180),
           m.created_at
      from public.private_messages m
      join public.profiles s on s.id = m.sender_id
      join public.profiles r on r.id = m.recipient_id
     where m.flagged
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 40), 100));
end;
$$;

create or replace function public.private_delete(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean := false;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;

  delete from public.private_messages where id = p_id;
  v_ok := found;
  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------------
-- Le tchat de classe ne renvoie plus la version brute : le bouton
-- « voir l'original » disparaît, la donnée reste en base pour l'audit.
-- ---------------------------------------------------------------------------
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
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select m.id, m.author_id, m.body, null::text as body_raw, m.level, m.flagged,
         m.categories, m.severity, m.created_at
    from (
      select *
        from public.class_messages
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$$;

grant execute on function public.private_send(uuid, text, text, text, boolean, text[], int, text) to authenticated;
grant execute on function public.private_feed(uuid, int) to authenticated;
grant execute on function public.private_threads() to authenticated;
grant execute on function public.private_flagged(int) to authenticated;
grant execute on function public.private_delete(bigint) to authenticated;
