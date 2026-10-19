-- ============================================================================
-- ECEM Point — Migration 0002 : Row Level Security
-- ============================================================================
-- Principe : le client ne fait AUCUNE écriture directe.
-- Toutes les mutations passent par des fonctions RPC (migration 0003) qui sont
-- SECURITY DEFINER, donc auditées et bornées côté serveur.
-- Résultat : un élève ne peut pas s'ajouter de points en bidouillant le JS.
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.staff_codes    enable row level security;
alter table public.point_events   enable row level security;
alter table public.staff_messages enable row level security;
alter table public.app_settings   enable row level security;

-- ---------------------------------------------------------------------------
-- profiles : lecture pour tout compte connecté (trombinoscope, classement,
-- choix du destinataire d'un transfert). Écriture interdite -> RPC uniquement.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- app_settings : lecture pour tout compte connecté (l'interface s'adapte aux
-- règles, ex. afficher ou non les boutons +1..+4 pour un suppléant).
-- ---------------------------------------------------------------------------
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- point_events : un élève voit uniquement ce qui le concerne,
-- un délégué / suppléant voit tout le journal de la classe.
-- ---------------------------------------------------------------------------
drop policy if exists point_events_select on public.point_events;
create policy point_events_select on public.point_events
  for select to authenticated
  using (
    public.is_staff()
    or subject_id      = auth.uid()
    or counterparty_id = auth.uid()
    or actor_id        = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- staff_messages : le tchat n'existe que pour les délégués et suppléants.
-- Un élève ne voit rien et ne peut rien poster.
-- ---------------------------------------------------------------------------
drop policy if exists staff_messages_select on public.staff_messages;
create policy staff_messages_select on public.staff_messages
  for select to authenticated
  using (public.is_staff());

drop policy if exists staff_messages_insert on public.staff_messages;
create policy staff_messages_insert on public.staff_messages
  for insert to authenticated
  with check (public.is_staff() and author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- staff_codes : RLS activée + aucune politique + aucun droit accordé.
-- La table est donc totalement invisible depuis le navigateur ; seules les
-- fonctions SECURITY DEFINER (propriétaire postgres) peuvent la lire.
-- ---------------------------------------------------------------------------
