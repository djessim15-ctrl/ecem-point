-- ---------------------------------------------------------------------------
-- 0021 · L'auteur d'un message modifié continue de lire sa version d'origine
--
-- Quand l'encadrement réécrit un message (filtre, formule adoucie, correction),
-- tout le monde voit la nouvelle version — sauf l'auteur, qui garde son propre
-- texte sous les yeux. On mémorise donc la version initiale dans
-- `class_messages.body_avant` (une seule fois, la toute première), et
-- `class_chat_feed()` renvoie ce texte-là au compte qui a écrit le message.
--
-- Le badge « modifié » a par ailleurs disparu de l'interface : plus aucune
-- trace visuelle de la réécriture, ni pour l'auteur, ni pour les autres.
-- ---------------------------------------------------------------------------

alter table public.class_messages
  add column if not exists body_avant text;

-- 1. La modification garde une copie du texte initial -----------------------
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
     set body_avant = coalesce(body_avant, body),
         body       = v_body,
         edited_at  = now(),
         edited_by  = auth.uid()
   where id = p_id;

  if not found then
    raise exception 'MESSAGE_INTROUVABLE';
  end if;

  return jsonb_build_object('id', p_id, 'body', v_body);
end;
$fn$;

-- 2. Le fil renvoie le texte d'origine à son auteur -------------------------
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
  select m.id,
         m.author_id,
         case
           when m.edited_at is not null and m.author_id = auth.uid()
             then coalesce(m.body_avant, m.body)
           else m.body
         end,
         null::text,
         m.level, m.flagged, m.categories, m.severity, m.created_at,
         m.reply_to, m.pinned, m.is_annonce, m.hidden, m.edited_at,
         m.cible, m.motif
    from (
      select c.*
        from public.class_messages c
       where c.hidden is not true or public.is_admin()
       order by c.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) m
   order by m.created_at asc;
$fn$;

revoke all on function public.admin_message_edit(bigint, text) from public;
revoke all on function public.class_chat_feed(int) from public;
grant execute on function public.admin_message_edit(bigint, text) to authenticated;
grant execute on function public.class_chat_feed(int) to authenticated;
