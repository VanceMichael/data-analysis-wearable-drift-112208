import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { evaluateBridges } from '../src/bridge.js'
import { assessAll, trendBetween } from '../src/comparability.js'

const dataDir = new URL('../data/', import.meta.url)
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, dataDir), 'utf8'))
const [activityRows, bridgeRows, policyRows, evidenceRows, eventRows] = await Promise.all(
  ['activities', 'bridge', 'policies', 'evidence', 'events'].map((n) => read(n)),
)

const eval103 = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, 103)
const eval104 = evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, 104)

test('U1 第12周：同人重叠窗可识别，重复佩戴只计一份并给出可证实范围', () => {
  const all = assessAll(activityRows, eval103)
  const week12 = all.get('U1').weeks.get('12')
  assert.equal(week12.comparable, true)
  const overlap = week12.measured.overlaps[0]
  assert.deepEqual(overlap.window, { start: 25, end: 50, length: 25 })
  assert.deepEqual(overlap.devices, ['D1', 'D2'])
  assert.deepEqual(overlap.doubleWorn, { low: 20, high: 25 })
  assert.deepEqual(overlap.combinedValue, { low: 110, high: 210 })
})

test('U1：桥接成立时旧读数换算到新口径，并标注适用窗口与双误差限', () => {
  const all = assessAll(activityRows, eval103)
  const week12 = all.get('U1').weeks.get('12')
  assert.equal(week12.trendEligible, true)
  const cal = week12.calibrated[0]
  assert.equal(cal.sourceRecord, 'R1')
  assert.deepEqual(cal.applicableWindow, { start: 0, end: 50 })
  // 110 + 8.5 = 118.5，活动量误差限 9
  assert.equal(cal.value.point, 118.5)
  assert.equal(cal.value.errorLimit, 9)
  assert.deepEqual([cal.value.low, cal.value.high], [109.5, 127.5])
  // 45 + 1 = 46，佩戴误差限 1
  assert.equal(cal.worn.point, 46)
  assert.deepEqual([cal.worn.low, cal.worn.high], [45, 47])
})

test('U1：day104 桥接失效后趋势资格消失，箭头只能未知', () => {
  const all = assessAll(activityRows, eval104)
  const week12 = all.get('U1').weeks.get('12')
  assert.equal(week12.trendEligible, false)
  assert.ok(week12.reasons.some((r) => r.includes('桥接失效')))
  const trend = all.get('U1').trends.get('13')
  assert.equal(trend.overall, 'unknown')
})

test('U2：旧版佩戴覆盖不足，即便设备对桥接成立也不可用，只给分段实测', () => {
  const all = assessAll(activityRows, eval103)
  const week12 = all.get('U2').weeks.get('12')
  assert.equal(week12.trendEligible, false)
  assert.equal(week12.coverage.gatePassed, false)
  assert.ok(week12.coverage.old < 0.65)
  assert.ok(week12.reasons.some((r) => r.includes('覆盖度')))
  // 实测分段仍然保留
  assert.equal(week12.measured.segments.length, 1)
  assert.equal(week12.measured.segments[0].record, 'R4')
  const trend = all.get('U2').trends.get('13')
  assert.equal(trend.overall, 'unknown')
})

test('U3：无同周重叠但桥接可用且覆盖达标，形成两周可信趋势', () => {
  const all = assessAll(activityRows, eval103)
  const week12 = all.get('U3').weeks.get('12')
  assert.equal(week12.trendEligible, true)
  assert.equal(week12.measured.overlaps.length, 0)
  const cal = week12.calibrated[0]
  // 240 - 2 = 238，误差限 7 => [231,245]；本周 270 高于上界 => 上升
  assert.equal(cal.value.point, 238)
  assert.deepEqual([cal.value.low, cal.value.high], [231, 245])
  const trend = all.get('U3').trends.get('13')
  assert.equal(trend.value, 'up')
  assert.equal(trend.overall, 'up')
  // 佩戴：60 - 1.5 = 58.5，误差限 4 => [54.5,62.5]；本周 60 落在区间内 => 未知
  assert.equal(trend.worn, 'unknown')
})

test('误差区间跨住新读数时活动量箭头也保持未知（不拿人口均值硬纠边界用户）', () => {
  // 构造：桥接后区间 [100,120]，新读数 110 落在区间内
  const prev = {
    trendEligible: true,
    calibrated: [
      {
        sourceRecord: 'X',
        value: { point: 110, low: 100, high: 120 },
        worn: { point: 50, low: 48, high: 52 },
      },
    ],
  }
  const curr = {
    measured: { segments: [{ fw: 'new', record: 'Y', value: 110, worn: 60 }] },
  }
  const t = trendBetween(prev, curr)
  assert.equal(t.value, 'unknown')
  assert.equal(t.worn, 'up')
  assert.equal(t.overall, 'unknown')
})
