from __future__ import annotations

import pymupdf

from .pdfgen import Item, Layout, Writer

RU_PARAGRAPHS = [
    "Медиатеория второй половины XX века исходит из простого допущения: способ передачи со~общения "
    "меняет само сообщение. Это утверждение, т. е. тезис Маклюэна, обычно цитируют без контекста. "
    "Между тем у него есть пред~шественники, и прежде всего Г. А. Иннис, который писал о пространстве и времени.",
    "Иннис различал средства, тяго~теющие ко времени, и средства, тяго~теющие к пространству. Камень и "
    "пергамент долго~вечны, но тяжелы; папирус и бумага легки, но недолго~вечны. Отсюда он выводил "
    "устройство империй и церквей, а также их уязви~мость перед новыми средствами передачи.",
    "Вторая линия рассуж~дения связана с чтением как практикой. Читатель рукописи и читатель печатной "
    "книги находятся в разных условиях: первый медленно восста~навливает текст, второй быстро "
    "пробегает знакомые формы. А. С. Пушкин и его современники читали уже вторым способом.",
    "Третья линия касается письма на полях. Маргиналии фиксируют не столько понимание, сколько "
    "встречу с текстом, и потому служат свидетельством чтения. Ниже мы рассмотрим, как эту "
    "особен~ность использовали исследо~ватели книжной культуры, и что из неё следует для учебного чтения.",
]

RU_METHOD = [
    "Мы опираемся на корпус из сорока учебных текстов, прочитанных студентами двух потоков. Для каждого "
    "текста собраны заметки на полях, ответы на вопросы и короткие рефлексии. Каждая заметка привязана "
    "к фрагменту, поэтому можно восстановить, какие места текста вызывали вопросы, а какие оставались "
    "без внимания, хотя и были прочитаны, как показывает время, проведённое на странице, и порядок "
    "пере~ходов между разделами, который сохраняет читалка вместе с отметками времени.",
    "Анализ проведён в два этапа. Сначала заметки размечены по типам: вопрос, возражение, связь, "
    "пример. Затем для каждого типа подсчи~тано, в каких частях текста он встречается чаще всего.",
]

RU_NOTE = "1 Здесь и далее цитаты приводятся по изданию 1964 года, если не оговорено иное."


def ru_article() -> tuple[bytes, dict]:
    items = [
        Item("Чтение на полях: краткая история", "title", 16),
        Item("Введение", "heading", 12),
        *[Item(t) for t in RU_PARAGRAPHS],
        Item("1. Метод", "heading", 12),
        *[Item(t) for t in RU_METHOD],
        *[Item(t) for t in RU_PARAGRAPHS[1:]],
        *[Item(t) for t in RU_METHOD],
        *[Item(t) for t in RU_PARAGRAPHS],
    ]
    layout = Layout(indent=18, header="Вестник чтения. 2026. № 3", notes={0: RU_NOTE})
    return Writer(layout).build(items), {"paragraphs": RU_PARAGRAPHS + RU_METHOD + RU_PARAGRAPHS[1:] + RU_METHOD + RU_PARAGRAPHS}


EN_ABSTRACT = (
    "We describe a reading tool that hides tasks inside the text. A task appears only after the "
    "student has spent enough time on the paragraph, e.g. half of the estimated reading time."
)

EN_PARAGRAPHS = [
    "Social annotation platforms count traces of activity. Students write comments, reply to peers, and "
    "receive automatic scores for each contri~bution. Prior work by Clinton-Lisell et al. reports higher "
    "moti~vation but no difference in exam scores, which sug~gests that activity is a weak proxy for reading.",
    "Language models change this picture. A comment that once required reading the text can now be "
    "gene~rated in seconds, so counting comments says little about whether the text was read at all.",
    "Our approach moves the evidence from the comment to the moment of reading. Tasks are not present "
    "in the file and are revealed by the reader only after the student reaches the right place, so a "
    "model that receives the PDF does not see them and cannot answer them in advance of reading.",
    "Each scattered task is placed in a random paragraph of a range, and the place~ment is fixed for a "
    "student on the first visit. This makes it harder to share locations between stu~dents.",
    "The pilot covers three texts and one group of stu~dents. We log when each paragraph enters the "
    "reading zone, how long it stays there, and which tasks and easter eggs are found and solved.",
]


def en_two_column() -> tuple[bytes, dict]:
    items = [
        Item("Hidden Tasks for Attentive Reading", "title", 16),
        Item("Abstract", "heading", 11),
        Item(EN_ABSTRACT),
        Item("1 Introduction", "heading", 11),
        *[Item(t) for t in EN_PARAGRAPHS[:3]],
        Item("2 Design", "heading", 11),
        *[Item(t) for t in EN_PARAGRAPHS[3:]],
        *[Item(t) for t in EN_PARAGRAPHS * 4],
    ]
    layout = Layout(columns=2, para_gap=6, header="Proceedings of Reading Tools 2026")
    return Writer(layout).build(items), {"paragraphs": [EN_ABSTRACT] + EN_PARAGRAPHS * 5}


def scanned() -> bytes:
    doc = pymupdf.open()
    for _ in range(2):
        page = doc.new_page(width=595, height=842)
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
        pix.clear_with(200)
        page.insert_image(pymupdf.Rect(50, 50, 545, 792), pixmap=pix)
    return doc.tobytes()
