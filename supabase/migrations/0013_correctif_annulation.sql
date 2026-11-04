-- ---------------------------------------------------------------------------
-- 0013 · Correctif : annulation d'un transfert de points
--
--   Dans un transfert, point_events.subject_id est l'EXPÉDITEUR (celui qui
--   perd les points) et counterparty_id le DESTINATAIRE. La version 0011
--   d'cancel_event() faisait l'inverse : elle retirait encore des points à
--   l'expéditeur et en redonnait au destinataire (A=2 / B=18 au lieu de
--   10 / 10 dans les tests).
--
--   Le montant rendu est plafonné à ce que le destinataire possède encore,
--   pour ne jamais créer de points à partir de rien.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_event(p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_ev      public.point_events;
  v_retour  integer;
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
    update public.profiles
       set points = greatest(0, points - v_ev.amount)
     where id = v_ev.subject_id;

  elsif v_ev.kind = 'retrait' then
    update public.profiles
       set points = points + v_ev.amount
     where id = v_ev.subject_id;

  elsif v_ev.kind = 'transfert' then
    -- subject_id = expéditeur (il récupère), counterparty_id = destinataire.
    select least(v_ev.amount, p.points) into v_retour
      from public.profiles p
     where p.id = v_ev.counterparty_id;

    v_retour := coalesce(v_retour, 0);

    if v_retour > 0 then
      update public.profiles set points = points - v_retour where id = v_ev.counterparty_id;
      update public.profiles set points = points + v_retour where id = v_ev.subject_id;
    end if;
  end if;

  delete from public.point_events where id = p_event;

  return jsonb_build_object('annule', true, 'kind', v_ev.kind, 'amount', v_ev.amount);
end;
$fn$;

revoke all on function public.cancel_event(uuid) from public;
grant execute on function public.cancel_event(uuid) to authenticated;
