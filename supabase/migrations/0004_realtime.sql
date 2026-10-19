-- ============================================================================
-- ECEM Point — Migration 0004 : temps réel
-- ============================================================================
-- Publie les tables dans le canal Realtime de Supabase. Le site s'y abonne et
-- se met à jour tout seul : un point donné par un délégué apparaît
-- immédiatement sur l'écran de l'élève, et le tchat défile en direct.
-- La RLS reste appliquée : un élève ne reçoit que les lignes qu'il a le droit
-- de voir (son propre historique), jamais le tchat des délégués.
-- ============================================================================

do $do$
declare
  t text;
begin
  foreach t in array array['profiles', 'point_events', 'staff_messages']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname   = 'supabase_realtime'
         and schemaname = 'public'
         and tablename  = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$do$;

-- Vérification rapide (doit renvoyer 3 lignes) :
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';
