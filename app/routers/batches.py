"""Журнал актов: список, создание, карточка, смена статуса, дефекты."""

from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DEFECT_STATES, DEFECT_TYPES, STATUSES, Batch, Defect, StatusEvent
from app.services.sync import mark_dirty

router = APIRouter()


def _templates(request: Request):
    return request.app.state.templates


@router.get("/")
def journal(
    request: Request,
    db: Session = Depends(get_db),
    status: str = "",
    product: str = "",
    q: str = "",
):
    query = db.query(Batch)
    if status:
        query = query.filter(Batch.status == status)
    if product:
        query = query.filter(Batch.product == product)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                Batch.act_number.like(like),
                Batch.nc_act_number.like(like),
                Batch.note.like(like),
            )
        )
    batches = query.order_by(
        Batch.accepted_at.desc().nullslast(), Batch.id.desc()
    ).all()
    products = [p for (p,) in db.query(Batch.product).distinct().order_by(Batch.product)]
    return _templates(request).TemplateResponse(
        request,
        "journal.html",
        {
            "batches": batches,
            "statuses": STATUSES,
            "products": products,
            "f_status": status,
            "f_product": product,
            "f_q": q,
        },
    )


@router.post("/batches/create")
def create_batch(
    db: Session = Depends(get_db),
    act_number: str = Form(...),
    product: str = Form(...),
    quantity: int = Form(...),
    taken_by: str = Form(""),
    input_control: str = Form(""),
    note: str = Form(""),
):
    act_number = act_number.strip()
    product = product.strip()
    exists = (
        db.query(Batch)
        .filter(Batch.act_number == act_number, Batch.product == product)
        .first()
    )
    if exists:
        return RedirectResponse(f"/batches/{exists.id}?err=exists", status_code=303)

    # по схеме: есть входной контроль → статус "Входной контроль", нет → сразу в работу
    status = "Входной контроль" if input_control else "В работе"
    batch = Batch(
        act_number=act_number,
        product=product,
        quantity=quantity,
        status=status,
        accepted_at=datetime.now(),
        taken_by=taken_by.strip() or None,
        note=note.strip() or None,
    )
    db.add(batch)
    db.flush()
    db.add(
        StatusEvent(
            batch_id=batch.id,
            status=status,
            by_whom=taken_by.strip() or None,
            comment="Приём продукции со склада",
        )
    )
    db.commit()
    mark_dirty()
    return RedirectResponse(f"/batches/{batch.id}", status_code=303)


@router.get("/batches/{batch_id}")
def batch_detail(batch_id: int, request: Request, db: Session = Depends(get_db)):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404)
    return _templates(request).TemplateResponse(
        request,
        "batch.html",
        {
            "b": batch,
            "statuses": STATUSES,
            "defect_types": DEFECT_TYPES,
            "defect_states": DEFECT_STATES,
        },
    )


@router.post("/batches/{batch_id}/status")
def change_status(
    batch_id: int,
    db: Session = Depends(get_db),
    status: str = Form(...),
    by_whom: str = Form(""),
    comment: str = Form(""),
):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404)
    if status not in STATUSES:
        raise HTTPException(400, "Неизвестный статус")

    batch.status = status
    by = by_whom.strip() or None
    if status == "В работе" and by and not batch.taken_by:
        batch.taken_by = by  # подпись о взятии в работу
    if status == "Выходной контроль" and by:
        batch.output_control_by = by
    if status == "К отгрузке" and not batch.planned_ship_at:
        batch.planned_ship_at = datetime.now()
    if status == "Отгружен" and not batch.actual_ship_at:
        batch.actual_ship_at = datetime.now()

    db.add(
        StatusEvent(
            batch_id=batch.id,
            status=status,
            by_whom=by,
            comment=comment.strip() or None,
        )
    )
    db.commit()
    mark_dirty()
    return RedirectResponse(f"/batches/{batch_id}", status_code=303)


@router.post("/batches/{batch_id}/edit")
def edit_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    quantity: int = Form(...),
    planned_ship: str = Form(""),
    actual_ship: str = Form(""),
    note: str = Form(""),
):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404)
    batch.quantity = quantity
    batch.note = note.strip() or None
    for field, raw in (("planned_ship_at", planned_ship), ("actual_ship_at", actual_ship)):
        raw = raw.strip()
        if raw:
            try:
                setattr(batch, field, datetime.fromisoformat(raw))
            except ValueError:
                pass
        else:
            setattr(batch, field, None)
    db.commit()
    mark_dirty()
    return RedirectResponse(f"/batches/{batch_id}", status_code=303)


@router.post("/batches/{batch_id}/defects")
def add_defect(
    batch_id: int,
    db: Session = Depends(get_db),
    kind: str = Form(...),
    quantity: int = Form(1),
    label_number: str = Form(""),
    nc_act_number: str = Form(""),
    description: str = Form(""),
    reported_by: str = Form(""),
):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404)

    state = "В ремонте"
    if kind == "Аппаратная поломка":
        state = "Изолятор"  # по схеме: аппаратная поломка → изолятор
    if kind == "Массовый":
        state = "Ожидает решения"
    if kind == "На анализ":
        state = "На анализе"  # не диагностируется на месте — отдаём разработчику

    defect = Defect(
        batch_id=batch.id,
        kind=kind,
        state=state,
        quantity=quantity,
        label_number=label_number.strip() or None,
        description=description.strip() or None,
        reported_by=reported_by.strip() or None,
    )
    db.add(defect)

    if nc_act_number.strip():
        batch.nc_act_number = nc_act_number.strip()
    batch.repair_qty = (batch.repair_qty or 0) + quantity

    # массовый дефект (>2 одинаковых) — остановка, ожидание решения разработчика
    if kind == "Массовый":
        batch.status = "Остановлен"
        db.add(
            StatusEvent(
                batch_id=batch.id,
                status="Остановлен",
                by_whom=reported_by.strip() or None,
                comment="Массовый дефект — сообщено разработчику, ожидание решения",
            )
        )
    db.commit()
    mark_dirty()
    return RedirectResponse(f"/batches/{batch_id}", status_code=303)


@router.post("/defects/{defect_id}/state")
def defect_state(
    defect_id: int,
    db: Session = Depends(get_db),
    state: str = Form(...),
):
    defect = db.get(Defect, defect_id)
    if not defect:
        raise HTTPException(404)
    defect.state = state
    if state == "Возвращён в акт":
        # изделие всегда возвращается в свой акт в конце цикла
        defect.resolved_at = datetime.now()
        defect.batch.repair_qty = max(
            0, (defect.batch.repair_qty or 0) - defect.quantity
        )
    db.commit()
    mark_dirty()
    return RedirectResponse(f"/batches/{defect.batch_id}", status_code=303)
