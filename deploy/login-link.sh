#!/bin/sh
# Последняя ссылка для входа, отправленная на адрес. Нужна, пока не настроен SMTP:
# тогда письма не уходят, а пишутся в журнал сервера.
# Запуск из папки проекта: ./deploy/login-link.sh colleague@hse.ru
set -eu
email=$(printf '%s' "${1:?Укажите почту: ./deploy/login-link.sh colleague@hse.ru}" | tr '[:upper:]' '[:lower:]')
link=$(docker compose logs web --no-log-prefix | grep -A4 -F "[mail] to=$email " | grep -o 'https\?://[^ ]*token=[^ ]*' | tail -1)
if [ -z "$link" ]; then
  echo "Ссылок для $email в журнале нет. Попросите запросить вход заново." >&2
  exit 1
fi
echo "$link"
