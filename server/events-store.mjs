/**
 * Журнал событий events.jsonl: перезапись целиком — удаление по запросу игрока и вычистка старых полей.
 *
 * Запись атомарная: временный файл рядом → fsync → rename. Всё синхронно, поэтому дозапись событий
 * (appendFileSync в server/index.mjs) не вклинится в середину перезаписи: Node работает в одном потоке.
 * Строку, которая не читается как JSON (обрыв записи при падении), не трогаем — её нельзя разобрать.
 */

import { readFileSync, openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'

/** Прочитать файл; нет файла — пустая строка */
function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return ''
    throw err
  }
}

/**
 * Пройти по всем событиям и переписать файл, если что-то изменилось.
 * @param {string} file
 * @param {(event: Record<string, unknown>) => Record<string, unknown> | null} map — событие (можно изменённое) или null, чтобы удалить
 * @returns {{ kept: number, removed: number, changed: number }}
 */
export function rewriteEvents(file, map) {
  const raw = readOrEmpty(file)
  const out = []
  let removed = 0
  let changed = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      out.push(line)
      continue
    }
    const next = map(event)
    if (next === null) {
      removed++
      continue
    }
    const serialized = JSON.stringify(next)
    if (serialized !== line) changed++
    out.push(serialized)
  }
  if (removed === 0 && changed === 0) return { kept: out.length, removed, changed }

  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeSync(fd, out.length ? out.join('\n') + '\n' : '')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, file)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* временного файла уже нет */ }
    throw err
  }
  return { kept: out.length, removed, changed }
}

/**
 * Убрать имена игроков (поле user_name) из записей, сделанных до 14.10.2026.
 * Если имён в файле нет, файл не перезаписывается — повторные запуски сервера его не трогают.
 * @returns {number} сколько записей очищено
 */
export function stripStoredNames(file) {
  if (!readOrEmpty(file).includes('"user_name"')) return 0
  return rewriteEvents(file, (event) => {
    if (!Object.hasOwn(event, 'user_name')) return event
    const { user_name: _dropped, ...rest } = event
    return rest
  }).changed
}
