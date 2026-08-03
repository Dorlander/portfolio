from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Жизненный цикл акта — по схеме производства (Visio)
STATUSES = [
    "Принят",
    "Входной контроль",
    "В работе",
    "Остановлен",           # массовый дефект — ожидание решения разработчика
    "Выходной контроль",
    "К отгрузке",
    "Отгружен",
]

DEFECT_TYPES = ["Новый", "Уже был", "Массовый", "Аппаратная поломка", "На анализ"]
DEFECT_STATES = [
    "В ремонте",
    "Изолятор",
    "На анализе",        # не диагностируется на месте — передано разработчику
    "Возвращён в акт",
    "Ожидает решения",
]


class Batch(Base):
    """Партия изделий (акт). Изделие не отделяется от своего акта."""

    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("act_number", "product", name="uq_act_product"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    act_number: Mapped[str] = mapped_column(String(50), index=True)
    product: Mapped[str] = mapped_column(String(100), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(50), default="Принят", index=True)

    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    planned_ship_at: Mapped[datetime | None] = mapped_column(DateTime)
    actual_ship_at: Mapped[datetime | None] = mapped_column(DateTime)

    nc_act_number: Mapped[str | None] = mapped_column(String(50))   # акт несоответствия
    repair_qty: Mapped[int] = mapped_column(Integer, default=0)     # кол-во в ремонте
    output_control_by: Mapped[str | None] = mapped_column(String(50))  # выполнил вых. контроль
    taken_by: Mapped[str | None] = mapped_column(String(100))       # подпись о взятии в работу
    note: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now
    )

    defects: Mapped[list["Defect"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    history: Mapped[list["StatusEvent"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="StatusEvent.at",
    )


class Defect(Base):
    """Несоответствие, найденное при тестировании."""

    __tablename__ = "defects"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    kind: Mapped[str] = mapped_column(String(50))       # Новый / Уже был / Массовый / Аппаратная поломка
    state: Mapped[str] = mapped_column(String(50), default="В ремонте")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    label_number: Mapped[str | None] = mapped_column(String(50))  # ярлык несоответствия
    description: Mapped[str | None] = mapped_column(Text)
    reported_by: Mapped[str | None] = mapped_column(String(100))  # тестировщик
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)

    batch: Mapped[Batch] = relationship(back_populates="defects")


class StatusEvent(Base):
    """История смены статусов — основа живой статистики и трассировки."""

    __tablename__ = "status_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id"), index=True)
    status: Mapped[str] = mapped_column(String(50))
    by_whom: Mapped[str | None] = mapped_column(String(100))
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    comment: Mapped[str | None] = mapped_column(Text)

    batch: Mapped[Batch] = relationship(back_populates="history")


class SyncLog(Base):
    """Журнал синхронизаций с Excel."""

    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    direction: Mapped[str] = mapped_column(String(10))  # import / export
    source: Mapped[str] = mapped_column(String(255))
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    detail: Mapped[str | None] = mapped_column(Text)
