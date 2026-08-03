"""JSON API (живая статистика) + импорт/экспорт Excel."""

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import SyncLog
from app.services import sync as sync_service
from app.services.excel_io import export_journal, import_journal
from app.services.stats import dashboard_stats

router = APIRouter()


@router.get("/api/stats")
def api_stats(db: Session = Depends(get_db)):
    return dashboard_stats(db)


@router.get("/dashboard")
def dashboard(request: Request):
    return request.app.state.templates.TemplateResponse(request, "dashboard.html")


# ---------------------------------------------------------------- Excel

@router.get("/sync")
def sync_page(request: Request, db: Session = Depends(get_db)):
    logs = db.query(SyncLog).order_by(SyncLog.at.desc()).limit(30).all()
    return request.app.state.templates.TemplateResponse(
        request, "sync.html", {"logs": logs, "sync": sync_service.status()}
    )


@router.post("/sync/import")
async def upload_import(file: UploadFile, db: Session = Depends(get_db)):
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)
    try:
        import_journal(db, tmp_path, source=file.filename or "upload")
        sync_service.mark_dirty()
    finally:
        tmp_path.unlink(missing_ok=True)
    return RedirectResponse("/sync", status_code=303)


@router.get("/sync/export")
def download_export(db: Session = Depends(get_db)):
    out = Path(tempfile.gettempdir()) / "journal_export.xlsx"
    export_journal(db, out)
    return FileResponse(
        out,
        filename="Журнал производства.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
