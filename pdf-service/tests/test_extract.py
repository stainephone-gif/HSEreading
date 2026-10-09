import re

import pytest

from app.extract import ExtractError, Line, Paragraph, _continues, extract

from .fixtures import en_two_column, ru_article, scanned
from .pdfgen import clean


def body(result):
    return [f for f in result["fragments"] if f["kind"] == "body"]


def assert_offsets(fragment):
    text = fragment["text"]
    for line in fragment["lines"]:
        assert 0 <= line["start"] < line["end"] <= len(text)
    for start, end in fragment["sentences"]:
        assert text[start:end] == text[start:end].strip()


@pytest.fixture(scope="module")
def ru():
    pdf, expected = ru_article()
    return extract(pdf), expected


@pytest.fixture(scope="module")
def en():
    pdf, expected = en_two_column()
    return extract(pdf), expected


def test_ru_paragraphs_match_source(ru):
    result, expected = ru
    assert result["language"] == "ru"
    assert result["pageCount"] == 2
    assert [f["text"] for f in body(result)] == [clean(t) for t in expected["paragraphs"]]


def test_ru_fixture_exercises_hard_cases(ru):
    """Фикстура действительно содержит переносы слов и абзац через страницу."""
    result, _ = ru
    pdf, _ = ru_article()
    import pymupdf

    raw = "".join(p.get_text() for p in pymupdf.open(stream=pdf))
    assert re.search(r"[а-я]-\n", raw)
    assert any(len({l["page"] for l in f["lines"]}) == 2 for f in body(result))


def test_ru_headings_and_excluded(ru):
    result, _ = ru
    headings = [f["text"] for f in result["fragments"] if f["kind"] == "heading"]
    assert headings == ["Чтение на полях: краткая история", "Введение", "1. Метод"]

    excluded = [f for f in result["fragments"] if f["kind"] == "excluded"]
    texts = [f["text"] for f in excluded]
    assert texts.count("Вестник чтения. 2026. № 3") == 2
    assert "1" in texts and "2" in texts
    note = next(f for f in excluded if f["text"].startswith("1 Здесь"))
    assert "сноска" in note["excludeReason"]


def test_ru_sentences_respect_abbreviations(ru):
    result, _ = ru
    first = body(result)[0]
    sentences = [first["text"][s:e] for s, e in first["sentences"]]
    assert len(sentences) == 3
    assert sentences[1].startswith("Это утверждение, т. е. тезис Маклюэна")
    assert "Г. А. Иннис" in sentences[2]


def test_en_two_columns(en):
    result, expected = en
    assert result["language"] == "en"
    assert [f["text"] for f in body(result)] == [clean(t) for t in expected["paragraphs"]]
    # Абзац, перетекающий из левой колонки в правую, остаётся одним фрагментом.
    assert any(len({l["bbox"][0] > 297 for l in f["lines"]}) == 2 for f in body(result))


def test_en_sentences(en):
    result, _ = en
    social = next(f for f in body(result) if f["text"].startswith("Social annotation"))
    sentences = [social["text"][s:e] for s, e in social["sentences"]]
    assert len(sentences) == 3
    assert "Clinton-Lisell et al. reports" in sentences[2]


def test_offsets_are_consistent(ru, en):
    for result, _ in (ru, en):
        for fragment in result["fragments"]:
            assert_offsets(fragment)
            assert fragment["words"] > 0


def test_line_offsets_point_to_line_text(ru):
    result, _ = ru
    for fragment in body(result):
        lines = fragment["lines"]
        # Строки идут подряд без нахлёста.
        for a, b in zip(lines, lines[1:]):
            assert a["end"] <= b["start"]
        assert lines[-1]["end"] == len(fragment["text"])


def test_scanned_pdf_rejected():
    with pytest.raises(ExtractError) as err:
        extract(scanned())
    assert err.value.code == "no_text_layer"


def test_garbage_rejected():
    with pytest.raises(ExtractError) as err:
        extract(b"not a pdf at all")
    assert err.value.code == "invalid_pdf"


def _para(*texts, right=500.0, last_x1=500.0):
    lines = [Line(0, (60, 0, 500, 10), t, 10, False, 1) for t in texts]
    lines[-1].bbox = (60, 0, last_x1, 10)
    return Paragraph(lines=lines, right=right)


@pytest.mark.parametrize(
    "prev, nxt, expected",
    [
        (_para("первая строка", "обрывается на"), _para("середине фразы."), True),
        (_para("first line", "ends with a name like"), _para("Clinton-Lisell and others."), True),
        (_para("first line", "ends with a period."), _para("New paragraph."), False),
        (_para("first line", "short last line", last_x1=200), _para("New paragraph."), False),
    ],
)
def test_continuation_rule(prev, nxt, expected):
    assert _continues(prev, nxt) is expected
