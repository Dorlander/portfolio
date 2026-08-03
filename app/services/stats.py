"""Запросы для живой статистики (дашборд)."""

from datetime import date, datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models import STATUSES, Batch, Defect, StatusEvent


def dashboard_stats(db: Session) -> dict:
    now = datetime.now()
    today = date.today()
    month_ago = now - timedelta(days=30)

    # партии по статусам
    by_status = dict(
        db.query(Batch.status, func.count(Batch.id)).group_by(Batch.status).all()
    )
    qty_by_status = dict(
        db.query(Batch.status, func.sum(Batch.quantity)).group_by(Batch.status).all()
    )

    # сводка по изделиям
    by_product = [
        {
            "product": p,
            "batches": c,
            "quantity": int(q or 0),
            "repair": int(r or 0),
            "shipped": int(s or 0),
        }
        for p, c, q, r, s in db.query(
            Batch.product,
            func.count(Batch.id),
            func.sum(Batch.quantity),
            func.sum(Batch.repair_qty),
            func.sum(case((Batch.status == "Отгружен", Batch.quantity), else_=0)),
        )
        .group_by(Batch.product)
        .order_by(Batch.product)
        .all()
    ]

    # отгрузки по дням за 30 дней
    shipped_rows = (
        db.query(
            func.date(Batch.actual_ship_at),
            func.sum(Batch.quantity),
        )
        .filter(Batch.actual_ship_at.isnot(None), Batch.actual_ship_at >= month_ago)
        .group_by(func.date(Batch.actual_ship_at))
        .all()
    )
    shipped_map = {str(d): int(q or 0) for d, q in shipped_rows}
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    shipped_by_day = [{"day": d, "qty": shipped_map.get(d, 0)} for d in days]

    # приёмка по дням за 30 дней
    accepted_rows = (
        db.query(func.date(Batch.accepted_at), func.sum(Batch.quantity))
        .filter(Batch.accepted_at.isnot(None), Batch.accepted_at >= month_ago)
        .group_by(func.date(Batch.accepted_at))
        .all()
    )
    accepted_map = {str(d): int(q or 0) for d, q in accepted_rows}
    accepted_by_day = [{"day": d, "qty": accepted_map.get(d, 0)} for d in days]

    # дефекты
    open_defects = (
        db.query(func.count(Defect.id))
        .filter(
            Defect.state.in_(["В ремонте", "Изолятор", "На анализе", "Ожидает решения"])
        )
        .scalar()
        or 0
    )
    isolator = (
        db.query(func.count(Defect.id)).filter(Defect.state == "Изолятор").scalar()
        or 0
    )
    analysis = (
        db.query(func.sum(Defect.quantity))
        .filter(Defect.state == "На анализе")
        .scalar()
        or 0
    )
    defects_by_product = [
        {"product": p, "qty": int(q or 0)}
        for p, q in db.query(Batch.product, func.sum(Batch.repair_qty))
        .group_by(Batch.product)
        .having(func.sum(Batch.repair_qty) > 0)
        .all()
    ]

    total_qty = db.query(func.sum(Batch.quantity)).scalar() or 0
    total_repair = db.query(func.sum(Batch.repair_qty)).scalar() or 0

    # среднее время от приёмки до фактической отгрузки (дней)
    lead_rows = (
        db.query(Batch.accepted_at, Batch.actual_ship_at)
        .filter(Batch.accepted_at.isnot(None), Batch.actual_ship_at.isnot(None))
        .all()
    )
    lead_days = [
        (s - a).total_seconds() / 86400 for a, s in lead_rows if s >= a
    ]
    avg_lead = round(sum(lead_days) / len(lead_days), 1) if lead_days else None

    # просроченные: план отгрузки прошёл, а не отгружено
    overdue = (
        db.query(func.count(Batch.id))
        .filter(
            Batch.planned_ship_at.isnot(None),
            Batch.planned_ship_at < now,
            Batch.status != "Отгружен",
        )
        .scalar()
        or 0
    )

    # последние события
    recent = [
        {
            "at": e.at.strftime("%d.%m %H:%M"),
            "batch": f"{e.batch.product} / акт {e.batch.act_number}",
            "status": e.status,
            "by": e.by_whom or "",
        }
        for e in db.query(StatusEvent)
        .join(Batch)
        .order_by(StatusEvent.at.desc())
        .limit(12)
        .all()
    ]

    return {
        "generated_at": now.strftime("%d.%m.%Y %H:%M:%S"),
        "statuses": STATUSES,
        "by_status": {s: int(by_status.get(s, 0)) for s in STATUSES},
        "qty_by_status": {s: int(qty_by_status.get(s) or 0) for s in STATUSES},
        "by_product": by_product,
        "shipped_by_day": shipped_by_day,
        "accepted_by_day": accepted_by_day,
        "open_defects": int(open_defects),
        "isolator": int(isolator),
        "analysis": int(analysis),
        "defects_by_product": defects_by_product,
        "total_qty": int(total_qty),
        "total_repair": int(total_repair),
        "defect_rate": round(total_repair / total_qty * 100, 1) if total_qty else 0,
        "avg_lead_days": avg_lead,
        "overdue": int(overdue),
        "recent": recent,
    }
