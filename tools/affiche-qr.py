#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère l'affiche A4 « Rejoins la classe » avec un QR code du site.

Le QR n'est pas dessiné par une bibliothèque Python : on réutilise
`assets/vendor/qrcode.js`, celui qui sert déjà au site, pour que le code
imprimé soit exactement le même que celui affiché dans l'application.

Prérequis :
    pip install reportlab fonttools brotli
    node (déjà nécessaire pour les vérifications de syntaxe du dépôt)

Usage :
    python3 tools/affiche-qr.py [url] [sortie.pdf]
    python3 tools/affiche-qr.py https://ecem-point.vercel.app/ assets/pdf/ecem-point-affiche-qr.pdf
"""
import json
import math
import os
import subprocess
import sys
import tempfile

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else 'https://ecem-point.vercel.app/'
SORTIE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RACINE, 'assets/pdf/ecem-point-affiche-qr.pdf')

VIOLET = HexColor('#7c5cff')
VIOLET_FONCE = HexColor('#5b3fd6')
ROSE = HexColor('#e8558f')
INK = HexColor('#17122e')
SOFT = HexColor('#585170')
FAINT = HexColor('#8d87a3')
BG = HexColor('#f4f2fb')
BORDER = HexColor('#e2dcf5')


# ---------------------------------------------------------------- QR code
def matrice_qr(url):
    """Demande la matrice au qrcode-generator embarqué dans le dépôt."""
    script = """
const fs = require('fs'), vm = require('vm');
const ctx = { console };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const qr = ctx.qrcode(0, 'M');
qr.addData(process.argv[2]);
qr.make();
const n = qr.getModuleCount();
const m = [];
for (let r = 0; r < n; r++) {
  const row = [];
  for (let c = 0; c < n; c++) row.push(qr.isDark(r, c) ? 1 : 0);
  m.push(row);
}
process.stdout.write(JSON.stringify({ n, m }));
"""
    vendored = os.path.join(RACINE, 'assets/vendor/qrcode.js')
    sortie = subprocess.run(
        ['node', '-e', script, vendored, url],
        check=True, capture_output=True, text=True
    )
    return json.loads(sortie.stdout)


# ---------------------------------------------------------------- polices
def polices():
    """Convertit les woff2 variables du dépôt en TTF statiques pour le PDF."""
    from fontTools.ttLib import TTFont as Police
    from fontTools.varLib.instancer import instantiateVariableFont

    dossier = tempfile.mkdtemp(prefix='ecem-polices-')
    rendu = {}

    for source, famille in (
        ('assets/fonts/inter-latin-wght.woff2', 'Inter'),
        ('assets/fonts/jakarta-latin-wght.woff2', 'Jakarta'),
    ):
        for poids, suffixe in ((400, 'Regular'), (600, 'SemiBold'), (800, 'ExtraBold')):
            police = Police(os.path.join(RACINE, source))
            police.flavor = None
            if 'fvar' in police:
                police = instantiateVariableFont(police, {'wght': poids})
            nom_fichier = '%s-%s.ttf' % (famille, suffixe)
            chemin = os.path.join(dossier, nom_fichier)
            police.save(chemin)
            rendu[(famille, suffixe)] = chemin
    return rendu


def enregistrer(chemins):
    noms = {}
    for (famille, suffixe), chemin in chemins.items():
        nom = famille if suffixe == 'Regular' else famille + '-' + ('Semi' if suffixe == 'SemiBold' else 'Bold')
        pdfmetrics.registerFont(TTFont(nom, chemin))
        noms[(famille, suffixe)] = nom
    return noms


def construire(qr, url, sortie):
    W, H = A4
    marge = 20 * mm

    def texte(x, y, contenu, police, taille, couleur, centre=False, droite=False):
        c.setFont(police, taille)
        c.setFillColor(couleur)
        if centre:
            c.drawCentredString(x, y, contenu)
        elif droite:
            c.drawRightString(x, y, contenu)
        else:
            c.drawString(x, y, contenu)

    def etoile(cx, cy, rayon, couleur):
        points = []
        for i in range(10):
            angle = math.pi / 2 + i * math.pi / 5
            r = rayon if i % 2 == 0 else rayon * 0.44
            points.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
        chemin = c.beginPath()
        chemin.moveTo(*points[0])
        for point in points[1:]:
            chemin.lineTo(*point)
        chemin.close()
        c.setFillColor(couleur)
        c.drawPath(chemin, stroke=0, fill=1)

    c = canvas.Canvas(sortie, pagesize=A4)
    c.setTitle('ECEM Point — affiche QR code')
    c.setAuthor('ECEM Point')
    c.setSubject('Affiche à imprimer : scannez le QR code pour rejoindre le site')
    c.setKeywords('ECEM Point, QR code, affiche, classe, points')

    # fond
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.saveState()
    c.setFillColor(VIOLET)
    c.setFillAlpha(0.10)
    c.circle(W - 8 * mm, H - 18 * mm, 74 * mm, stroke=0, fill=1)
    c.setFillColor(ROSE)
    c.setFillAlpha(0.09)
    c.circle(2 * mm, 24 * mm, 58 * mm, stroke=0, fill=1)
    c.setFillColor(VIOLET)
    c.setFillAlpha(0.06)
    c.circle(W - 26 * mm, 62 * mm, 30 * mm, stroke=0, fill=1)
    c.restoreState()

    # en-tête
    haut = H - 22 * mm
    c.setFillColor(VIOLET)
    c.roundRect(marge, haut - 9 * mm, 9 * mm, 9 * mm, 2.6 * mm, stroke=0, fill=1)
    etoile(marge + 4.5 * mm, haut - 4.4 * mm, 2.6 * mm, HexColor('#ffffff'))
    texte(marge + 12 * mm, haut - 6.4 * mm, 'ECEM Point', 'Jakarta-Bold', 15, INK)

    c.setFillColor(Color(1, 1, 1, alpha=0.85))
    c.roundRect(W - marge - 47 * mm, haut - 8.6 * mm, 47 * mm, 8.6 * mm, 4.3 * mm, stroke=0, fill=1)
    texte(W - marge - 23.5 * mm, haut - 5.9 * mm, url.replace('https://', '').rstrip('/'),
          'Inter-Semi', 9, VIOLET_FONCE, centre=True)

    # titre
    y = haut - 30 * mm
    texte(marge, y, 'Rejoins la classe', 'Jakarta-Bold', 38, INK)
    y -= 11 * mm
    texte(marge, y, 'Les points, les succès, le tchat de classe — tout au même endroit.', 'Inter', 12, SOFT)
    y -= 6.4 * mm
    texte(marge, y, 'Un QR code, un prénom, et c’est parti.', 'Inter', 12, SOFT)

    # carte du QR
    carte_l, carte_h = 104 * mm, 122 * mm
    carte_haut = y - 13 * mm
    carte_y = carte_haut - carte_h
    carte_x = (W - carte_l) / 2

    c.saveState()
    c.setFillColor(Color(1, 1, 1, alpha=0.94))
    c.setStrokeColor(BORDER)
    c.setLineWidth(1)
    c.roundRect(carte_x, carte_y, carte_l, carte_h, 8 * mm, stroke=1, fill=1)
    c.restoreState()

    n = qr['n']
    cote = 78 * mm
    module = cote / n
    qr_x = (W - cote) / 2
    qr_y = carte_haut - 11 * mm - cote

    c.setFillColor(HexColor('#ffffff'))
    c.rect(qr_x - 3.5 * mm, qr_y - 3.5 * mm, cote + 7 * mm, cote + 7 * mm, stroke=0, fill=1)
    c.setFillColor(INK)
    for r in range(n):
        ligne = qr['m'][r]
        base = qr_y + cote - (r + 1) * module
        for col in range(n):
            if ligne[col]:
                c.rect(qr_x + col * module, base, module + 0.02, module + 0.02, stroke=0, fill=1)

    texte(W / 2, qr_y - 12 * mm, 'Scanne-moi', 'Jakarta-Bold', 18, INK, centre=True)
    texte(W / 2, qr_y - 19.5 * mm, url, 'Inter-Semi', 12.5, VIOLET_FONCE, centre=True)
    texte(W / 2, qr_y - 26 * mm, 'ou tape cette adresse dans ton navigateur', 'Inter', 9.5, FAINT, centre=True)

    # trois étapes
    etapes = [
        ('1', 'Scanne', 'Ouvre l’appareil photo', 'et vise le QR code.'),
        ('2', 'Ton prénom', 'Choisis ton prénom et', 'un mot de passe.'),
        ('3', 'C’est parti', 'Reçois et envoie des', 'points à la classe.'),
    ]
    espace = 7 * mm
    largeur_e = (W - 2 * marge - 2 * espace) / 3
    hauteur_e = 32 * mm
    base_y = carte_y - 14 * mm - hauteur_e

    for i, (num, titre, l1, l2) in enumerate(etapes):
        x = marge + i * (largeur_e + espace)
        c.saveState()
        c.setFillColor(Color(1, 1, 1, alpha=0.78))
        c.setStrokeColor(BORDER)
        c.roundRect(x, base_y, largeur_e, hauteur_e, 5 * mm, stroke=1, fill=1)
        c.restoreState()

        c.setFillColor(VIOLET)
        c.circle(x + 9.5 * mm, base_y + hauteur_e - 10.5 * mm, 5 * mm, stroke=0, fill=1)
        texte(x + 9.5 * mm, base_y + hauteur_e - 12.3 * mm, num, 'Jakarta-Bold', 10.5, HexColor('#ffffff'), centre=True)
        texte(x + 18 * mm, base_y + hauteur_e - 12 * mm, titre, 'Jakarta-Bold', 11.5, INK)
        texte(x + 6 * mm, base_y + 11.5 * mm, l1, 'Inter', 9, SOFT)
        texte(x + 6 * mm, base_y + 7 * mm, l2, 'Inter', 9, SOFT)

    # pied
    ligne_y = 26 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.line(marge, ligne_y, W - marge, ligne_y)
    texte(marge, ligne_y - 7 * mm,
          'ECEM Point · site statique adossé à Supabase · aucune publicité, aucun traqueur',
          'Inter', 8.5, FAINT)
    texte(W - marge, ligne_y - 7 * mm, 'Affiche A4 · v2.9', 'Inter-Semi', 8.5, FAINT, droite=True)

    c.showPage()
    c.save()


def main():
    qr = matrice_qr(URL)
    enregistrer(polices())
    os.makedirs(os.path.dirname(os.path.abspath(SORTIE)), exist_ok=True)
    construire(qr, URL, SORTIE)
    print('Affiche écrite : %s (%d modules)' % (SORTIE, qr['n']))


if __name__ == '__main__':
    main()
