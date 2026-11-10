# Affiches à imprimer

## `ecem-point-affiche-qr.pdf`

Affiche A4 (210 × 297 mm) à imprimer et coller en classe : un QR code qui
ouvre **https://ecem-point.vercel.app/**, l'adresse écrite en clair pour ceux
qui préfèrent taper, et les trois étapes d'inscription.

Le QR code est fabriqué avec `assets/vendor/qrcode.js` — le même générateur que
celui utilisé sur le site — donc aucun service externe et un rendu identique à
celui de l'application.

### Régénérer l'affiche

```bash
pip install reportlab fonttools brotli    # une fois
python3 tools/affiche-qr.py https://ecem-point.vercel.app/ assets/pdf/ecem-point-affiche-qr.pdf
```

Le script accepte une autre adresse en premier argument (pratique pour une
préproduction), par exemple :

```bash
python3 tools/affiche-qr.py https://mon-apercu.exemple/ /tmp/affiche-test.pdf
```

### Impression

- Format A4, portrait, échelle **100 %** (pas « ajuster à la page », sinon la
  marge blanche autour du QR rétrécit et le scan devient moins fiable).
- Le QR fait 78 mm de côté : il se lit à environ 1,5 m.
- En noir et blanc, le contraste reste suffisant.
