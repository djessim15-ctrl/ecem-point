-- ---------------------------------------------------------------------------
-- 0016 · Rôles clarifiés, annonces, modération des messages par l'admin
--
-- • Le filtre de gentillesse devient INVIOLABLE : le serveur refuse tout
--   message qui contient encore une insulte. Impossible de le contourner en
--   désactivant quoi que ce soit côté navigateur.
-- • Délégués, suppléants et admins peuvent publier des ANNONCES (messages
--   épinglés en haut du tchat de classe, filtrés comme le reste).
-- • L'admin peut MASQUER (bloquer), MODIFIER et SUPPRIMER n'importe quel
--   message du tchat de classe. Les messages masqués disparaissent pour tout
--   le monde sauf pour l'admin, qui peut les rétablir.
-- ---------------------------------------------------------------------------

-- 1. Nouvelles colonnes ------------------------------------------------------
alter table public.class_messages
  add column if not exists is_annonce boolean not null default false,
  add column if not exists hidden     boolean not null default false,
  add column if not exists hidden_at  timestamptz,
  add column if not exists hidden_by  uuid references public.profiles(id) on delete set null,
  add column if not exists edited_at  timestamptz,
  add column if not exists edited_by  uuid references public.profiles(id) on delete set null;

create index if not exists class_messages_annonce_idx
  on public.class_messages (created_at desc) where is_annonce;

comment on column public.class_messages.is_annonce is 'Annonce publiée par un délégué, un suppléant ou un admin.';
comment on column public.class_messages.hidden     is 'Message masqué (bloqué) par un admin : invisible pour tous sauf les admins.';

-- 2. Filtre inviolable : détection d'insulte côté serveur --------------------
create or replace function public.contient_insulte(p_texte text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select coalesce(p_texte, '') ~* (
    '\m(' ||
    'abrut\w*|attard\w*|b[aâ]tard\w*|bouffon\w*|con|conne|connard\w*|connasse\w*|' ||
    'cr[eé]tin\w*|d[eé]bile\w*|d[eé]gueu\w*|encul\w*|fdp|grognasse\w*|' ||
    'imb[eé]cile\w*|idiot\w*|merde\w*|mongol\w*|naze|nique\w*|nul|' ||
    'p[eé]d[eé]\w*|pouffiasse\w*|pute\w*|putain|salaud\w*|salope\w*|' ||
    'stupide\w*|tapette\w*|tarlouze\w*|ta gueule|ferme la|' ||
    'casse toi|d[eé]gage'
    ')\M'
  );
$fn$;

comment on function public.contient_insulte(text) is
  'Vrai si le texte contient encore une insulte : le serveur refuse alors le message (filtre inviolable).';

-- 3. Lecture du tchat : annonces, masquage, édition ------------------------
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
  edited_at  timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select m.id, m.author_id, m.body, null::text, m.level, m.flagged,
         m.categories, m.severity, m.created_at, m.reply_to, m.pinned,
         m.is_annonce, m.hidden, m.edited_at
    from (
      select c.*
        from public.class_messages c
       where c.hidden is not true or public.is_admin()
       order by c.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$fn$;

-- 4. Envoi d'un message de classe : insulte refusée ------------------------
create or replace function public.class_chat_send(
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
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

  -- Filtre inviolable : aucune insulte ne peut être publiée, même si le
  -- navigateur essayait de contourner le filtre.
  if public.contient_insulte(v_body) then
    raise exception 'INSULTE_INTERDITE';
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
    (author_id, body, body_raw, level, flagged, categories, severity, source, reply_to)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source, p_reply_to)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'created_at', v_row.created_at, 'flagged', v_row.flagged);
end;
$fn$;

-- 5. Envoi d'un message privé : insulte refusée ---------------------------
create or replace function public.private_send(
  p_to         uuid,
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null
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

  if public.contient_insulte(v_body) then
    raise exception 'INSULTE_INTERDITE';
  end if;

  if (
    select count(*) from public.private_messages
     where sender_id = v_uid and created_at > now() - interval '30 seconds'
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
$fn$;

-- 6. Annonces (délégués, suppléants, admins) -------------------------------
create or replace function public.class_annonce_send(
  p_body       text,
  p_body_raw   text   default null,
  p_level      text   default 'doux',
  p_flagged    boolean default false,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_source     text   default null
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

  if public.contient_insulte(v_body) then
    raise exception 'INSULTE_INTERDITE';
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
    (author_id, body, body_raw, level, flagged, categories, severity, source, is_annonce)
  values
    (v_uid, v_body, v_raw, v_level, coalesce(p_flagged, false),
     coalesce(p_categories, '{}'), greatest(0, least(coalesce(p_severity, 0), 3)),
     p_source, true)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'created_at', v_row.created_at,
    'annonce', true,
    'flagged', v_row.flagged
  );
end;
$fn$;

-- 7. Modération des messages par l'admin -----------------------------------
create or replace function public.admin_message_hide(p_id bigint, p_hidden boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_masquer boolean := coalesce(p_hidden, true);
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  update public.class_messages
     set hidden    = v_masquer,
         hidden_at = case when v_masquer then now() else null end,
         hidden_by = case when v_masquer then auth.uid() else null end
   where id = p_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE';
  end if;

  return jsonb_build_object('id', p_id, 'hidden', v_masquer);
end;
$fn$;

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

  if public.contient_insulte(v_body) then
    raise exception 'INSULTE_INTERDITE';
  end if;

  update public.class_messages
     set body      = v_body,
         edited_at = now(),
         edited_by = auth.uid()
   where id = p_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE';
  end if;

  return jsonb_build_object('id', p_id, 'body', v_body);
end;
$fn$;

create or replace function public.admin_message_delete(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ok boolean := false;
begin
  if not public.is_admin() then
    raise exception 'INTERDIT';
  end if;

  delete from public.class_messages where id = p_id;
  v_ok := found;
  return v_ok;
end;
$fn$;

-- Un admin n'a pas forcément le rôle « délégué » : on l'autorise aussi à
-- épingler et à supprimer via les fonctions historiques.
create or replace function public.class_chat_delete(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ok  boolean := false;
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  delete from public.class_messages
   where id = p_id
     and (author_id = v_uid or public.is_staff() or public.is_admin());

  v_ok := found;
  return v_ok;
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
  if not (public.is_staff() or public.is_admin()) then
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

-- 8. Droits -----------------------------------------------------------------
revoke all on function public.class_annonce_send(text, text, text, boolean, text[], int, text) from public;
revoke all on function public.admin_message_hide(bigint, boolean) from public;
revoke all on function public.admin_message_edit(bigint, text)    from public;
revoke all on function public.admin_message_delete(bigint)         from public;

grant execute on function public.contient_insulte(text) to authenticated;
grant execute on function public.class_chat_feed(int) to authenticated;
grant execute on function public.class_annonce_send(text, text, text, boolean, text[], int, text) to authenticated;
grant execute on function public.admin_message_hide(bigint, boolean) to authenticated;
grant execute on function public.admin_message_edit(bigint, text)    to authenticated;
grant execute on function public.admin_message_delete(bigint)         to authenticated;
