/* ============================================================================
 * ECEM Point — configuration
 * ----------------------------------------------------------------------------
 * Ces deux valeurs sont PUBLIQUES par conception : c'est la clé « anon » de
 * Supabase, conçue pour être exposée dans un navigateur. La sécurité ne repose
 * PAS sur elle mais sur les règles RLS + les fonctions SQL du dossier
 * /supabase. Un visiteur qui la récupère ne peut rien faire de plus que ce que
 * le site autorise déjà.
 *
 * Pour brancher le site sur un autre projet Supabase : remplacer l'URL et la
 * clé ci-dessous, puis rejouer les migrations de /supabase/migrations.
 * ==========================================================================*/
window.ECEM_CONFIG = {
  SUPABASE_URL: 'https://qrpblycsztdelikvurah.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycGJseWNzenRkZWxpa3Z1cmFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MDExNjIsImV4cCI6MjEwNzk3NzE2Mn0.CuwctXCNWMhK9MYJH8-fs89WDdeexNn9WT9zAez-Nmk',

  /* Nom affiché dans l'interface. */
  APP_NAME: 'ECEM Point',

  /* Intervalle du battement de cœur qui marque un compte comme « connecté ». */
  HEARTBEAT_MS: 25000
};
