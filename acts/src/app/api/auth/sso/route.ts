import { errMsg } from '@/lib/api-err'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, createSessionToken } from '@/lib/auth'
import { ROLE_LABELS } from '@/lib/roles'
import { chatSsoEnabled, chatEnv, resolveChatUser } from '@/lib/chat-sso'

export async function POST(request: NextRequest) {
  if (!chatSsoEnabled()) {
    return NextResponse.json({ success: false, error: 'Вход через чат не настроен (CHAT_URL)' }, { status: 404 })
  }
  try {
    const token = request.cookies.get('localchat_token')?.value
      || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) {
      return NextResponse.json({
        success: false,
        error: 'Сначала войдите в чат — учёт использует его вход',
        needChatLogin: true,
      }, { status: 401 })
    }

    const chatUser = await resolveChatUser(token)
    if (!chatUser) {
      const { groupName } = chatEnv()
      return NextResponse.json({
        success: false,
        error: `Вход в чате есть, но вы не состоите в группе «${groupName}» — попросите администратора группы добавить вас`,
      }, { status: 403 })
    }

    let emp = await db.employee.findUnique({ where: { chatTag: chatUser.tag } })
    if (emp) {
      if (emp.role !== chatUser.role || !emp.isActive) {
        emp = await db.employee.update({
          where: { id: emp.id },
          data: { role: chatUser.role, isActive: true },
        })
      }
    } else {
      // Легаси: раньше создавались учётки с кодом chat:<тег>. Если такая есть —
      // подхватываем её (привязываем тег), новую НЕ создаём.
      const legacy = await db.employee.findUnique({ where: { code: `chat:${chatUser.tag}` } })
      if (legacy) {
        emp = await db.employee.update({
          where: { id: legacy.id },
          data: { chatTag: chatUser.tag, role: chatUser.role, isActive: true },
        })
      } else {
        // Без привязки — не пускаем и не плодим chat:<тег>. Начальник должен
        // вписать этот тег нужному сотруднику в разделе «Сотрудники».
        return NextResponse.json({
          success: false,
          needBinding: true,
          chatTag: chatUser.tag,
          error: `Чат-аккаунт «${chatUser.tag}» не привязан к сотруднику УТК. ` +
            `Начальник: раздел «Сотрудники» → впишите тег «${chatUser.tag}» нужному человеку, затем войдите снова.`,
        }, { status: 403 })
      }
    }

    const res = NextResponse.json({
      success: true,
      data: { code: emp.code, name: emp.name, role: emp.role },
      message: `${emp.code} · ${emp.name} (${ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}, вход через чат)`,
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
