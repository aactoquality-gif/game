/**
 * Вебхук бота: POST /api/telegram/webhook
 *
 * Подлинность: Telegram присылает заголовок X-Telegram-Bot-Api-Secret-Token — тот же secret_token, что задан
 * в setWebhook (переменная BOT_WEBHOOK_SECRET). Без неё вебхук выключен.
 * https://core.telegram.org/bots/api#setwebhook
 *
 * Ответ боту — прямо в теле ответа на вебхук (метод sendMessage), без исходящих запросов к api.telegram.org.
 * https://core.telegram.org/bots/api#making-requests-when-getting-updates
 *
 * Персональные данные: апдейт целиком не логируется и не сохраняется. В журнал — только ID и тип события.
 *
 * Команды (только в личном чате с ботом):
 *   /deletedata          — что удалится и чем это грозит; ссылка на подтверждение
 *   /deletedata_confirm  — удалить всё, что сервер хранит по Telegram ID игрока
 */

import { timingSafeEqual } from 'node:crypto'
import { deleteUserEvents } from './events-store.mjs'

/** Формат secret_token по документации Telegram: 1–256 символов A-Z, a-z, 0-9, _ и - */
const SECRET_FORMAT = /^[A-Za-z0-9_-]{1,256}$/

/** Команда в начале сообщения: /cmd или /cmd@имя_бота, дальше — пробел или конец */
function command(text) {
  const m = /^\/([a-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.exec(typeof text === 'string' ? text : '')
  return m ? m[1] : null
}

const TEXT = {
  warning: [
    'Удалить твои данные с сервера игры?',
    '',
    'Удалится всё, что связано с твоим Telegram ID: статистика чтения и записи о покупках. ' +
      'Купленное станет недоступно, вернуть его не получится.',
    '',
    'Прогресс чтения хранится в Telegram и на устройстве, его это не затронет.',
    '',
    'Чтобы удалить, отправь /deletedata_confirm',
  ].join('\n'),
  done: (n) => [
    `Готово. С сервера удалено записей: ${n}.`,
    '',
    'Если снова откроешь игру, она опять начнёт записывать статистику по твоему ID.',
  ].join('\n'),
  empty: 'На сервере нет данных, связанных с твоим Telegram ID.',
  failed: 'Не удалось удалить данные. Попробуй ещё раз позже.',
}

/**
 * @param {{ secret?: string, eventsFile: string }} opts
 */
export function createBotWebhook({ secret = '', eventsFile }) {
  const enabled = SECRET_FORMAT.test(secret)

  /** Запрос пришёл от Telegram: заголовок совпадает с секретом */
  function authorized(req) {
    const got = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''))
    const want = Buffer.from(secret)
    return enabled && got.length === want.length && timingSafeEqual(got, want)
  }

  function reply(res, chatId, text) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ method: 'sendMessage', chat_id: chatId, text }))
  }

  function ignore(res) {
    res.writeHead(200, { 'Cache-Control': 'no-store' })
    res.end()
  }

  /**
   * Обработать апдейт. Telegram ждёт 200 на любой апдейт, иначе будет присылать его снова.
   * @param {import('node:http').ServerResponse} res
   * @param {any} update
   */
  function handle(res, update) {
    const message = update?.message
    const userId = message?.from?.id
    const chatId = message?.chat?.id
    if (message?.chat?.type !== 'private' || !Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(chatId)) {
      return ignore(res)
    }

    const cmd = command(message.text)
    if (cmd === 'deletedata') {
      console.log(`[bot] deletedata_request user=${userId}`)
      return reply(res, chatId, TEXT.warning)
    }
    if (cmd === 'deletedata_confirm') {
      let removed
      try {
        removed = deleteUserEvents(eventsFile, userId)
      } catch (err) {
        console.error(`[bot] deletedata_failed user=${userId}: ${err.code || err.message}`)
        return reply(res, chatId, TEXT.failed)
      }
      console.log(`[bot] deletedata_done user=${userId} removed=${removed}`)
      return reply(res, chatId, removed ? TEXT.done(removed) : TEXT.empty)
    }
    return ignore(res)
  }

  return { enabled, authorized, handle }
}
