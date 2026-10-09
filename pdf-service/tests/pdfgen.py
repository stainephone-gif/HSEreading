"""Генератор тестовых PDF с вёрсткой, похожей на настоящие статьи.

Текст выключается по ширине, «~» внутри слова отмечает место возможного переноса.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pymupdf

REGULAR = pymupdf.Font("notos")
BOLD = pymupdf.Font("notosbo")
A4 = (595, 842)


@dataclass
class Item:
    text: str
    kind: str = "body"  # body | heading | title | note
    size: float = 10.0


@dataclass
class Layout:
    columns: int = 1
    margin: float = 60.0
    gutter: float = 20.0
    leading: float = 1.35
    indent: float = 0.0  # красная строка, пт
    para_gap: float = 0.0  # отступ между абзацами, пт
    header: str | None = None
    page_numbers: bool = True
    # Сноски: номер страницы -> текст мелким шрифтом внизу.
    notes: dict[int, str] = field(default_factory=dict)


class Writer:
    def __init__(self, layout: Layout):
        self.layout = layout
        self.doc = pymupdf.open()
        self.page = None
        self.page_no = -1
        self.col = 0
        self.y = 0.0
        self._new_page()

    # Геометрия колонки
    def _col_x(self) -> tuple[float, float]:
        L = self.layout
        width = (A4[0] - 2 * L.margin - (L.columns - 1) * L.gutter) / L.columns
        x0 = L.margin + self.col * (width + L.gutter)
        return x0, x0 + width

    def _bottom(self) -> float:
        return A4[1] - self.layout.margin - (40 if self.page_no in self.layout.notes else 0)

    def _new_page(self) -> None:
        if self.page is not None:
            self._finish_page()
        self.page = self.doc.new_page(width=A4[0], height=A4[1])
        self.writer = pymupdf.TextWriter(self.page.rect)
        self.page_no += 1
        self.col = 0
        self.y = self.layout.margin

    def _finish_page(self) -> None:
        L = self.layout
        if L.header:
            self.writer.append((L.margin, 30), L.header, font=REGULAR, fontsize=8)
        if L.page_numbers:
            self.writer.append((A4[0] / 2, A4[1] - 25), str(self.page_no + 1), font=REGULAR, fontsize=9)
        if self.page_no in L.notes:
            self._lay_paragraph(L.notes[self.page_no], REGULAR, 7.5, A4[1] - L.margin - 25, fixed=True)
        self.writer.write_text(self.page)

    def _advance(self, height: float) -> None:
        if self.y + height > self._bottom():
            if self.col + 1 < self.layout.columns:
                self.col += 1
                self.y = self.layout.margin + self._top_offset
            else:
                self._new_page()
                self._top_offset = 0.0

    _top_offset = 0.0

    def full_width(self, text: str, font: pymupdf.Font, size: float) -> None:
        """Строка поперёк всех колонок (заголовок статьи)."""
        self.writer.append((self.layout.margin, self.y + size), text, font=font, fontsize=size)
        self.y += size * 2
        self._top_offset = self.y - self.layout.margin

    def _lay_paragraph(self, text: str, font, size: float, y: float | None = None, fixed=False, indent=0.0) -> None:
        x0, x1 = self._col_x() if not fixed else (self.layout.margin, A4[0] - self.layout.margin)
        line_h = size * self.layout.leading
        words = text.split(" ")
        lines: list[list[str]] = []
        current: list[str] = []
        first = True

        def width(ws):
            return font.text_length(" ".join(w.replace("~", "") for w in ws), fontsize=size)

        avail = lambda: (x1 - x0) - (indent if first else 0)  # noqa: E731
        while words:
            w = words.pop(0)
            if width(current + [w]) <= avail():
                current.append(w)
                continue
            # Пробуем перенос по «~», а в длинных словах без дефиса — в любом месте между буквами.
            parts = w.split("~")
            if len(parts) == 1 and len(w) >= 8 and w.isalpha():
                parts = [w[:3], *w[3:-3], w[-3:]]
            for cut in range(len(parts) - 1, 0, -1):
                head = "".join(parts[:cut]) + "-"
                if width(current + [head]) <= avail():
                    current.append(head)
                    words.insert(0, "".join(parts[cut:]))
                    break
            else:
                words.insert(0, w)
            lines.append(current)
            current = []
            first = False
        if current:
            lines.append(current)

        if y is not None:
            self.y = y
        for i, ws in enumerate(lines):
            ws = [w.replace("~", "") for w in ws]
            if not fixed:
                self._advance(line_h)
                x0, x1 = self._col_x()
            lx = x0 + (indent if i == 0 else 0)
            baseline = self.y + size
            last = i == len(lines) - 1
            if last or len(ws) == 1:
                self.writer.append((lx, baseline), " ".join(ws), font=font, fontsize=size)
            else:
                # Выключка по ширине: слова расставляются по отдельности.
                total = sum(font.text_length(w, fontsize=size) for w in ws)
                space = ((x1 - lx) - total) / (len(ws) - 1)
                cx = lx
                for w in ws:
                    self.writer.append((cx, baseline), w, font=font, fontsize=size)
                    cx += font.text_length(w, fontsize=size) + space
            self.y += line_h

    def add(self, item: Item) -> None:
        L = self.layout
        if item.kind == "title":
            self.full_width(item.text, BOLD, item.size)
        elif item.kind == "heading":
            self._advance(item.size * 3)
            self.y += item.size * 0.6
            self._lay_paragraph(item.text, BOLD, item.size)
            self.y += item.size * 0.3
        else:
            self._lay_paragraph(item.text, REGULAR, item.size, indent=L.indent)
            self.y += L.para_gap

    def build(self, items: list[Item]) -> bytes:
        for item in items:
            self.add(item)
        self._finish_page()
        return self.doc.tobytes()


def clean(text: str) -> str:
    """Текст абзаца так, как его должен вернуть разбор."""
    return text.replace("~", "")
