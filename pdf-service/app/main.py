from fastapi import FastAPI, File, HTTPException, UploadFile

from .extract import ExtractError, extract

MAX_BYTES = 50 * 1024 * 1024

app = FastAPI(title="Поля: разбор PDF")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/extract")
async def extract_pdf(file: UploadFile = File(...)) -> dict:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, detail={"code": "too_large", "message": "Файл больше 50 МБ."})
    try:
        return extract(data)
    except ExtractError as exc:
        raise HTTPException(422, detail={"code": exc.code, "message": exc.message}) from exc
