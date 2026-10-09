"""Разбор PDF на абзацы.

MuPDF отдаёт блоки и строки с координатами. Блок часто совпадает с абзацем, но
не всегда: при красной строке без отступа между абзацами он склеивает всю
страницу, а абзац, перенесённый на следующую страницу или колонку, рвёт на два.
Поэтому блоки режутся по признакам начала абзаца, а соседние абзацы склеиваются
по признакам продолжения. Колонтитулы, номера страниц и сноски помечаются
исключёнными, чтобы преподаватель видел их и мог вернуть.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from .sentences import count_words, detect_language, split_sentences


class ExtractError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Line:
    page: int
    bbox: tuple[float, float, float, float]
    text: str
    size: float
    bold: bool
    block: int
    furniture: bool = False

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def x1(self) -> float:
        return self.bbox[2]


@dataclass
class Paragraph:
    lines: list[Line] = field(default_factory=list)
    kind: str = "body"
    exclude_reason: str | None = None
    # Правый край блока, в котором стоит абзац: по нему видно, что строка дошла до конца колонки.
    right: float = 0.0


# Конец абзаца: точка, вопрос, восклицание, многоточие, двоеточие, закрывающие кавычки и скобки.
_TERMINAL = re.compile(r"[.!?…:;][\"»”’)\]]*$")
_PAGE_NUMBER = re.compile(r"^[\W_]*(?:стр\.?|с\.|page|p\.)?\s*(?:\d{1,4}|[ivxlcdm]{1,7})[\W_]*$", re.IGNORECASE)
_HYPHENS = ("-", "­", "‐", "‑")
# Перенос убираем, только если строка кончается на букву с дефисом, а следующая начинается со строчной.
_HYPHEN_BREAK = re.compile(r"\w[-­‐‑]$")

MARGIN_SHARE = 0.08
MIN_CHARS_PER_PAGE = 30


def extract(pdf_bytes: bytes) -> dict:
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 — MuPDF бросает разные типы ошибок
        raise ExtractError("invalid_pdf", "Файл не похож на PDF или повреждён.") from exc
    if doc.needs_pass:
        raise ExtractError("encrypted", "PDF защищён паролем.")
    if doc.page_count == 0:
        raise ExtractError("empty", "В PDF нет страниц.")

    pages = [{"width": round(p.rect.width, 2), "height": round(p.rect.height, 2)} for p in doc]
    lines = _read_lines(doc)
    _check_text_layer(lines, doc.page_count)
    _mark_furniture(lines, pages, doc.page_count)

    body_size = _body_font_size(lines)
    paragraphs = _split_blocks(lines, body_size)
    _classify(paragraphs, body_size)
    paragraphs = _merge_continuations(paragraphs)

    fragments = [_to_fragment(p) for p in paragraphs]
    fragments = [f for f in fragments if f["text"]]
    body_text = " ".join(f["text"] for f in fragments if f["kind"] == "body")
    return {
        "pageCount": doc.page_count,
        "pages": pages,
        "language": detect_language(body_text),
        "fragments": fragments,
    }


def _read_lines(doc: pymupdf.Document) -> list[Line]:
    # Без TEXT_PRESERVE_LIGATURES: лигатуры «ﬁ» раскрываются в обычные буквы.
    flags = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
    result: list[Line] = []
    block_id = 0
    for page_no, page in enumerate(doc):
        data = page.get_text("dict", flags=flags)
        for block in data["blocks"]:
            if block.get("type") != 0:
                continue
            block_id += 1
            block_lines: list[Line] = []
            for raw in block["lines"]:
                spans = [s for s in raw["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = _normalize("".join(s["text"] for s in raw["spans"]))
                if not text:
                    continue
                chars = Counter()
                for s in spans:
                    chars[round(s["size"] * 2) / 2] += len(s["text"].strip())
                size = chars.most_common(1)[0][0]
                bold_chars = sum(len(s["text"].strip()) for s in spans if s["flags"] & 16 or "bold" in s["font"].lower())
                bbox = tuple(round(v, 1) for v in raw["bbox"])
                line = Line(page_no, bbox, text, size, bold_chars * 2 > sum(chars.values()), block_id)
                # MuPDF иногда режет одну строку на куски по пробелам выключки: склеиваем по базовой линии.
                prev = block_lines[-1] if block_lines else None
                if prev and abs(prev.bbox[3] - bbox[3]) < size * 0.3 and bbox[0] >= prev.x1 - 1:
                    prev.text = f"{prev.text} {text}"
                    prev.bbox = (prev.bbox[0], min(prev.bbox[1], bbox[1]), bbox[2], max(prev.bbox[3], bbox[3]))
                    continue
                block_lines.append(line)
            result.extend(block_lines)
    return result


def _normalize(text: str) -> str:
    text = text.replace(" ", " ").replace("\t", " ")
    return re.sub(r"\s+", " ", text).strip()


def _check_text_layer(lines: list[Line], page_count: int) -> None:
    chars_by_page = Counter()
    for line in lines:
        chars_by_page[line.page] += len(line.text)
    pages_with_text = sum(1 for p in range(page_count) if chars_by_page[p] >= MIN_CHARS_PER_PAGE)
    if pages_with_text * 2 < page_count:
        raise ExtractError(
            "no_text_layer",
            "В PDF нет текстового слоя: страницы сохранены как картинки. "
            "Распознавание таких файлов пока не поддерживается.",
        )


def _mark_furniture(lines: list[Line], pages: list[dict], page_count: int) -> None:
    """Колонтитулы и номера страниц: строки у края страницы, которые повторяются или похожи на номер."""

    def in_margin(line: Line) -> bool:
        h = pages[line.page]["height"]
        return line.bbox[3] <= h * MARGIN_SHARE or line.bbox[1] >= h * (1 - MARGIN_SHARE)

    def key(line: Line) -> str:
        return re.sub(r"\d+", "#", line.text.lower())

    pages_by_key: dict[str, set[int]] = {}
    for line in lines:
        if in_margin(line):
            pages_by_key.setdefault(key(line), set()).add(line.page)

    repeat_threshold = max(2, round(page_count * 0.3))
    for line in lines:
        if not in_margin(line):
            continue
        if _PAGE_NUMBER.match(line.text) or len(pages_by_key[key(line)]) >= repeat_threshold:
            line.furniture = True


def _body_font_size(lines: list[Line]) -> float:
    sizes = Counter()
    for line in lines:
        if not line.furniture:
            sizes[line.size] += len(line.text)
    return sizes.most_common(1)[0][0] if sizes else 10.0


def _split_blocks(lines: list[Line], body_size: float) -> list[Paragraph]:
    paragraphs: list[Paragraph] = []
    by_block: dict[int, list[Line]] = {}
    for line in lines:
        by_block.setdefault(line.block, []).append(line)

    for block_lines in by_block.values():
        # Колонтитулы отделяем от остального блока.
        current: Paragraph | None = None
        left = _left_edge(block_lines)
        right = max(l.x1 for l in block_lines)
        gaps = [b.bbox[1] - a.bbox[3] for a, b in zip(block_lines, block_lines[1:]) if b.bbox[1] > a.bbox[3] - 1]
        normal_gap = statistics.median(gaps) if gaps else 0.0

        for i, line in enumerate(block_lines):
            prev = block_lines[i - 1] if i else None
            if current is None or _starts_paragraph(line, prev, left, right, normal_gap, block_lines[i + 1 : i + 2]):
                current = Paragraph(right=right)
                paragraphs.append(current)
            current.lines.append(line)
    return paragraphs


def _left_edge(lines: list[Line]) -> float:
    xs = Counter(round(l.x0) for l in lines)
    return xs.most_common(1)[0][0]


def _starts_paragraph(
    line: Line, prev: Line | None, left: float, right: float, normal_gap: float, following: list[Line]
) -> bool:
    if prev is None:
        return True
    if line.furniture != prev.furniture:
        return True
    if abs(line.size - prev.size) >= 1 or line.bold != prev.bold:
        return True
    gap = line.bbox[1] - prev.bbox[3]
    if gap > max(normal_gap * 2, line.size * 0.6):
        return True
    indent = line.size * 0.8
    # Красная строка: строка сдвинута вправо от левого края, а следующая (если есть) снова у края.
    if line.x0 > left + indent and prev.x0 <= left + indent:
        if not following or following[0].x0 <= left + indent:
            return True
    # Короткая предыдущая строка с точкой на конце: прошлый абзац закончился.
    width = right - left
    if width > 0 and prev.x1 < left + width * 0.75 and _TERMINAL.search(prev.text):
        return True
    return False


def _classify(paragraphs: list[Paragraph], body_size: float) -> None:
    for p in paragraphs:
        text = " ".join(l.text for l in p.lines)
        size = p.lines[0].size
        if all(l.furniture for l in p.lines):
            p.kind, p.exclude_reason = "excluded", "колонтитул или номер страницы"
        elif size < body_size - 1.5:
            p.kind, p.exclude_reason = "excluded", "мелкий шрифт: сноска или подпись"
        elif count_words(text) <= 20 and len(p.lines) <= 3 and (size >= body_size + 1 or p.lines[0].bold):
            p.kind = "heading"


def _merge_continuations(paragraphs: list[Paragraph]) -> list[Paragraph]:
    """Склеивает абзац, разорванный страницей, колонкой или блоком MuPDF.

    Признак разрыва: предыдущий абзац не кончается знаком конца фразы, а следующий
    начинается со строчной буквы или последняя строка предыдущего дошла до края колонки. Исключённые фрагменты между ними (колонтитул,
    номер страницы, сноска) не мешают склейке.
    """
    result: list[Paragraph] = []
    last_body: Paragraph | None = None
    for p in paragraphs:
        if p.kind == "excluded":
            result.append(p)
            continue
        if p.kind == "body" and last_body is not None and _continues(last_body, p):
            last_body.lines.extend(p.lines)
            continue
        result.append(p)
        last_body = p if p.kind == "body" else None
    return result


def _continues(prev: Paragraph, nxt: Paragraph) -> bool:
    last = prev.lines[-1]
    if _TERMINAL.search(last.text):
        return False
    first = next((c for c in nxt.lines[0].text if c.isalpha()), "")
    if first.islower():
        return True
    # Строка без знака конца фразы, дошедшая до правого края колонки, почти всегда
    # продолжается дальше, даже если следующая начинается с заглавной (имя, термин).
    return last.x1 >= prev.right - last.size * 0.5 and len(prev.lines) > 1


def _to_fragment(p: Paragraph) -> dict:
    text = ""
    lines = []
    for line in p.lines:
        piece = line.text
        if text:
            if _HYPHEN_BREAK.search(text) and piece[:1].islower():
                text = text[:-1]
                # Смещения предыдущей строки сдвигаются вместе с удалённым дефисом.
                lines[-1]["end"] = len(text)
            else:
                text += " "
        start = len(text)
        text += piece
        lines.append({"page": line.page, "bbox": list(line.bbox), "start": start, "end": len(text)})

    language = detect_language(text)
    fragment = {
        "kind": p.kind,
        "text": text,
        "language": language,
        "words": count_words(text),
        "lines": lines,
        "sentences": [list(s) for s in split_sentences(text, language)],
    }
    if p.exclude_reason:
        fragment["excludeReason"] = p.exclude_reason
    return fragment
