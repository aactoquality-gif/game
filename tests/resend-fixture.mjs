// Child-process test preload: intercept only the email provider, never other traffic.
const nativeFetch = globalThis.fetch
let nextStatus = 200
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.resend.com/emails') return nativeFetch(url, options)
  const mail = JSON.parse(options.body)
  process.send?.({ type: 'mail', mail })
  return new Response('{}', { status: nextStatus })
}
process.on('message', message => {
  if (message.type === 'resend-status') nextStatus = message.status
})
