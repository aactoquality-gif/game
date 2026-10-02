import { statsAuthenticate, statsSessionAvailable, type StatsAuthRequest } from './api'
import { tg } from './telegram'
import { t } from './i18n'
import './stats-login.css'

const root = document.querySelector<HTMLElement>('#stats-login')!
const title = document.createElement('h1')
title.textContent = t('stats.title')
const form = document.createElement('form')
const verifyForm = document.createElement('form')
const emailLabel = document.createElement('label')
emailLabel.textContent = t('stats.email')
const email = document.createElement('input')
email.type = 'email'; email.name = 'email'; email.required = true; email.autocomplete = 'email'; email.maxLength = 254
emailLabel.append(email)
const send = document.createElement('button')
send.type = 'submit'; send.textContent = t('stats.send')
const codeLabel = document.createElement('label')
codeLabel.textContent = t('stats.code')
const code = document.createElement('input')
code.required = true; code.name = 'code'; code.inputMode = 'numeric'; code.autocomplete = 'one-time-code'; code.pattern = '[0-9]{6}'; code.maxLength = 6
codeLabel.append(code)
const verify = document.createElement('button')
verify.type = 'submit'; verify.textContent = t('stats.verify')
const status = document.createElement('p')
status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
const external = document.createElement('a')
external.href = `${location.origin}/api/stats`; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.textContent = t('stats.external')
const hint = document.createElement('p')
hint.textContent = t('stats.externalHint')
form.append(emailLabel, send)
verifyForm.append(codeLabel, verify)
root.append(title, form, verifyForm, status)

// Keep only report filters. No credentials, arbitrary return URLs, or fragments survive navigation.
const target = new URL('/api/stats', location.origin)
const current = new URL(location.href)
for (const key of ['story', 'episode', 'from', 'exclude']) {
  const value = current.searchParams.get(key)
  if (value !== null) target.searchParams.set(key, value)
}
history.replaceState(null, '', target.pathname + target.search)

let busy = false
async function submit(request: StatsAuthRequest): Promise<void> {
  if (busy) return
  busy = true; send.disabled = true; verify.disabled = true; email.disabled = true; code.disabled = true
  status.textContent = t('stats.busy')
  try {
    const result = await statsAuthenticate(request)
    if (!result.ok) {
      status.textContent = result.status === 429 ? t('stats.rate', { seconds: result.retryAfter }) : t(result.status >= 500 ? 'stats.error' : 'stats.denied')
    } else if (request.action === 'email/request') {
      status.textContent = t('stats.sent')
    } else if (await statsSessionAvailable()) {
      location.replace(target.href)
    } else {
      status.textContent = t('stats.cookie')
      root.append(external, hint)
    }
  } catch { status.textContent = t('stats.error') }
  finally {
    busy = false; send.disabled = false; verify.disabled = false; email.disabled = false; code.disabled = false
  }
}
form.addEventListener('submit', event => {
  event.preventDefault()
  if (email.reportValidity()) void submit({ action: 'email/request', body: { email: email.value } })
})
verifyForm.addEventListener('submit', event => {
  event.preventDefault()
  if (email.reportValidity() && code.reportValidity()) void submit({ action: 'email/verify', body: { email: email.value, code: code.value } })
})
if (tg?.initData) void submit({ action: 'telegram', body: { initData: tg.initData } })
