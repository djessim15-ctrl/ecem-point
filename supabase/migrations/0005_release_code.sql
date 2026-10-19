-- ============================================================================
-- ECEM Point — Migration 0005 : libérer une réservation de code
-- ============================================================================
-- Cas concret : un délégué s'inscrit, le code est réservé, mais l'activation
-- échoue (prénom déjà pris par exemple). La transaction d'activation est
-- annulée, donc la réservation — elle, reste en base pour 10 minutes.
-- Cette fonction permet au site d'annuler la réservation tout de suite pour que
-- la personne puisse réessayer immédiatement avec le même code.
--
-- Le jeton ne donne aucun pouvoir : il ne fait que libérer une ligne que ce
-- même jeton avait verrouillée.
-- ============================================================================

create or replace function public.release_staff_code(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_token is null then
    return false;
  end if;

  update public.staff_codes
     set claimed_token = null,
         claimed_at    = null
   where claimed_token = p_token
     and used_by is null;

  return found;
end
$fn$;

grant execute on function public.release_staff_code(uuid) to anon, authenticated;
