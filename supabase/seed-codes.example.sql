-- ============================================================================
-- ECEM Point — modèle d'insertion des codes secrets suppléant / délégué
-- ============================================================================
-- ⚠️  Ce fichier est un MODÈLE. Les vrais codes de la classe ne sont PAS dans
--     ce dépôt Git : ils ont été insérés directement dans la base, sous forme
--     d'empreinte sha256. C'est volontaire : quiconque lit le dépôt ne doit
--     pas pouvoir s'inscrire en délégué.
--
-- Un code = un compte, une seule fois. Une fois utilisé (used_by renseigné),
-- plus personne ne peut s'inscrire avec.
--
-- Pour ajouter un nouveau code, exécuter dans le SQL Editor de Supabase :
-- ============================================================================

insert into public.staff_codes (label, role, code_hash)
values
  ('Suppléant 1', 'suppleant', encode(extensions.digest('REMPLACER_PAR_LE_CODE', 'sha256'), 'hex')),
  ('Délégué 3',   'delegue',   encode(extensions.digest('REMPLACER_PAR_LE_CODE', 'sha256'), 'hex'))
on conflict (code_hash) do nothing;

-- ---------------------------------------------------------------------------
-- Voir l'état des codes (qui est libre, qui est consommé)
-- ---------------------------------------------------------------------------
select s.label,
       s.role,
       case when s.used_by is null then 'LIBRE' else 'UTILISÉ' end as etat,
       p.prenom                                as utilise_par,
       s.used_at
  from public.staff_codes s
  left join public.profiles p on p.id = s.used_by
 order by s.role, s.created_at;

-- ---------------------------------------------------------------------------
-- Réinitialiser un code (ex. un délégué a perdu son compte)
-- ---------------------------------------------------------------------------
-- update public.staff_codes
--    set used_by = null, used_at = null, claimed_token = null, claimed_at = null
--  where label = 'Délégué 1';
