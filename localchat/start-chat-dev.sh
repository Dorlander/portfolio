#!/bin/sh
cd "$(dirname "$0")" || exit 1

# Режим разработки: сервер (:3780) и клиент Vite (:5173) — ДВА отдельных процесса.
# Открывайте http://localhost:5173 (Vite проксирует /api и WebSocket на сервер).
# Для эксплуатации используйте ./start-chat.sh (клиент собирается, сервер отдаёт
# его на одном порту 3780).

command -v node >/dev/null 2>&1 || { echo "[ОШИБКА] Node.js не найден"; exit 1; }

[ -d server/node_modules ] || ( cd server && npm install )
[ -d client/node_modules ] || ( cd client && npm install )

( cd server && node --watch src/index.js ) &
SRV=$!
trap 'kill $SRV 2>/dev/null' INT TERM EXIT

echo "Сервер :3780 запущен. Клиент Vite :5173 — открывайте http://localhost:5173"
( cd client && npm run dev -- --host 0.0.0.0 )
