#!/bin/sh
# Запуск «Полей» на своём компьютере для пробы: sh start-local.sh
# Нужен запущенный Docker Desktop. Остановить: docker compose down
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cat > .env <<'CONF'
APP_URL=http://localhost:3000
POSTGRES_PASSWORD=local
TEACHER_EMAILS=teacher@test.ru
DEV_LOGIN_LINKS=true
APP_TIMEZONE=Europe/Moscow
CONF
  echo "Создан файл .env с тестовыми настройками."
else
  echo "Файл .env уже есть, использую его."
fi

docker compose up -d --build db pdf migrate web

echo
echo "Готово: http://localhost:3000"
echo "Преподаватель: teacher@test.ru, любая другая почта — студент."
(command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) || true
