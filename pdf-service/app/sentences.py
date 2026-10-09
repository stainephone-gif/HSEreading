"""Деление текста на предложения для русского и английского."""

import re

import pysbd
from razdel import sentenize

_CYRILLIC = re.compile(r"[а-яё]", re.IGNORECASE)
_LATIN = re.compile(r"[a-z]", re.IGNORECASE)
_WORD = re.compile(r"\w[\w'’-]*")

_en_segmenter = pysbd.Segmenter(language="en", clean=False, char_span=True)


def detect_language(text: str) -> str:
    cyr = len(_CYRILLIC.findall(text))
    lat = len(_LATIN.findall(text))
    return "ru" if cyr >= lat else "en"


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def split_sentences(text: str, language: str) -> list[tuple[int, int]]:
    """Границы предложений как пары (start, end) по смещениям в text, без крайних пробелов."""
    if language == "ru":
        spans = [(s.start, s.stop) for s in sentenize(text)]
    else:
        spans = [(s.start, s.end) for s in _en_segmenter.segment(text)]

    result = []
    for start, end in spans:
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if end > start:
            result.append((start, end))
    return result
