import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  revisionAvailability,
  visibleRevision,
  activePairsAt,
  evaluateBridges,
  bridgeForDevice,
} from '../src/bridge.js'

const dataDir = new URL('../data/', import.meta.url)
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, dataDir), 'utf8'))
const bridgeRows = await read('bridge')
const policyRows = await read('policies')
const evidenceRows = await read('evidence')
const eventRows = await read('events')

test('P2 的撤回修订经 day104 补录才可见，此前 rev1 有效', () => {
  const availability = revisionAvailability(bridgeRows, evidenceRows, eventRows)
  assert.equal(availability.get('P2').get(1), 90)
  assert.equal(availability.get('P2').get(2), 104)

  const before = visibleRevision(bridgeRows, availability, 'P2', 103)
  assert.equal(before.revision, 1)
  assert.equal(before.state, '有效')

  const after = visibleRevision(bridgeRows, availability, 'P2', 104)
  assert.equal(after.revision, 2)
  assert.equal(after.state, '撤回')
})

test('day103：D1+D2 两对都有效，桥接成立且误差限分别计量', () => {
  const eval103 = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, 103)
  const d12 = eval103.byDevice.get('D1+D2')
  assert.equal(d12.usable, true)
  assert.equal(d12.pairCount, 2)
  // P1: 活动量差 9、佩戴差 1；P2: 活动量差 8、佩戴差 1
  assert.equal(d12.valueErrorLimit, 9)
  assert.equal(d12.wornErrorLimit, 1)
  assert.equal(d12.meanValueDelta, 8.5)
  assert.equal(d12.meanWornDelta, 1)
})

test('day104 补录后：D1+D2 有效配对只剩 P1，低于 min_pairs 而失效', () => {
  const active = activePairsAt(
    bridgeRows,
    revisionAvailability(bridgeRows, evidenceRows, eventRows),
    104,
  )
  assert.ok(active.has('P1'))
  assert.ok(!active.has('P2'))

  const eval104 = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, 104)
  const d12 = eval104.byDevice.get('D1+D2')
  assert.equal(d12.usable, false)
  assert.ok(d12.reasons.some((r) => r.includes('有效配对 1 < 最少 2')))
})

test('D1+D3 两个配对始终满足策略门槛，桥接一直成立', () => {
  for (const day of [103, 104, 105]) {
    const info = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, day).byDevice.get(
      'D1+D3',
    )
    assert.equal(info.usable, true, `day ${day}`)
    assert.equal(info.pairCount, 2)
    // P3: |72-79|=7 佩戴 |42-46|=4；P4: |128-125|=3 佩戴 1
    assert.equal(info.valueErrorLimit, 7)
    assert.equal(info.wornErrorLimit, 4)
    assert.equal(info.meanValueDelta, -2)
    assert.equal(info.meanWornDelta, -1.5)
    assert.ok(info.valueErrorLimit <= info.policy.maxValueError)
    assert.ok(info.wornErrorLimit <= info.policy.maxWornError)
  }
})

test('按具体设备找到对应设备对评估', () => {
  const eval104 = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, 104)
  assert.equal(bridgeForDevice(eval104, 'D1').device, 'D1+D2')
  assert.equal(bridgeForDevice(eval104, 'D3').device, 'D1+D3')
})
