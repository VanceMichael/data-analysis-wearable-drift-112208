// 来源资料读取与基础解析。
// 约定（见 README）：原始记录里数字、日期、标记都以字符串保存；
// "?" 表示来源未能提供该值；"+" 分隔组合编号。
import { readFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'

export const TABLES = [
  'activities',
  'bridge',
  'subscriptions',
  'outbox',
  'events',
  'policies',
  'calendar',
  'evidence',
]

const MISSING = '?'

/** 把字符串字段解析成数字；"?" 与空串解析为 null。 */
export function num(value) {
  if (value === undefined || value === null || value === MISSING || value === '') return null
  const n = Number(value)
  if (Number.isNaN(n)) throw new Error(`无法把原始值解析为数字: ${JSON.stringify(value)}`)
  return n
}

/** 拆分组合编号，例如 "D1+D2" -> ["D1", "D2"]。 */
export function splitPair(value) {
  return value.split('+').map((part) => part.trim())
}

/** 读取全部来源表，保留原始字符串行（不做就地改写）。 */
export async function loadAll(dataDir) {
  const dir = dataDir.replace(/[/\\]+$/, '')
  const data = {}
  for (const name of TABLES) {
    const file = new URL(`${dir}/${name}.json`, 'file://')
    await access(file)
    data[name] = JSON.parse(await readFile(file, 'utf8'))
  }
  return data
}

/** 活动记录解析后的结构化视图。 */
export function parseActivity(row) {
  return {
    record: row.record,
    user: row.user,
    device: row.device,
    fw: row.fw,
    week: row.week,
    start: num(row.start),
    end: num(row.end),
    value: num(row.value),
    worn: num(row.worn),
    raw: row,
  }
}

/** 桥接试行记录解析视图。 */
export function parseBridge(row) {
  return {
    pair: row.pair,
    device: row.device,
    devices: splitPair(row.device),
    old: num(row.old),
    new: num(row.new),
    wornOld: num(row.worn_old),
    wornNew: num(row.worn_new),
    condition: row.condition,
    revision: num(row.revision),
    state: row.state,
    raw: row,
  }
}

export function parsePolicy(row) {
  return {
    device: row.device,
    devices: splitPair(row.device),
    minPairs: num(row.min_pairs),
    minCoverage: num(row.min_coverage),
    maxValueError: num(row.max_value_error),
    maxWornError: num(row.max_worn_error),
    raw: row,
  }
}

export function parseSubscription(row) {
  return {
    user: row.user,
    mode: row.mode,
    effective: num(row.effective),
    correctionDays: num(row.correction_days),
    raw: row,
  }
}

export function parseOutbox(row) {
  return {
    delivery: row.delivery,
    user: row.user,
    week: row.week,
    kind: row.kind,
    version: num(row.version),
    at: num(row.at),
    status: row.status,
    raw: row,
  }
}

export function parseEvent(row) {
  return { at: num(row.at), event: row.event, ref: row.ref, raw: row }
}

export function parseCalendar(row) {
  return {
    week: row.week,
    startDay: num(row.start_day),
    endDay: num(row.end_day),
    raw: row,
  }
}

export function parseEvidence(row) {
  return {
    bridge: row.bridge,
    predecessor: row.predecessor === MISSING ? null : row.predecessor,
    firmwareFrom: row.firmware_from,
    firmwareTo: row.firmware_to,
    releasedDay: num(row.released_day),
    raw: row,
  }
}
