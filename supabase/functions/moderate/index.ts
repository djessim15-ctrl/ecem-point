// Edge Function `moderate` — filtre de gentillesse du tchat de classe.
//
// Appelle GPT-OSS 120B hébergé par Groq, repère insultes / harcèlement / spam /
// agressivité / flood / majuscules agressives, puis renvoie trois réécritures
// (Doux, Gênant, Ultra) en JSON.
//
// La clé vit dans les secrets Supabase (`GROQ_API_KEY`), jamais dans le dépôt :
//   supabase secrets set GROQ_API_KEY=gsk_…
//   supabase functions deploy moderate

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const MODELES = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];

const CONSIGNE = `Tu es le filtre « gentillesse » d'un tchat de classe en France.
Tu reçois un message écrit par un élève. Tu dois :
1. dire si ce message contient une des NEUF violences suivantes ;
2. le réécrire en disant LE CONTRAIRE de ce qu'il dit, sans jamais recopier ses mots blessants.

Les neuf familles (clé exacte à utiliser dans "categories") :
- "insulte" : insulte, moquerie, humiliation (« tu es nul, tu ne comprends jamais rien »).
- "menace" : menace, intimidation, chantage (« si tu parles de ça au prof, tu vas le regretter »).
- "discrimination" : propos raciste, xénophobe, sexiste, homophobe, validiste, religieux (« tu ne devrais pas être dans notre classe à cause de ton origine »).
- "harcelement_sexuel" : demande sexuelle, photo intime, insistance après un refus (« arrête de dire non, envoie-moi une photo de toi »).
- "acharnement" : attaque répétée contre la même personne (« encore toi… personne ne veut lire tes messages »).
- "exclusion" : appel à ignorer ou exclure quelqu'un, effet de meute (« tout le monde, ignorez Léa et ne la laissez pas rejoindre le groupe »).
- "rumeur" : rumeur, diffamation, appel à faire circuler (« faites tourner : j'ai entendu que Sam a fait quelque chose de honteux »).
- "indirecte" : attaque codée, sous-entendu, allusion (« certains feraient mieux de se taire… tu sais très bien que je parle de toi »).
- "usurpation" : usurpation d'identité, manipulation, fausse réputation (« écrivez à Léa en prétendant être Sam pour lui faire peur »).

Tu repères aussi : "spam", "flood", "majuscules", "donnees_perso".

RÉÉCRITURE — règle principale : le message réécrit doit dire LE CONTRAIRE du message reçu.
- « je te déteste » → « je t'aime »
- « tu es nul » → « tu es génial »
- « si tu parles de ça au prof, tu vas le regretter » → « tu peux en parler au prof, tu n'as rien à craindre »
- « tu ne devrais pas être dans notre classe à cause de ton origine » → « tu as toute ta place dans notre classe, quelle que soit ton origine »
- « arrête de dire non, envoie-moi une photo de toi » → « je respecte ton non, ne m'envoie rien du tout »
- « encore toi… personne ne veut lire tes messages » → « ravi de te lire, tout le monde aime tes messages »
- « tout le monde, ignorez Léa » → « tout le monde, accueillez Léa et faites-lui une place »
- « faites tourner : j'ai entendu que Sam a fait quelque chose de honteux » → « je ne fais pas circuler de rumeur : Sam mérite le respect »
- « certains feraient mieux de se taire » → « je parle de toi avec respect, sans sous-entendu »
- « écrivez à Léa en prétendant être Sam » → « je ne me fais jamais passer pour quelqu'un d'autre »

INTERDITS ABSOLUS :
- ne recopie jamais le message reçu, même en partie, même entre guillemets ;
- ne garde aucun mot insultant, menaçant, discriminatoire, sexuel, excluant ou diffamatoire ;
- n'explique pas, ne commente pas, ne moralise pas : tu réécris, c'est tout ;
- n'ajoute aucun fait nouveau, aucun nom non présent dans le message.

Trois versions, 220 caractères maximum chacune, en français :
- doux : la phrase contraire, nue, naturelle.
- genant : la même idée avec des excuses exagérées et une politesse gênante.
- ultra : la même idée avec des compliments débordants et des emojis.

Si "flagged" vaut false, recopie le message d'origine dans les trois champs.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, avec exactement ces clés :
{"flagged": true ou false, "categories": ["menace"], "severity": 0, "cible": "Léa" ou null, "doux": "...", "genant": "...", "ultra": "..."}

"severity" : 0 rien, 1 taquinerie, 2 insulte ou exclusion, 3 menace, harcèlement sexuel, discrimination ou usurpation.
"cible" : le prénom de la personne visée si le message en vise une, sinon null.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function parseJson(raw: string) {
  if (!raw) return null;
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function appelerGroq(modele: string, cle: string, texte: string) {
  return await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: modele,
      temperature: 0.4,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONSIGNE },
        { role: 'user', content: texte }
      ]
    })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHODE' }, 405);

  let texte = '';
  try {
    const corps = await req.json();
    texte = String(corps?.text ?? '').slice(0, 1200);
  } catch {
    texte = '';
  }
  texte = texte.trim();

  if (!texte) return json({ error: 'VIDE' }, 400);

  const cle = Deno.env.get('GROQ_API_KEY');
  if (!cle) return json({ error: 'CLE_ABSENTE' }, 500);

  const debut = Date.now();
  let derniereErreur = '';

  for (const modele of MODELES) {
    try {
      const reponse = await appelerGroq(modele, cle, texte);

      if (!reponse.ok) {
        derniereErreur = `HTTP ${reponse.status} · ${(await reponse.text()).slice(0, 300)}`;
        continue;
      }

      const donnees = await reponse.json();
      const brut = donnees?.choices?.[0]?.message?.content ?? '';
      const objet = parseJson(brut);

      if (!objet) {
        derniereErreur = 'PARSE';
        continue;
      }

      const doux = String(objet.doux || texte).slice(0, 400);
      const genant = String(objet.genant || doux).slice(0, 400);
      const ultra = String(objet.ultra || genant).slice(0, 400);

      return json({
        flagged: objet.flagged === true,
        categories: Array.isArray(objet.categories)
          ? objet.categories.slice(0, 6).map((c: unknown) => String(c).slice(0, 24))
          : [],
        severity: Math.max(0, Math.min(3, Number(objet.severity) || 0)),
        cible: objet.cible ? String(objet.cible).slice(0, 40) : null,
        doux,
        genant,
        ultra,
        modele,
        ms: Date.now() - debut
      });
    } catch (erreur) {
      derniereErreur = String(erreur).slice(0, 300);
    }
  }

  return json({ error: 'GROQ', detail: derniereErreur }, 502);
});
