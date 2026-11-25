import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { runPipeline } from '../src/pipeline.js'
import {
  buildReports,
  comparabilityMatrix,
  deliveryLedger,
  correctionWorklist,
  userView,
} from '../src/reports.js'

const dataDir = resolve(process.cwd(), 'data')

test('端到端日常路径：默认运行到最后一个事件日 105', async () => {
  const result = await runPipeline(dataDir)
  assert.equal(result.day, 105)
  const reports = buildReports(result)
  assert.equal(reports.asOfDay, 105)
  assert.ok(reports.comparability.length >= 6)
  assert.ok(reports.deliveries.length === 5)
})

test('可比性矩阵暴露 U1 桥接失效、U2 覆盖不足、U3 可信', async () => {
  const result = await runPipeline(dataDir, 105)
  const matrix = comparabilityMatrix(result.assessments)
  const cell = (user, week) => matrix.find((r) => r.user === user && r.week === week)

  assert.equal(cell('U1', '12').trendEligible, false)
  assert.equal(cell('U1', '12').bridgeUsable, false)
  assert.ok(cell('U1', '12').overlapWindows[0].window.length === 25)

  assert.equal(cell('U2', '12').trendEligible, false)
  assert.equal(cell('U2', '12').coverageGatePassed, false)

  assert.equal(cell('U3', '12').trendEligible, true)
  assert.equal(cell('U3', '13').trendEligible, false) // 第13周本身是新版，基线在第12周
})

test('交付台账区分 待发/已送/未知 且记录真实动作', async () => {
  const result = await runPipeline(dataDir, 105)
  const ledger = deliveryLedger(result.delivery)
  const row = (id) => ledger.find((r) => r.delivery === id)
  assert.equal(row('M3').recordedStatus, '未知')
  assert.equal(row('M3').effectiveStatus, '已送')
  assert.equal(row('M4').action, '抑制')
  assert.equal(row('M5').action, '发送')
  assert.equal(row('M5').actionKind, '实测')
})

test('更正工作清单只包含真正发出且失去支持的 M1', async () => {
  const result = await runPipeline(dataDir, 105)
  const worklist = correctionWorklist(result.delivery)
  assert.deepEqual(
    worklist.map((w) => w.targetDelivery),
    ['M1'],
  )
  assert.equal(worklist[0].deadline, 113)
})

test('用户视图：U3 看到两周可信趋势，U1/U2 看到分段实测与覆盖差异', async () => {
  const result = await runPipeline(dataDir, 105)
  const u3 = userView(result.assessments, 'U3')
  assert.equal(u3.reportType, '两周可信趋势')
  const u3trend = u3.trends.find((t) => t.week === '13')
  assert.equal(u3trend.overall, 'up')

  const u1 = userView(result.assessments, 'U1')
  assert.equal(u1.reportType, '分段实测（趋势未知）')
  assert.ok(u1.segments.some((s) => s.deduped !== null))

  const u2 = userView(result.assessments, 'U2')
  assert.equal(u2.reportType, '分段实测（趋势未知）')
})

test('未发送周报可随证据变化重新判断：day103 可发、day104 抑制', async () => {
  const before = await runPipeline(dataDir, 103)
  const after = await runPipeline(dataDir, 104)
  const m4before = before.delivery.decisions.find((d) => d.delivery === 'M4')
  const m4after = after.delivery.decisions.find((d) => d.delivery === 'M4')
  // day103 尚未到期（M4 at=104），无动作
  assert.equal(m4before.action, null)
  assert.equal(m4after.action, '抑制')
  assert.equal(m4after.reevaluable, true)
})
