-- ---------------------------------------------------------------------------
-- 0018 · Envoi des messages : cible, motif, garde serveur élargie
--
-- Les trois fonctions d'envoi enregistrent maintenant :
--   • `motif` : la famille repérée par le filtre (insulte, menace…)
--   • `cible` : la personne visée (prénom), pour compter l'acharnement
-- et refusent tout message dont `contenu_interdit()` reconnaît encore une
-- agression (insulte, menace, harcèlement sexuel, discrimination, usurpation,
-- exclusion explicite).
-- ---------------------------------------------------------------------------

drop function if exists public.class_chat_send(text, text, text, boolean, text[], int, text, bigint);
drop function if exists public.private_send(uuid, text, text, text, boolean, text[], int, text);
drop function if exists public.class_annonce_send(text, text, text, boolean, text[], int, text);

create or replace function public.class_chat_send(
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null,
  p_reply_to   bigint default null,
  p_cible      text   default null,
  p_motif      text   default null
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
  v_level text := coalesce(p_level, 'doux');
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

  -- Filtre inviolable : le serveur refuse tout reste d'agression.
  if public.contenu_interdit(v_body) is not null then
    raise exception 'CONTENU_INTERDIT';
  end if;

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
    (author_id, body, body_raw, level, flagged, categories, severity, source,
     reply_to, cible, motif)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source, p_reply_to,
     nullif(left(btrim(coalesce(p_cible, '')), 40), ''),
     nullif(left(btrim(coalesce(p_motif, '')), 40), ''))
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'flagged', v_row.flagged);
end;
$fn$;

create or replace function public.private_send(
  p_to         uuid,
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null,
  p_cible      text   default null,
  p_motif      text   default null
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
  v_level text := coalesce(p_level, 'doux');
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

  if char_length(v_body) > 800 then v_body := left(v_body, 800); end if;
  if v_raw is not null then v_raw := left(v_raw, 2000); end if;

  if public.contenu_interdit(v_body) is not null then
    raise exception 'CONTENU_INTERDIT';
  end if;

  if (
    select count(*) from public.private_messages
     where sender_id = v_uid and created_at > now() - interval '30 seconds'
  ) >= 10 then
    raise exception 'TROP_VITE';
  end if;

  insert into public.private_messages
    (sender_id, recipient_id, body, body_raw, level, flagged, categories, severity,
     source, cible, motif)
  values
    (v_uid, p_to, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source,
     nullif(left(btrim(coalesce(p_cible, '')), 40), ''),
     nullif(left(btrim(coalesce(p_motif, '')), 40), ''))
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'flagged', v_row.flagged);
end;
$fn$;

create or replace function public.class_annonce_send(
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null,
  p_cible      text   default null,
  p_motif      text   default null
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
  v_level text := coalesce(p_level, 'doux');
  v_row   public.class_messages;
begin
  if v_uid is null or public.my_role() is null then
    raise exception 'NON_CONNECTE';
  end if;

  if not (public.is_staff() or public.is_admin()) then
    raise exception 'INTERDIT';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'MESSAGE_VIDE';
  end if;

  if v_level not in ('doux', 'genant', 'ultra') then
    raise exception 'NIVEAU_INVALIDE';
  end if;

  if char_length(v_body) > 800 then v_body := left(v_body, 800); end if;
  if v_raw is not null then v_raw := left(v_raw, 2000); end if;

  if public.contenu_interdit(v_body) is not null then
    raise exception 'CONTENU_INTERDIT';
  end if;

  if (
    select count(*) from public.class_messages
     where author_id = v_uid
       and is_annonce
       and created_at > now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'TROP_VITE';
  end if;

  insert into public.class_messages
    (author_id, body, body_raw, level, flagged, categories, severity, source,
     is_annonce, cible, motif)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source, true,
     nullif(left(btrim(coalesce(p_cible, '')), 40), ''),
     nullif(left(btrim(coalesce(p_motif, '')), 40), ''))
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'created_at', v_row.created_at,
    'annonce', true,
    'flagged', v_row.flagged
  );
end;
$fn$;

-- L'admin non plus ne peut pas publier une agression en modifiant un message.
create or replace function public.admin_message_edit(p_id bigint, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'MESSAGE_VIDE';
  end if;

  if char_length(v_body) > 800 then
    v_body := left(v_body, 800);
  end if;

  if public.contenu_interdit(v_body) is not null then
    raise exception 'CONTENU_INTERDIT';
  end if;

  update public.class_messages
     set body = v_body, edited_at = now(), edited_by = auth.uid()
   where id = p_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE';
  end if;

  return jsonb_build_object('id', p_id, 'body', v_body);
end;
$fn$;

-- Les messages de classe exposent aussi la cible et le motif.
drop function if exists public.class_chat_feed(int);

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
  pinned     boolean,
  is_annonce boolean,
  hidden     boolean,
  edited_at  timestamptz,
  cible      text,
  motif      text
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select m.id, m.author_id, m.body, null::text, m.level, m.flagged,
         m.categories, m.severity, m.created_at, m.reply_to, m.pinned,
         m.is_annonce, m.hidden, m.edited_at, m.cible, m.motif
    from (
      select c.*
        from public.class_messages c
       where c.hidden is not true or public.is_admin()
       order by c.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$fn$;

-- 6. Droits -----------------------------------------------------------------
grant execute on function public.class_chat_feed(int) to authenticated;
grant execute on function public.class_chat_send(text, text, text, boolean, text[], int, text, bigint, text, text) to authenticated;
grant execute on function public.private_send(uuid, text, text, text, boolean, text[], int, text, text, text) to authenticated;
grant execute on function public.class_annonce_send(text, text, text, boolean, text[], int, text, text, text) to authenticated;
