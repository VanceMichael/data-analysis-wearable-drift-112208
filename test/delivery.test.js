import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { evaluateBridges } from '../src/bridge.js'
import { assessAll } from '../src/comparability.js'
import { orderedEvents, runDay } from '../src/delivery.js'

const dataDir = new URL('../data/', import.meta.url)
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, dataDir), 'utf8'))
const [activityRows, bridgeRows, policyRows, evidenceRows, eventRows, subscriptionRows, outboxRows] =
  await Promise.all(
    ['activities', 'bridge', 'policies', 'evidence', 'events', 'subscriptions', 'outbox'].map(
      (n) => read(n),
    ),
  )

const assessmentAt = (day) =>
  assessAll(
    activityRows,
    evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, day),
  )

const byId = (result, id) => result.decisions.find((d) => d.delivery === id)

test('同一天事件按 补录 -> 停订 -> 到期 -> 回单 排序', () => {
  const day104 = orderedEvents(eventRows).filter((e) => e.at === 104)
  assert.deepEqual(
    day104.map((e) => e.event),
    ['补录', '停订', '到期'],
  )
  const day105 = orderedEvents(eventRows).filter((e) => e.at === 105)
  assert.equal(day105[0].event, '送达回单')
})

test('day103：M1 已送趋势、M2 已送实测；M3 结果未知且不得重发', () => {
  const result = runDay({
    day: 103,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(103),
  })
  const m3 = byId(result, 'M3')
  assert.equal(m3.recordedStatus, '未知')
  assert.equal(m3.effectiveStatus, '未知')
  assert.equal(m3.action, null) // 未知状态不触发任何发送
})

test('day104：补录先于到期——M4 在完整证据下被抑制且保留复判资格', () => {
  const result = runDay({
    day: 104,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(104),
  })
  const m4 = byId(result, 'M4')
  assert.equal(m4.recordedStatus, '待发')
  assert.equal(m4.reevaluable, true)
  assert.equal(m4.action, '抑制')
  assert.ok(m4.reasons.some((r) => r.includes('整周订阅只收可比趋势')))
  // 停订同时生效，理由中也应可见
  assert.ok(m4.reasons.some((r) => r.includes('桥接') || r.includes('订阅')))
})

test('day104：M1 已发趋势失去证据支持，进入纠正清单（窗口内）', () => {
  const result = runDay({
    day: 104,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(104),
  })
  const m1 = byId(result, 'M1')
  assert.equal(m1.effectiveStatus, '已送')
  assert.equal(m1.correction.kind, '更正')
  assert.ok(m1.correction.explanation.includes('M1'))
  assert.equal(m1.correction.deadline, 113)
  assert.deepEqual(
    result.corrections.map((c) => c.delivery),
    ['M1'],
  )
})

test('day105：M3 回单到达后由未知转已送；M5 分段实测照常发送', () => {
  const result = runDay({
    day: 105,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(105),
  })
  const m3 = byId(result, 'M3')
  assert.equal(m3.effectiveStatus, '已送')
  assert.equal(m3.receiptArrived, true)
  assert.equal(m3.action, null) // 回单只回填状态，不重发

  const m5 = byId(result, 'M5')
  assert.equal(m5.action, '发送')
  assert.equal(m5.actionKind, '实测')
})

test('day105：U1 已停订，不再产生任何新的常规周报发送', () => {
  const result = runDay({
    day: 105,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(105),
  })
  const u1Sends = result.sent.filter((d) => d.user === 'U1')
  assert.equal(u1Sends.length, 0)
})

test('U2 的已发实测 M2 永不需要更正（实测不依赖桥接）', () => {
  const result = runDay({
    day: 105,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(105),
  })
  const m2 = byId(result, 'M2')
  assert.equal(m2.correction, null)
})

test('同一输入重复运行结论一致（幂等，不会重复发错版本）', () => {
  const opts = {
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(105),
  }
  const first = runDay({ day: 105, ...opts })
  const second = runDay({ day: 105, ...opts })
  assert.deepEqual(
    first.decisions.map((d) => [d.delivery, d.effectiveStatus, d.action, d.correction?.kind ?? null]),
    second.decisions.map((d) => [d.delivery, d.effectiveStatus, d.action, d.correction?.kind ?? null]),
  )
})

test('纠正窗口关闭后只登记逾期，不再出具更正', () => {
  const result = runDay({
    day: 114,
    outboxRows,
    eventRows,
    subscriptionRows,
    assessments: assessmentAt(114),
  })
  const m1 = byId(result, 'M1')
  assert.equal(m1.correction.kind, '逾期')
  assert.equal(result.corrections.length, 0)
})
