#!/usr/bin/env bash
# Assembla la cartella www/ (i file web dell'app) per l'APK.
# Copia dalla PWA solo ciò che va nel tablet: NON il ponte, gli strumenti o le funzioni Azure.
set -e
QUI="$(cd "$(dirname "$0")" && pwd)"
# Il codice web è uno solo, nel repository della PWA: va tenuto affiancato a questo
# (mastertutor/versione_pwa e mastertutor/versione_android)
APP="$(dirname "$QUI")/versione_pwa"
if [ ! -f "$APP/index.html" ]; then
  echo "Non trovo la PWA in $APP: serve la cartella versione_pwa accanto a versione_android." >&2
  exit 1
fi
WWW="$QUI/www"

rm -rf "$WWW"
mkdir -p "$WWW"
cp "$APP/index.html" "$WWW/"
cp "$APP/manifest.json" "$WWW/"
cp -R "$APP/css" "$WWW/"
cp -R "$APP/js" "$WWW/"
cp -R "$APP/assets" "$WWW/"
# Niente service worker nell'APK: i file sono già dentro l'app, non serve la cache PWA.
# Tolgo dalla copia di index.html il blocco che lo registra (nell'app darebbe un errore in console).
python3 - "$WWW/index.html" <<'PY'
import re, sys
p = sys.argv[1]
html = open(p, encoding='utf-8').read()
html = re.sub(r'\n[ \t]*<script>(?:(?!</script>).)*serviceWorker(?:(?!</script>).)*</script>', '', html, flags=re.S)
open(p, 'w', encoding='utf-8').write(html)
PY
echo "www/ pronto ($(find "$WWW" -type f | wc -l | tr -d ' ') file)"
