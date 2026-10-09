// Собирает конструктор в один HTML-файл: скрипт и стили внутри. Конструктор
// копирует их из себя же в файлы читалок, поэтому у тегов есть id.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const js = readFileSync("build/app.js", "utf8").replace(/<\/(script)/gi, "<\\/$1");
const css = readFileSync("build/app.css", "utf8").replace(/<\/(style)/gi, "<\\/$1");
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Поля — конструктор читалки</title>
<style id="polya-style">${css}</style>
</head>
<body>
<div id="root"><p style="padding:24px">Конструктор загружается… Если это сообщение не исчезает, откройте файл в Chrome, Firefox, Edge или Safari.</p></div>
<script id="polya-app">${js}</script>
</body>
</html>
`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/polya-konstruktor.html", html);
console.log(`dist/polya-konstruktor.html: ${(html.length / 1e6).toFixed(1)} МБ`);
