-- ---------------------------------------------------------------------------
-- 0009 · Modération IA (Groq GPT-OSS 120B) branchée sur le tchat de classe
--
-- L'appel à Groq se fait depuis l'Edge Function `moderate` : la clé API vit
-- dans les secrets Supabase (GROQ_API_KEY), jamais dans le dépôt public.
-- Ces fonctions ne font que journaliser ce que l'IA a décidé et exposer des
-- agrégats pour le panneau « Détections ».
-- ---------------------------------------------------------------------------

create table if not exists public.moderation_events (
  id         bigserial primary key,
  message_id bigint references public.class_messages(id) on delete set null,
  author_id  uuid references public.profiles(id) on delete cascade,
  categories text[] not null default '{}',
  severity   smallint not null default 0,
  level      text,
  source     text,
  excerpt    text,
  created_at timestamptz not null default now()
);

create index if not exists moderation_events_created_idx
  on public.moderation_events (created_at desc);

alter table public.moderation_events enable row level security;

create or replace function public.moderation_log(
  p_message_id bigint,
  p_categories text[] default '{}',
  p_severity   int    default 0,
  p_level      text   default null,
  p_source     text   default null,
  p_excerpt    text   default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NON_CONNECTE';
  end if;

  insert into public.moderation_events
    (message_id, author_id, categories, severity, level, source, excerpt)
  values
    (p_message_id, v_uid, coalesce(p_categories, '{}'),
     greatest(0, least(coalesce(p_severity, 0), 3)), p_level, p_source,
     left(coalesce(p_excerpt, ''), 180));
end;
$$;

-- Journal : l'encadrement voit tout, un élève ne voit que ses propres détections.
create or replace function public.moderation_feed(p_limit int default 60)
returns table (
  id         bigint,
  author_id  uuid,
  prenom     text,
  categories text[],
  severity   smallint,
  level      text,
  source     text,
  excerpt    text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select e.id,
         e.author_id,
         p.prenom,
         e.categories,
         e.severity,
         e.level,
         e.source,
         e.excerpt,
         e.created_at
    from public.moderation_events e
    left join public.profiles p on p.id = e.author_id
   where public.is_staff() or e.author_id = auth.uid()
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

create or replace function public.moderation_stats()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with visible as (
    select *
      from public.moderation_events
     where public.is_staff() or author_id = auth.uid()
  )
  select jsonb_build_object(
    'total',       (select count(*) from visible),
    'dernier_jour',(select count(*) from visible where created_at > now() - interval '24 hours'),
    'par_niveau',  coalesce((select jsonb_object_agg(coalesce(level, 'genant'), n)
                               from (select level, count(*) n from visible group by level) t), '{}'::jsonb),
    'par_categorie', coalesce((select jsonb_object_agg(cat, n)
                               from (select unnest(categories) cat, count(*) n
                                       from visible group by 1) t), '{}'::jsonb),
    'par_auteur', coalesce((select jsonb_agg(jsonb_build_object('prenom', p.prenom, 'n', t.n) order by t.n desc)
                              from (select author_id, count(*) n from visible group by 1
                                     order by n desc limit 5) t
                              left join public.profiles p on p.id = t.author_id), '[]'::jsonb)
  );
$$;

grant execute on function public.moderation_log(bigint, text[], int, text, text, text) to authenticated;
grant execute on function public.moderation_feed(int) to authenticated;
grant execute on function public.moderation_stats() to authenticated;
