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

# Le novità comuni (anticipatori per tipo di stimolo, stimoli a caso per categoria, apertura
# sull'esercizio, «Configurazione», intestazione con il logo) sono già nella webapp della raccolta.

python3 - "$QUI/package.json" "$WWW" <<'PY'
import json, os, re, sys
versione = json.load(open(sys.argv[1]))['version']
www = sys.argv[2]

def modifica(nome, funzione, cerca=None):
    # cerca: se indicato basta che il testo ci sia (la modifica può non cambiare nulla,
    # per esempio quando la webapp ha già lo stesso numero di versione)
    p = os.path.join(www, nome)
    testo = open(p, encoding='utf-8').read()
    nuovo = funzione(testo)
    if (cerca is None and nuovo == testo) or (cerca is not None and not re.search(cerca, testo)):
        sys.exit(f'{nome}: modifica non applicata')
    open(p, 'w', encoding='utf-8').write(nuovo)

# Niente service worker nell'APK: i file sono già dentro l'app (nell'app darebbe un errore)
modifica('index.html', lambda t: re.sub(r'\n[ \t]*<script>(?:(?!</script>).)*serviceWorker(?:(?!</script>).)*</script>', '', t, flags=re.S))
# Numero di versione dell'APK (package.json), anche nel riquadro «Informazioni»
modifica('js/app.js', lambda t: re.sub(r"versione: '[^']*'", f"versione: '{versione}'", t, count=1), r"versione: '[^']*'")
modifica('index.html', lambda t: re.sub(r'\?v=[0-9.]+', f'?v={versione}', t), r'\?v=[0-9.]+')
PY
echo "www/ pronto ($(find "$WWW" -type f | wc -l | tr -d ' ') file)"
