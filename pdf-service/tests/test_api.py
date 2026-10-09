from fastapi.testclient import TestClient

from app.main import app

from .fixtures import ru_article, scanned

client = TestClient(app)


def test_extract_endpoint():
    pdf, _ = ru_article()
    res = client.post("/extract", files={"file": ("a.pdf", pdf, "application/pdf")})
    assert res.status_code == 200
    data = res.json()
    assert data["pageCount"] == 2
    assert data["pages"][0] == {"width": 595.0, "height": 842.0}
    assert any(f["kind"] == "body" for f in data["fragments"])


def test_extract_endpoint_rejects_scan():
    res = client.post("/extract", files={"file": ("a.pdf", scanned(), "application/pdf")})
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "no_text_layer"
