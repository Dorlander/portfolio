import { errMsg } from '@/lib/api-err'
import { NextRequest, NextResponse } from 'next/server'
import { buildJournalWorkbook } from '@/lib/journal-excel'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'tester')
  if ('response' in auth) return auth.response
  try {
    const wb = await buildJournalWorkbook()
    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('Журнал производства.xlsx')}`,
      },
    })
  } catch (error) {
    console.error('Journal export error:', error)
    return NextResponse.json({ success: false, error: errMsg(error, 'Ошибка экспорта') }, { status: 500 })
  }
}
