import { NextResponse } from 'next/server'
import { getSyncState } from '@/lib/folder-sync'

export async function GET() {
  return NextResponse.json({ success: true, data: getSyncState() })
}
