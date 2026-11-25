import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  overlapLength,
  unionLength,
  overlapWindow,
  doubleWornBounds,
  combinedValueBounds,
  recordCoverage,
  groupCoverage,
} from '../src/intervals.js'

test('半开区间交集与并集长度', () => {
  assert.equal(overlapLength(0, 50, 25, 60), 25)
  assert.equal(unionLength(0, 50, 25, 60), 60)
  assert.equal(overlapLength(0, 10, 20, 30), 0)
})

test('重叠窗定位到具体分钟段', () => {
  const a = { start: 0, end: 50 }
  const b = { start: 25, end: 60 }
  assert.deepEqual(overlapWindow(a, b), { start: 25, end: 50, length: 25 })
  assert.equal(overlapWindow({ start: 0, end: 10 }, { start: 20, end: 30 }), null)
})

test('U1 第12周重复佩戴给出可证实范围而非臆造明细', () => {
  // R1: 窗口 [0,50) 佩戴45；R2: 窗口 [25,60) 佩戴35；窗口交集25、并集60
  const r1 = { start: 0, end: 50, worn: 45, value: 110 }
  const r2 = { start: 25, end: 60, worn: 35, value: 100 }
  const bounds = doubleWornBounds(r1, r2)
  assert.equal(bounds.overlapSpan, 25)
  assert.equal(bounds.unionSpan, 60)
  // 重复佩戴 x: 下界 45+35-60=20，上界 min(45,35,25)=25
  assert.deepEqual(bounds.doubleWorn, { low: 20, high: 25 })
  // 并集佩戴 80-x => [55,60]
  assert.deepEqual(bounds.unionWorn, { low: 55, high: 60 })
})

test('重叠窗活动量只能贡献一份：范围 [max, sum]', () => {
  assert.deepEqual(combinedValueBounds({ value: 110 }, { value: 100 }), { low: 110, high: 210 })
})

test('覆盖度：单记录与分组保守下界', () => {
  assert.equal(recordCoverage({ start: 0, end: 55, worn: 18 }), 18 / 55)
  // U2 旧侧单记录 18/55 ≈ 0.327，低于 D1+D3 门槛 0.65
  assert.ok(recordCoverage({ start: 0, end: 55, worn: 18 }) < 0.65)
  const grouped = groupCoverage([
    { start: 0, end: 50, worn: 45 },
    { start: 25, end: 60, worn: 35 },
  ])
  // 并集窗口60，佩戴并集下界55 => 55/60
  assert.equal(Math.round(grouped * 1000), Math.round((55 / 60) * 1000))
})
