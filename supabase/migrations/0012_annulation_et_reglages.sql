-- ---------------------------------------------------------------------------
-- 0012 · Annulation des mouvements + réglages de modération
--
--   • remove_points / transfer_points renvoient désormais l'identifiant de
--     l'événement créé, pour que le bouton « Annuler » sache quoi défaire.
--   • set_compliment() bascule le mode « compliment forcé » (l'IA impose la
--     version Ultra à tout le monde).
-- ---------------------------------------------------------------------------

create or replace function public.remove_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor   uuid := auth.uid();
  v_target  public.profiles;
  v_removed integer;
  v_event   uuid;
begin
  if not public.can_award() then
    raise exception 'INTERDIT';
  end if;

  if p_amount is null or p_amount < 1 then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_actor then
    raise exception 'CIBLE_INVALIDE';
  end if;

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_target.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;

  v_removed := least(p_amount, v_target.points);

  if v_removed = 0 then
    return jsonb_build_object('prenom', v_target.prenom, 'points', 0, 'retires', 0, 'event_id', null);
  end if;

  update public.profiles set points = points - v_removed where id = p_target;

  insert into public.point_events (kind, amount, subject_id, actor_id)
  values ('retrait', v_removed, p_target, v_actor)
  returning id into v_event;

  return jsonb_build_object(
    'prenom', v_target.prenom,
    'points', v_target.points - v_removed,
    'retires', v_removed,
    'event_id', v_event
  );
end
$fn$;

create or replace function public.transfer_points(p_target uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from uuid := auth.uid();
  v_min  integer;
  v_a    public.profiles;
  v_b    public.profiles;
  v_event uuid;
begin
  select transfer_min into v_min from public.app_settings where id = 1;

  if p_amount is null or p_amount < v_min then
    raise exception 'MONTANT_INVALIDE';
  end if;

  if p_target is null or p_target = v_from then
    raise exception 'CIBLE_INVALIDE';
  end if;

  if v_from < p_target then
    select * into v_a from public.profiles where id = v_from   for update;
    select * into v_b from public.profiles where id = p_target for update;
  else
    select * into v_b from public.profiles where id = p_target for update;
    select * into v_a from public.profiles where id = v_from   for update;
  end if;

  if v_a.id is null then
    raise exception 'NON_CONNECTE';
  end if;
  if v_b.id is null then
    raise exception 'ELEVE_INTROUVABLE';
  end if;
  if v_a.role <> 'eleve' then
    raise exception 'INTERDIT';
  end if;
  if v_b.role <> 'eleve' then
    raise exception 'CIBLE_INVALIDE';
  end if;
  if v_a.points < p_amount then
    raise exception 'POINTS_INSUFFISANTS';
  end if;

  update public.profiles set points = points - p_amount where id = v_from;
  update public.profiles set points = points + p_amount where id = p_target;

  insert into public.point_events (kind, amount, subject_id, counterparty_id, actor_id)
  values ('transfert', p_amount, v_from, p_target, v_from)
  returning id into v_event;

  return jsonb_build_object(
    'points',       v_a.points - p_amount,
    'cible_prenom', v_b.prenom,
    'cible_points', v_b.points + p_amount,
    'event_id',     v_event
  );
end
$fn$;

create or replace function public.set_compliment(p_on boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_staff() then
    raise exception 'INTERDIT';
  end if;

  update public.app_settings
     set compliment_force = coalesce(p_on, true), updated_at = now()
   where id = 1;

  return coalesce(p_on, true);
end;
$fn$;

grant execute on function public.remove_points(uuid, int) to authenticated;
grant execute on function public.transfer_points(uuid, int) to authenticated;
grant execute on function public.set_compliment(boolean) to authenticated;
