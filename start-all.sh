#!/bin/sh
cd "$(dirname "$0")" || exit 1

command -v node >/dev/null 2>&1 || {
  echo "[ОШИБКА] Node.js не найден — установите LTS (>=18) с https://nodejs.org"; exit 1;
}

echo "Запускаю LocalChat (порт 3780) в фоне..."
( ./localchat/start-chat.sh ) &
CHAT_PID=$!

echo "Запускаю Производственный учёт УТК (порт 3000)..."
trap 'kill $CHAT_PID 2>/dev/null' INT TERM EXIT
( cd acts && ./start.sh )
