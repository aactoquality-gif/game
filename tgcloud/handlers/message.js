/**
 * Обработчик входящих сообщений бота @crowd_objektivka_bot
 *
 * Реагирует только на /start — отправляет приветствие с кнопкой «Играть»,
 * которая открывает Mini App. Остальные сообщения игнорирует.
 *
 * Кнопка использует web_app — Mini App URL берётся из BotFather → Configure Mini App.
 * После первого `tgcloud push` URL будет https://app<ID>.tgcloud.ai/
 */

// TODO: заменить на реальный URL после первого tgcloud push
const MINI_APP_URL = 'https://t.me/crowd_objektivka_bot/app'

export default async function onMessage(ctx) {
  const text = ctx.message?.text
  if (!text || !text.startsWith('/start')) return

  const lang = ctx.message.from?.language_code ?? 'ru'

  const greeting = {
    ru: 'Добро пожаловать в «Личные дела» — интерактивные истории, где выбираешь ты.',
    en: 'Welcome to "Personal Files" — interactive stories where you make the choices.',
    es: 'Bienvenido a "Expedientes personales" — historias interactivas donde tú decides.',
  }

  const buttonText = { ru: 'Играть', en: 'Play', es: 'Jugar' }

  const msg = greeting[lang] || greeting.ru
  const btn = buttonText[lang] || buttonText.ru

  await ctx.reply(msg, {
    reply_markup: {
      inline_keyboard: [[
        { text: btn, web_app: { url: MINI_APP_URL } }
      ]]
    }
  })
}
