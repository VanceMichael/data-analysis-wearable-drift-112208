import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  effectiveSubscriptionAt,
  isCancelledAt,
  correctionWindow,
} from '../src/subscriptions.js'

const dataDir = new URL('../data/', import.meta.url)
const subscriptionRows = JSON.parse(
  await readFile(new URL('subscriptions.json', dataDir), 'utf8'),
)

test('U1 在 day103 仍是整周订阅，day104 起为停订', () => {
  assert.equal(effectiveSubscriptionAt(subscriptionRows, 'U1', 103).mode, '整周')
  assert.equal(effectiveSubscriptionAt(subscriptionRows, 'U1', 104).mode, '停订')
  assert.equal(isCancelledAt(subscriptionRows, 'U1', 103), false)
  assert.equal(isCancelledAt(subscriptionRows, 'U1', 104), true)
})

test('U2 为分段订阅且纠正窗口为 0 天', () => {
  assert.equal(effectiveSubscriptionAt(subscriptionRows, 'U2', 105).mode, '分段')
})

test('纠正窗口按交付当时订阅的 correction_days 计算', () => {
  // M1 在 day98 交付，当时 U1 订阅 correction_days=15 => 截止 113
  const m1 = { user: 'U1', at: 98 }
  const at105 = correctionWindow(subscriptionRows, m1, 105)
  assert.equal(at105.open, true)
  assert.equal(at105.deadline, 113)
  assert.equal(at105.daysLeft, 8)
  const at114 = correctionWindow(subscriptionRows, m1, 114)
  assert.equal(at114.open, false)

  // U2 correction_days=0：交付当天之后窗口即关闭
  const m2 = { user: 'U2', at: 98 }
  assert.equal(correctionWindow(subscriptionRows, m2, 98).open, true)
  assert.equal(correctionWindow(subscriptionRows, m2, 99).open, false)
})

test('停订不影响已交付内容的纠正窗口（历史错误摘要仍可单独解释）', () => {
  const m1 = { user: 'U1', at: 98 }
  const window = correctionWindow(subscriptionRows, m1, 104)
  assert.equal(window.open, true)
  assert.equal(window.deadline, 113)
})
