// Страховка запуска: маленький скрипт перед основным. Если браузер не смог
// выполнить программу (старый Safari, нет нужных функций), вместо пустой
// страницы или вечного «загружается…» человек видит, что делать, и текст
// ошибки, который можно прислать. Написан на старом JS, чтобы работать везде.
// Используется и конструктором (scripts/assemble.mjs), и файлом читалки.

export const BOOT_GUARD = `(function () {
  function show(detail) {
    var root = document.getElementById("root");
    if (!root || (root.childNodes.length && !document.getElementById("polya-loading"))) return;
    var ua = navigator.userAgent;
    var safari = /Safari\\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
    var v = ua.match(/Version\\/(\\d+(\\.\\d+)?)/);
    root.innerHTML = "";
    var box = document.createElement("div");
    box.style.cssText = "max-width:640px;margin:40px auto;padding:24px;font:16px/1.5 system-ui,sans-serif;border:1px solid #e0b4b4;border-radius:12px;background:#fff6f6;color:#222";
    var h = document.createElement("h2");
    h.textContent = "Программа не запустилась в этом браузере";
    h.style.marginTop = "0";
    var p = document.createElement("p");
    p.textContent = safari
      ? "Похоже, Safari устарел" + (v ? " (версия " + v[1] + ")" : "") + ". Обновите macOS / Safari (нужна версия 15.4 или новее) или откройте файл в Google Chrome или Firefox: правой кнопкой по файлу → «Открыть в программе»."
      : "Обновите браузер или откройте файл в свежем Google Chrome, Firefox или Safari.";
    var d = document.createElement("pre");
    d.style.cssText = "white-space:pre-wrap;font-size:12px;color:#666;margin:0";
    d.textContent = "Для преподавателя: " + detail + "\\n" + ua;
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(d);
    root.appendChild(box);
  }
  window.addEventListener("error", function (e) {
    show((e.error && e.error.stack) || e.message || "ошибка");
  });
  window.addEventListener("unhandledrejection", function (e) {
    show(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });
  window.addEventListener("load", function () {
    setTimeout(function () {
      var root = document.getElementById("root");
      if (root && !root.childNodes.length) show("пустой экран после запуска");
    }, 3000);
  });
})();`;
