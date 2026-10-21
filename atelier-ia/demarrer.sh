#!/usr/bin/env bash
# Ouvre le tableau de bord d'Atelier (macOS / Linux). Sur Mac : clic droit > Ouvrir avec > Terminal.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Téléchargez la version LTS sur https://nodejs.org puis relancez ce fichier."
  read -r -p "Appuyez sur Entrée pour fermer."
  exit 1
fi
PORT="${PORT:-3000}"
( sleep 1; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
node server.js
