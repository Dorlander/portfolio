import { errMsg } from '@/lib/api-err'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  SESSION_COOKIE, createSessionToken, ensureSeedEmployee, getSession, hashPin,
} from '@/lib/auth'
import { chatSsoEnabled, chatEnv } from '@/lib/chat-sso'

export async function GET(request: NextRequest) {
  await ensureSeedEmployee()
  const employees = await db.employee.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, role: true },
    orderBy: { code: 'asc' },
  })
  return NextResponse.json({
    success: true,
    data: {
      me: getSession(request),
      employees,
      chat: {
        sso: chatSsoEnabled(),

        publicUrl: chatEnv().publicUrl,
        groupName: chatEnv().groupName,
      },
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const { employeeId, pin } = await request.json()
    const emp = await db.employee.findUnique({ where: { id: employeeId } })
    if (!emp || !emp.isActive || emp.pin !== hashPin(String(pin || ''))) {
      return NextResponse.json({ success: false, error: 'Неверный PIN' }, { status: 401 })
    }
    const res = NextResponse.json({
      success: true,
      data: { code: emp.code, name: emp.name, role: emp.role },
      message: `${emp.code} · ${emp.name}`,
    })
    res.cookies.set(SESSION_COOKIE, createSessionToken(emp), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 3600,
    })
    return res
  } catch (e) {
    return NextResponse.json({ success: false, error: errMsg(e) }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
