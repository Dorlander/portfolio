#!/bin/sh
cd "$(dirname "$0")"
[ -f .env ] || { echo "Нет .env — скопируйте .env.example в .env и заполните"; exit 1; }
if [ "$1" = "test" ]; then exec node bridge.mjs --test; fi
exec node bridge.mjs
