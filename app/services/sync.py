"""Автоматическая двусторонняя синхронизация с Excel.

Режим «сетевая папка»: приложение следит за входным файлом (изменился —
импорт в базу) и после каждого изменения в базе перезаписывает выходной
файл. Пути задаются переменными окружения:

    SYNC_IMPORT_FILE  — файл, который ведёт начальство (вход)
    SYNC_EXPORT_FILE  — файл-отчёт, который пишет система (выход)
    SYNC_INTERVAL     — период проверки, сек (по умолчанию 30)

Файлы разделены намеренно: писать в файл, который человек держит открытым
в Excel, нельзя (блокировка). Выходной файл всегда свежий, его можно
открывать только для чтения. При переходе на OnlyOffice этот же код
используется в callback-е сохранения документа.
"""

import logging
import os
import threading
from pathlib import Path

from app.db import SessionLocal
from app.services.excel_io import export_journal, import_journal

log = logging.getLogger("sync")

IMPORT_FILE = os.environ.get("SYNC_IMPORT_FILE", "")
EXPORT_FILE = os.environ.get("SYNC_EXPORT_FILE", "")
INTERVAL = int(os.environ.get("SYNC_INTERVAL", "30"))

_state = {
    "last_mtime": 0.0,
    "last_import": None,
    "last_export": None,
    "last_error": None,
    "dirty": True,  # база изменилась → нужен экспорт
}
_lock = threading.Lock()
_stop = threading.Event()


def mark_dirty() -> None:
    """Вызывается после любого изменения данных — планирует экспорт."""
    with _lock:
        _state["dirty"] = True


def status() -> dict:
    with _lock:
        return {
            "import_file": IMPORT_FILE,
            "export_file": EXPORT_FILE,
            "interval": INTERVAL,
            "enabled": bool(IMPORT_FILE or EXPORT_FILE),
            "last_import": _state["last_import"],
            "last_export": _state["last_export"],
            "last_error": _state["last_error"],
        }


def _tick() -> None:
    # входящий файл: импортируем, если изменился
    if IMPORT_FILE:
        p = Path(IMPORT_FILE)
        if p.exists():
            mtime = p.stat().st_mtime
            if mtime > _state["last_mtime"]:
                db = SessionLocal()
                try:
                    res = import_journal(db, p, source=f"auto:{p.name}")
                    with _lock:
                        _state["last_mtime"] = mtime
                        _state["last_import"] = (
                            f"{res.at:%d.%m %H:%M} (+{res.created}/~{res.updated})"
                        )
                        _state["last_error"] = None
                        _state["dirty"] = True
                except Exception as e:  # noqa: BLE001 — файл может быть занят/битый
                    with _lock:
                        _state["last_error"] = f"импорт: {e}"
                    log.warning("import failed: %s", e)
                finally:
                    db.close()

    # исходящий файл: перезаписываем, если база менялась
    if EXPORT_FILE:
        with _lock:
            dirty = _state["dirty"]
        if dirty:
            db = SessionLocal()
            try:
                export_journal(db, EXPORT_FILE)
                with _lock:
                    _state["dirty"] = False
                    _state["last_export"] = None
                    from datetime import datetime

                    _state["last_export"] = datetime.now().strftime("%d.%m %H:%M")
                    _state["last_error"] = None
            except Exception as e:  # noqa: BLE001
                with _lock:
                    _state["last_error"] = f"экспорт: {e}"
                log.warning("export failed: %s", e)
            finally:
                db.close()


def _loop() -> None:
    while not _stop.wait(INTERVAL):
        _tick()


def start_watcher() -> None:
    if not (IMPORT_FILE or EXPORT_FILE):
        log.info("sync выключен (SYNC_IMPORT_FILE/SYNC_EXPORT_FILE не заданы)")
        return
    t = threading.Thread(target=_loop, name="excel-sync", daemon=True)
    t.start()
    log.info("sync запущен: in=%s out=%s каждые %sс", IMPORT_FILE, EXPORT_FILE, INTERVAL)
