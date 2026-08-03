#!/bin/sh
cd "$(dirname "$0")" || exit 1

command -v node >/dev/null 2>&1 || {
  echo "[ОШИБКА] Node.js не найден — установите LTS (>=18) с https://nodejs.org"; exit 1;
}

mkdir -p server/data

SECRET_FILE="server/data/.jwt-secret"
if [ ! -f "$SECRET_FILE" ]; then
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE" || exit 1
fi
JWT_SECRET="$(cat "$SECRET_FILE")"
export JWT_SECRET
export NODE_ENV=production
export CORS_ORIGINS="http://localhost:3780"
export HOST=0.0.0.0

if [ ! -d client/node_modules ]; then
  echo "Установка зависимостей клиента (один раз)..."
  ( cd client && npm install ) || { echo "[ОШИБКА] npm install (клиент) не прошёл"; exit 1; }
fi
if [ ! -d client/dist ]; then
  echo "Сборка клиента (один раз, пару минут)..."
  ( cd client && npm run build ) || { echo "[ОШИБКА] сборка клиента не прошла"; exit 1; }
fi
if [ ! -d server/node_modules ]; then
  echo "Установка зависимостей сервера (один раз)..."
  ( cd server && npm install ) || { echo "[ОШИБКА] npm install (сервер) не прошёл — на некоторых системах для better-sqlite3/sharp нужны инструменты сборки"; exit 1; }
fi

echo
echo "  Чат: http://localhost:3780"
echo "  С других ПК в сети: http://<IP-этого-ПК>:3780   (Ctrl+C — остановить)"
echo
exec node server/src/index.js
