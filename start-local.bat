@echo off
rem Запуск «Полей» на своём компьютере для пробы: двойной щелчок по файлу.
rem Нужен запущенный Docker Desktop. Остановить: docker compose down
chcp 65001 >nul
cd /d "%~dp0"

if not exist .env (
  >.env echo APP_URL=http://localhost:3000
  >>.env echo POSTGRES_PASSWORD=local
  >>.env echo TEACHER_EMAILS=teacher@test.ru
  >>.env echo DEV_LOGIN_LINKS=true
  >>.env echo APP_TIMEZONE=Europe/Moscow
  echo Создан файл .env с тестовыми настройками.
) else (
  echo Файл .env уже есть, использую его.
)

docker compose up -d --build db pdf migrate web
if errorlevel 1 (
  echo.
  echo Не получилось. Запущен ли Docker Desktop?
  pause
  exit /b 1
)

echo.
echo Готово: http://localhost:3000
echo Преподаватель: teacher@test.ru, любая другая почта - студент.
start "" http://localhost:3000
pause
