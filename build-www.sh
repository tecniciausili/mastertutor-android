#!/usr/bin/env bash
# Assembla la cartella www/ (i file web dell'app) per l'APK.
# I file web vengono dalla copia di Mastertutor nella raccolta (webapp-github/mastertutor):
# è la stessa webapp, senza ponte, strumenti e funzioni Azure e senza riferimenti ad altri siti.
# Cartelle affiancate: PROGETTI_SINGOLI_AZURE/webapp-github e PROGETTI_SINGOLI_AZURE/mastertutor/versione_android.
set -e
QUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$QUI/../../webapp-github/mastertutor" 2>/dev/null && pwd)" || {
  echo "Non trovo webapp-github/mastertutor (va tenuta accanto alla cartella mastertutor)." >&2
  exit 1
}
[ -f "$APP/index.html" ] || { echo "Non trovo $APP/index.html" >&2; exit 1; }
WWW="$QUI/www"

rm -rf "$WWW"
mkdir -p "$WWW"
cp "$APP/index.html" "$WWW/"
cp "$APP/manifest.json" "$WWW/"
cp -R "$APP/css" "$WWW/"
cp -R "$APP/js" "$WWW/"
cp -R "$APP/assets" "$WWW/"
find "$WWW" -name .DS_Store -delete

# Modifiche dell'APK (cartella modifiche/, le stesse della versione Windows): un anticipatore per
# ogni tipo di stimolo, prese a turno. Prima controllo che gli originali siano quelli su cui sono
# state fatte: se la webapp è cambiata, le novità vanno riportate nei file di modifiche/js.
( cd "$APP" && shasum -a 256 -c --quiet "$QUI/modifiche/BASE.sha256" ) || {
  echo "✗ I file originali in webapp-github/mastertutor sono cambiati dopo le modifiche." >&2
  echo "  Riporta le novità nei file di modifiche/js e aggiorna modifiche/BASE.sha256." >&2
  exit 1
}
cp "$QUI"/modifiche/js/*.js "$WWW/js/"
cp "$QUI"/modifiche/css/*.css "$WWW/css/"

python3 - "$QUI/package.json" "$WWW" <<'PY'
import json, os, re, sys
versione = json.load(open(sys.argv[1]))['version']
www = sys.argv[2]

def modifica(nome, funzione):
    p = os.path.join(www, nome)
    testo = open(p, encoding='utf-8').read()
    nuovo = funzione(testo)
    if nuovo == testo:
        sys.exit(f'{nome}: modifica non applicata')
    open(p, 'w', encoding='utf-8').write(nuovo)

# Niente service worker nell'APK: i file sono già dentro l'app (nell'app darebbe un errore)
modifica('index.html', lambda t: re.sub(r'\n[ \t]*<script>(?:(?!</script>).)*serviceWorker(?:(?!</script>).)*</script>', '', t, flags=re.S))
# Foglio di stile delle modifiche, dopo quello dell'app
modifica('index.html', lambda t: re.sub(r'(<link rel="stylesheet" href="css/styles\.css[^"]*">)', r'\1\n    <link rel="stylesheet" href="css/anticipatori.css">', t, count=1))
# Numero di versione dell'APK (package.json), anche nel riquadro «Informazioni»
modifica('js/app.js', lambda t: re.sub(r"versione: '[^']*'", f"versione: '{versione}'", t, count=1))
modifica('index.html', lambda t: re.sub(r'\?v=[0-9.]+', f'?v={versione}', t))
# Scheda Presa: le prese ora si accendono una alla volta, a turno
modifica('js/scheda-presa.js', lambda t: t.replace(
    'Se non ne scegli nessuna si accendono tutte quelle configurate.',
    'Se non ne scegli nessuna partecipano tutte quelle configurate. Nella stimolazione si accendono una alla volta, a turno, ognuna preceduta dal suo anticipatore (scheda Anticipatore).'))
PY
echo "www/ pronto ($(find "$WWW" -type f | wc -l | tr -d ' ') file)"
