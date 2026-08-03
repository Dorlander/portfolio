import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const file = path.join(ROOT, '.env')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  }
}
loadEnv()

const CFG = {
  uchetUrl: (process.env.UCHET_URL || 'http://localhost:3000').replace(/\/$/, ''),

  uchetPublicUrl: (process.env.UCHET_PUBLIC_URL || process.env.UCHET_URL || 'http://localhost:3000').replace(/\/$/, ''),
  chatUrl: (process.env.CHAT_URL || 'http://localhost:3780').replace(/\/$/, ''),
  botUser: process.env.CHAT_BOT_USER || '',
  botPassword: process.env.CHAT_BOT_PASSWORD || '',
  groupName: process.env.CHAT_GROUP_NAME || '',
  pollSeconds: Math.max(10, parseInt(process.env.POLL_SECONDS || '30') || 30),
}

const STATE_FILE = path.join(ROOT, '.bridge-state.json')
const loadState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return { sentIds: [] } }
}
const saveState = (s) => {

  s.sentIds = s.sentIds.slice(-3000)
  fs.writeFileSync(STATE_FILE, JSON.stringify(s))
}

const log = (...a) => console.log(new Date().toLocaleTimeString('ru-RU'), ...a)

let token = null
let groupId = null

async function chatLogin() {
  const res = await fetch(`${CFG.chatUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: CFG.botUser, password: CFG.botPassword }),
  })
  if (!res.ok) throw new Error(`вход в чат не удался (${res.status}): ${await res.text()}`)
  const json = await res.json()
  token = json.token
  log(`вход в чат: ${json.user?.displayName || json.user?.username || CFG.botUser}`)
}

async function resolveGroup() {
  const res = await fetch(`${CFG.chatUrl}/api/groups`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`не удалось получить группы (${res.status})`)
  const groups = await res.json()
  const found = groups.find(g => g.name === CFG.groupName)
  if (!found) {
    throw new Error(
      `бот не состоит в группе «${CFG.groupName}». Доступные группы: ` +
      (groups.map(g => g.name).join(', ') || 'нет — пригласите бота в группу'),
    )
  }
  groupId = found.id
  log(`группа найдена: «${found.name}» (id ${groupId})`)
}

async function sendToChat(text) {
  const form = new FormData()
  form.set('body', text)
  const res = await fetch(`${CFG.chatUrl}/api/groups/${groupId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (res.status === 401) {

    await chatLogin()
    return sendToChat(text)
  }
  if (!res.ok) throw new Error(`отправка в чат не удалась (${res.status}): ${await res.text()}`)
}

function actLink(entry) {
  if (entry.actId) return `\n${CFG.uchetPublicUrl}/?actId=${entry.actId}`
  if (entry.entityNumber) return `\n${CFG.uchetPublicUrl}/?act=${encodeURIComponent(entry.entityNumber)}`
  return ''
}

function shouldNotify(entry) {
  const d = entry.description || ''
  if (entry.actionType === 'CREATE_DEFECT' && d.includes('Массовый')) {
    return `🚨 ${d}${actLink(entry)}`
  }
  if (entry.actionType === 'UPDATE_DEFECT' && d.includes('Изолятор')) {
    return `📦 ${d}${actLink(entry)}`
  }
  if (entry.actionType === 'CHANGE_STATUS' && d.includes('Отгружен')) {
    return `🚚 ${d}${entry.userId ? ` (${entry.userId})` : ''}${actLink(entry)}`
  }
  if (entry.actionType === 'CHANGE_STATUS' && d.includes('обход техпроцесса')) {
    return `⚠️ ${d}${entry.userId ? ` (${entry.userId})` : ''}${actLink(entry)}`
  }
  return null
}

async function pollOnce(state) {

  const res = await fetch(`${CFG.uchetUrl}/api/logs?limit=1000`)
  if (!res.ok) throw new Error(`учёт недоступен (${res.status})`)
  const json = await res.json()
  const entries = (Array.isArray(json.data) ? json.data : json.data?.logs || [])
  const sent = new Set(state.sentIds)

  const fresh = entries
    .filter(e => !sent.has(e.id))
    .filter(e => new Date(e.createdAt).getTime() >= state.startedAt)
    .reverse()
  for (const e of fresh) {
    const text = shouldNotify(e)
    if (text) {

      try {
        await sendToChat(text)
      } catch (err) {
        log('не отправлено (повторю позже):', err?.message || err)
        break
      }
      log('отправлено:', text.slice(0, 100))
    }
    state.sentIds.push(e.id)
    saveState(state)
  }
}

async function main() {
  const missing = []
  if (!CFG.botUser) missing.push('CHAT_BOT_USER')
  if (!CFG.botPassword) missing.push('CHAT_BOT_PASSWORD')
  if (!CFG.groupName) missing.push('CHAT_GROUP_NAME')
  if (missing.length) {
    console.error(`Заполните в chat-bridge/.env: ${missing.join(', ')} (образец — .env.example)`)
    process.exit(1)
  }

  await chatLogin()
  await resolveGroup()

  if (process.argv.includes('--test')) {
    await sendToChat(`✅ Проверка связи: мост учёта УТК подключён (${new Date().toLocaleString('ru-RU')})`)
    log('тестовое сообщение отправлено — проверьте группу в чате')
    return
  }

  const state = loadState()
  if (!state.startedAt) state.startedAt = Date.now()
  saveState(state)
  log(`мост запущен: учёт ${CFG.uchetUrl} → чат ${CFG.chatUrl}, группа «${CFG.groupName}», опрос каждые ${CFG.pollSeconds} с`)

  for (;;) {
    try {
      await pollOnce(state)
    } catch (e) {
      log('ошибка (продолжаю):', e?.message || e)
    }
    await new Promise(r => setTimeout(r, CFG.pollSeconds * 1000))
  }
}

main().catch(e => { console.error('Мост остановлен:', e?.message || e); process.exit(1) })
