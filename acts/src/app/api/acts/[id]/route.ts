import { errMsg } from '@/lib/api-err'
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ACT_STATUSES } from '@/lib/statuses';
import { requireRole, atLeast } from '@/lib/auth';
import { applyStatusChange } from '@/lib/act-transitions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const act = await db.act.findUnique({ where: { id } });
    if (!act) return NextResponse.json({ success: false, error: 'Не найден' }, { status: 404 });
    return NextResponse.json({ success: true, data: act });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'tester');
  if ('response' in auth) return auth.response;
  const who = auth.session;
  try {
    const { id } = await params;
    const body = await request.json();

    const existingAct = await db.act.findUnique({ where: { id } });
    if (!existingAct) return NextResponse.json({ success: false, error: 'Не найден' }, { status: 404 });

    const allowedFields = [
      'status', 'quantity', 'actDate', 'actTime', 'actType', 'productId',
      'employeeName', 'notes', 'takenBy', 'ncActNumber', 'shippedQty',
      'plannedShipAt', 'actualShipAt', 'outputControlBy', 'source', 'purpose',
    ];
    const updateData: Record<string, any> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }
    for (const dateField of ['actDate', 'plannedShipAt', 'actualShipAt']) {
      if (typeof updateData[dateField] === 'string' && updateData[dateField]) {
        updateData[dateField] = new Date(updateData[dateField]);
      }
    }

    if (updateData.status !== undefined && !(ACT_STATUSES as readonly string[]).includes(updateData.status)) {
      return NextResponse.json({ success: false, error: 'Неизвестный статус' }, { status: 400 });
    }
    if (updateData.quantity !== undefined) {
      const q = parseInt(updateData.quantity);
      if (!Number.isFinite(q) || q < 1) {
        return NextResponse.json({ success: false, error: 'Количество должно быть целым числом больше нуля' }, { status: 400 });
      }

      const busy = (existingAct.repairQty || 0) + (existingAct.analysisQty || 0);
      if (q < busy) {
        return NextResponse.json({
          success: false,
          error: `Нельзя уменьшить количество до ${q}: в ремонте и на анализе уже ${busy}. Сначала верните изделия в акт.`,
        }, { status: 400 });
      }

      const unitCount = await db.unit.count({ where: { actId: id } });
      if (q < unitCount) {
        return NextResponse.json({
          success: false,
          error: `Нельзя уменьшить количество до ${q}: в акте отсканировано ${unitCount} серийных номеров. Сначала удалите лишние.`,
        }, { status: 400 });
      }
      updateData.quantity = q;
    }
    if (updateData.shippedQty !== undefined) {
      const s = parseInt(updateData.shippedQty);
      const max = updateData.quantity ?? existingAct.quantity;
      if (!Number.isFinite(s) || s < 0 || s > max) {
        return NextResponse.json({
          success: false,
          error: `Отгруженное количество должно быть целым числом от 0 до ${max}`,
        }, { status: 400 });
      }
      updateData.shippedQty = s;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: 'Нет данных для обновления' }, { status: 400 });
    }

    const newStatus = updateData.status;
    delete updateData.status;

    // Структурные поля акта (количество, отгрузка, выходной контроль, источник и т.д.)
    // правит только старший/начальник. Тестировщику — примечание и смена статуса
    // (которая сама гейтится по техпроцессу и ролям в applyStatusChange).
    const structuralTouched = Object.keys(updateData).filter(k => k !== 'notes');
    if (structuralTouched.length > 0 && !atLeast(who.role, 'senior')) {
      return NextResponse.json({
        success: false,
        error: 'Эти поля акта (количество, отгрузка, выходной контроль и пр.) меняет старший тестировщик или начальник.',
      }, { status: 403 });
    }

    if (newStatus && newStatus !== existingAct.status) {
      const result = await applyStatusChange(id, newStatus, who, body.comment, body.expectedFrom);
      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status || 400 });
      }
    }

    const updatedAct = Object.keys(updateData).length > 0
      ? await db.act.update({ where: { id }, data: updateData })
      : await db.act.findUnique({ where: { id } });

    if (Object.keys(updateData).length > 0) {
      const FIELD_LABELS: Record<string, string> = {
        quantity: 'Количество', actDate: 'Дата акта', actTime: 'Время акта',
        actType: 'Изделие', productId: 'Изделие (справочник)', employeeName: 'Сотрудник',
        notes: 'Примечание', takenBy: 'Принял', ncActNumber: 'Акт несоответствия',
        shippedQty: 'Отгружено штук', plannedShipAt: 'К отгрузке (план)',
        actualShipAt: 'Отгружен (факт)', outputControlBy: 'Выходной контроль',
        source: 'Источник', purpose: 'Назначение',
      };
      const fmt = (v: unknown) =>
        v instanceof Date ? v.toLocaleString('ru-RU') : String(v ?? '—');
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const parts: string[] = [];
      for (const [field, value] of Object.entries(updateData)) {
        const before = (existingAct as Record<string, unknown>)[field];
        if (String(before ?? '') === String(value ?? '')) continue;
        changes[field] = { from: before ?? null, to: value ?? null };
        parts.push(`${FIELD_LABELS[field] || field}: «${fmt(before)}» → «${fmt(value)}»`);
      }
      if (parts.length > 0) {
        await db.actionLog.create({
          data: {
            actionType: 'UPDATE_ACT',
            entityType: 'ACT',
            entityId: id,
            entityNumber: existingAct.actNumber,
            actId: id,
            description: `Акт ${existingAct.actNumber}: ${parts.join('; ')}`,
            changes: JSON.stringify(changes),
            userId: who.code,
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, data: updatedAct, message: `Акт ${existingAct.actNumber} обновлён` });
  } catch (error) {
    console.error('PUT error:', error);
    return NextResponse.json({ success: false, error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'boss');
  if ('response' in auth) return auth.response;
  const who = auth.session;
  try {
    const { id } = await params;
    const act = await db.act.findUnique({
      where: { id },
      include: { _count: { select: { units: true, defects: true } } },
    });
    if (!act) return NextResponse.json({ success: false, error: 'Не найден' }, { status: 404 });
    await db.act.delete({ where: { id } });
    await db.actionLog.create({
      data: {
        actionType: 'DELETE_ACT',
        entityType: 'ACT',
        entityId: id,
        entityNumber: act.actNumber,
        description: `Акт ${act.actNumber} удалён из системы (${act.quantity} шт., статус ${act.status}, ` +
          `серийников ${act._count.units}, ярлыков ${act._count.defects})`,
        userId: who.code,
      },
    }).catch(() => {});
    return NextResponse.json({ success: true, message: `Акт ${act.actNumber} удалён` });
  } catch (error) {
    return NextResponse.json({ success: false, error: errMsg(error) }, { status: 500 });
  }
}
