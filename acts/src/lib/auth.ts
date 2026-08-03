import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { signJwt, verifyJwt } from '@/lib/onlyoffice'

import { ROLE_LABELS, atLeast, type Role } from '@/lib/roles'
export { ROLE_LABELS, atLeast }
export type { Role }

function resolveSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET
  try {
    const dir = fs.existsSync('/app/data') ? '/app/data' : path.join(process.cwd(), 'db')
    const file = path.join(dir, '.auth-secret')
    if (fs.existsSync(file)) {
      const s = fs.readFileSync(file, 'utf8').trim()
      if (s.length >= 32) return s
    }
    const fresh = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, fresh, { mode: 0o600 })
    return fresh
  } catch {

    return crypto.randomBytes(32).toString('hex')
  }
}
const SECRET = resolveSecret()
export const SESSION_COOKIE = 'uchet_session'
const SESSION_HOURS = 12

export const hashPin = (pin: string): string =>
  crypto.createHash('sha256').update(`uchet:${pin}`).digest('hex')

export interface Session {
  id: string
  code: string
  name: string
  role: Role
  exp: number
}

export function createSessionToken(emp: { id: string; code: string; name: string; role: string }): string {
  const session: Session = {
    id: emp.id,
    code: emp.code,
    name: emp.name,
    role: emp.role as Role,
    exp: Date.now() + SESSION_HOURS * 3600_000,
  }
  return signJwt(session, SECRET)
}

export function getSession(request: NextRequest): Session | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token || !verifyJwt(token, SECRET)) return null
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    ) as Session
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function requireRole(
  request: NextRequest,
  min: Role = 'tester',
): Promise<{ session: Session } | { response: NextResponse }> {
  const session = getSession(request)
  if (!session) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Войдите в систему, чтобы вносить изменения', needLogin: true },
        { status: 401 },
      ),
    }
  }

  const emp = await db.employee.findUnique({
    where: { id: session.id },
    select: { code: true, name: true, role: true, isActive: true },
  }).catch(() => null)
  if (!emp || !emp.isActive) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Учётная запись отключена — войдите заново', needLogin: true },
        { status: 401 },
      ),
    }
  }
  const live: Session = { ...session, code: emp.code, name: emp.name, role: emp.role as Role }
  if (!atLeast(live.role, min)) {
    return {
      response: NextResponse.json(
        { success: false, error: `Недостаточно прав (нужна роль: ${ROLE_LABELS[min]})` },
        { status: 403 },
      ),
    }
  }
  return { session: live }
}

export async function ensureSeedEmployee(): Promise<void> {
  const count = await db.employee.count()
  if (count === 0) {
    await db.employee.create({
      data: { code: 'АДМ', name: 'Начальник', role: 'boss', pin: hashPin('1234') },
    })
  }
}
