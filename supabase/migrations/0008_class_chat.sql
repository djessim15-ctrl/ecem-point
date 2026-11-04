-- ---------------------------------------------------------------------------
-- 0008 · Tchat de classe + modération IA
--
-- Tous les comptes connectés peuvent lire le tchat de classe. Personne n'écrit
-- directement dans la table : les messages passent par class_chat_send(), qui
-- contrôle le rôle, la longueur et un délai anti-flood.
--
-- La version « brute » d'un message (celle d'avant la gentillesse imposée par
-- l'IA) n'est renvoyée qu'à son auteur et à l'encadrement : la fonction
-- class_chat_feed() est SECURITY DEFINER et masque la colonne pour les autres.
-- ---------------------------------------------------------------------------

create table if not exists public.class_messages (
  id           bigserial primary key,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 800),
  body_raw     text,
  level        text not null default 'genant' check (level in ('doux', 'genant', 'ultra')),
  flagged      boolean not null default false,
  categories   text[] not null default '{}',
  severity     smallint not null default 0 check (severity between 0 and 3),
  source       text,
  created_at   timestamptz not null default now()
);

create index if not exists class_messages_created_idx
  on public.class_messages (created_at desc);
create index if not exists class_messages_author_idx
  on public.class_messages (author_id, created_at desc);

alter table public.class_messages enable row level security;

-- Aucune politique : ni lecture ni écriture directe. Tout passe par les
-- fonctions ci-dessous (même modèle que le reste de l'application).

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
  select m.id,
         m.author_id,
         m.body,
         case
           when m.author_id = auth.uid() or public.is_staff() then m.body_raw
           else null
         end as body_raw,
         m.level,
         m.flagged,
         m.categories,
         m.severity,
         m.created_at
    from (
      select *
        from public.class_messages
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$$;

create or replace function public.class_chat_send(
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

  if char_length(v_body) > 800 then
    v_body := left(v_body, 800);
  end if;

  if v_raw is not null then
    v_raw := left(v_raw, 2000);
  end if;

  -- Anti-flood : 8 messages par 30 secondes et par personne.
  if (
    select count(*)
      from public.class_messages
     where author_id = v_uid
       and created_at > now() - interval '30 seconds'
  ) >= 8 then
    raise exception 'TROP_VITE';
  end if;

  insert into public.class_messages
    (author_id, body, body_raw, level, flagged, categories, severity, source)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)), p_source)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'created_at', v_row.created_at,
    'flagged', v_row.flagged
  );
end;
$$;

create or replace function public.class_chat_delete(p_id bigint)
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

  delete from public.class_messages
   where id = p_id
     and (author_id = v_uid or public.is_staff());

  v_ok := found;
  return v_ok;
end;
$$;

grant execute on function public.class_chat_feed(int) to authenticated;
grant execute on function public.class_chat_send(text, text, text, boolean, text[], int, text) to authenticated;
grant execute on function public.class_chat_delete(bigint) to authenticated;
