import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.db import Base, SessionLocal, engine
from app.routers import api, batches
from app.services.sync import start_watcher

logging.basicConfig(level=logging.INFO)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Производственный учёт")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
app.state.templates = Jinja2Templates(directory=BASE_DIR / "templates")

Base.metadata.create_all(bind=engine)

app.include_router(batches.router)
app.include_router(api.router)


@app.on_event("startup")
def _startup():
    # первый запуск на пустой базе: подхватываем образец журнала, если есть
    sample = BASE_DIR.parent / "samples" / "journal_sample.xlsx"
    db = SessionLocal()
    try:
        from app.models import Batch
        from app.services.excel_io import import_journal

        if sample.exists() and db.query(Batch).first() is None:
            import_journal(db, sample, source="стартовый образец")
    finally:
        db.close()
    start_watcher()
