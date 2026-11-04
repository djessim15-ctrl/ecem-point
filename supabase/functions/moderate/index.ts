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
1. détecter s'il contient : insultes ou gros mots, harcèlement ou moquerie, agressivité ou menace, spam ou flood, majuscules agressives, haine, données personnelles.
2. le réécrire en trois versions de plus en plus gentilles.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, avec exactement ces clés :
{"flagged": true ou false, "categories": ["insulte"], "severity": 0, "doux": "...", "genant": "...", "ultra": "..."}

Catégories autorisées : insulte, harcelement, agressivite, spam, majuscules, haine, donnees_perso.
Règles de réécriture :
- doux : même idée, ton neutre et poli, sans insulte.
- genant : beaucoup trop gentil, excuses exagérées, politesse gênante.
- ultra : absurde et mielleux, emojis, compliments débordants.
- 220 caractères maximum par version, en français, sans ajouter de fait nouveau.
- Si flagged vaut false, recopie le message d'origine dans les trois champs.
- severity : 0 rien, 1 taquinerie, 2 insulte ou harcèlement, 3 haine ou menace grave.`;

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
      temperature: 0.3,
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
