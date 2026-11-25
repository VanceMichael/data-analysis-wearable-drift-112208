// 可比性判定：同人同周重叠窗、佩戴覆盖度门槛、桥接读数的适用区间与误差、
// 重复佩戴只计一份活动时间，以及跨周趋势箭头。
import { parseActivity } from './load.js'
import {
  overlapWindow,
  doubleWornBounds,
  combinedValueBounds,
  recordCoverage,
  groupCoverage,
} from './intervals.js'
import { bridgeForUserDevices } from './bridge.js'

/** 按 用户 -> 周 分组活动记录。 */
export function groupByUserWeek(activityRows) {
  const groups = new Map()
  for (const row of activityRows) {
    const rec = parseActivity(row)
    if (!groups.has(rec.user)) groups.set(rec.user, new Map())
    const byWeek = groups.get(rec.user)
    if (!byWeek.has(rec.week)) byWeek.set(rec.week, [])
    byWeek.get(rec.week).push(rec)
  }
  return groups
}

/**
 * 找出同用户同周可对比的重叠区间：不同设备、窗口存在正长度交集。
 * 每一对返回重叠窗与重复佩戴/活动量的可证实范围。
 */
export function overlappingComparisons(records) {
  const comparisons = []
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const a = records[i]
      const b = records[j]
      if (a.device === b.device) continue
      const window = overlapWindow(a, b)
      if (!window) continue
      const worn = doubleWornBounds(a, b)
      const value = combinedValueBounds(a, b)
      comparisons.push({
        left: a.record,
        right: b.record,
        devices: [a.device, b.device],
        firmware: [a.fw, b.fw],
        window,
        doubleWorn: worn.doubleWorn,
        unionWorn: worn.unionWorn,
        // 重叠窗内两份读数不能求和，只能落在 [max, sum] 的可证实范围。
        combinedValue: value,
        note: '重叠时段双设备重复佩戴，活动时间只贡献一份',
      })
    }
  }
  return comparisons
}

/**
 * 把一条旧固件读数按桥接均值偏差换算到新版口径。
 * 适用区间即该记录自身的佩戴窗口；误差限分别针对活动量与佩戴分钟。
 */
export function calibrateOldRecord(record, bridgeInfo) {
  const pointValue = record.value + bridgeInfo.meanValueDelta
  const pointWorn = record.worn + bridgeInfo.meanWornDelta
  return {
    sourceRecord: record.record,
    devicePair: bridgeInfo.device,
    applicableWindow: { start: record.start, end: record.end },
    condition: bridgeInfo.samples[0]?.condition ?? null,
    value: {
      point: pointValue,
      low: pointValue - bridgeInfo.valueErrorLimit,
      high: pointValue + bridgeInfo.valueErrorLimit,
      errorLimit: bridgeInfo.valueErrorLimit,
    },
    worn: {
      point: pointWorn,
      low: pointWorn - bridgeInfo.wornErrorLimit,
      high: pointWorn + bridgeInfo.wornErrorLimit,
      errorLimit: bridgeInfo.wornErrorLimit,
    },
  }
}

/**
 * 评估单个用户单个报告周的可比性。
 * @param bridgeInfo 该用户按全量旧/新设备解析出的设备对桥接结论（跨周确定）
 * @returns 结构化结论：重叠对比、覆盖度、桥接适用情况、实测摘要、是否可出整周趋势
 */
export function assessUserWeek(user, week, records, bridgeInfo) {
  const oldRecords = records.filter((r) => r.fw === 'old')
  const newRecords = records.filter((r) => r.fw === 'new')
  const overlaps = overlappingComparisons(records)

  const oldCoverage = groupCoverage(oldRecords)
  const newCoverage = groupCoverage(newRecords)

  const coverageGate = bridgeInfo
    ? oldCoverage >= bridgeInfo.policy.minCoverage
    : false
  const bridgeUsable = Boolean(bridgeInfo?.usable)
  const bridgeApplicable = bridgeUsable && coverageGate

  const reasons = []
  if (!bridgeInfo) reasons.push('找不到覆盖该设备的桥接策略')
  else if (!bridgeUsable) reasons.push(...bridgeInfo.reasons.map((r) => `桥接失效：${r}`))
  if (bridgeInfo && oldRecords.length > 0 && !coverageGate) {
    reasons.push(
      `旧版佩戴覆盖度 ${oldCoverage.toFixed(3)} 低于门槛 ${bridgeInfo.policy.minCoverage}`,
    )
  }
  if (oldRecords.length && newRecords.length === 0 && !bridgeApplicable) {
    reasons.push('只换固件没有重合参照，且桥接不可用')
  }

  const calibrated = bridgeApplicable
    ? oldRecords.map((r) => calibrateOldRecord(r, bridgeInfo))
    : []

  // 实测摘要：分段列出各设备读数；重叠周给出去重后的可证实合计范围。
  const measured = {
    segments: records.map((r) => ({
      record: r.record,
      device: r.device,
      fw: r.fw,
      window: { start: r.start, end: r.end },
      value: r.value,
      worn: r.worn,
      coverage: recordCoverage(r),
    })),
    overlaps,
  }
  if (overlaps.length) {
    const o = overlaps[0]
    measured.dedupedValue = o.combinedValue
    measured.dedupedWorn = o.unionWorn
  }

  const comparable = bridgeApplicable || overlaps.length > 0
  return {
    user,
    week,
    comparable,
    trendEligible: bridgeApplicable,
    mode: bridgeApplicable ? 'bridged' : overlaps.length ? 'overlap-only' : 'measured-only',
    coverage: { old: oldCoverage, new: newCoverage, gatePassed: coverageGate },
    bridge: bridgeInfo
      ? {
          device: bridgeInfo.device,
          usable: bridgeInfo.usable,
          applicable: bridgeApplicable,
          reasons: bridgeInfo.reasons,
          meanValueDelta: bridgeInfo.meanValueDelta,
          meanWornDelta: bridgeInfo.meanWornDelta,
          valueErrorLimit: bridgeInfo.valueErrorLimit,
          wornErrorLimit: bridgeInfo.wornErrorLimit,
        }
      : null,
    calibrated,
    measured,
    reasons,
  }
}

/** 区间相对基准的箭头：严格高于上界为升、严格低于下界为降，跨区间为未知。 */
function arrowAgainst(value, interval) {
  if (interval === null) return 'unknown'
  if (value > interval.high) return 'up'
  if (value < interval.low) return 'down'
  return 'unknown'
}

/**
 * 跨周趋势：把上周旧口径读数（已桥接）与本周新版读数对比。
 * 趋势箭头保守处理——误差区间跨住新读数时保持未知，同时给出点估计方向。
 */
export function trendBetween(prevAssessment, currAssessment) {
  if (!prevAssessment.trendEligible) {
    return {
      value: 'unknown',
      worn: 'unknown',
      overall: 'unknown',
      reason: '上一周不具备桥接条件，无法形成两周可信趋势',
    }
  }
  const base = prevAssessment.calibrated[0]
  const curr = currAssessment.measured.segments.find((s) => s.fw === 'new')
  if (!curr) {
    return { value: 'unknown', worn: 'unknown', overall: 'unknown', reason: '本周缺少新版读数' }
  }
  const valueArrow = arrowAgainst(curr.value, base.value)
  const wornArrow = arrowAgainst(curr.worn, base.worn)
  const overall = valueArrow
  return {
    value: valueArrow,
    worn: wornArrow,
    overall,
    pointValueDelta: curr.value - base.value.point,
    pointWornDelta: curr.worn - base.worn.point,
    baseRecord: base.sourceRecord,
    currentRecord: curr.record,
    reason:
      overall === 'unknown'
        ? '新读数落在桥接误差区间内，点估计仅供参考，箭头保持未知'
        : '桥接误差区间外形成可信趋势',
  }
}

/** 一次性评估全部用户/周，并按用户串成跨周趋势。 */
export function assessAll(activityRows, bridgeEvaluation) {
  const grouped = groupByUserWeek(activityRows)
  const result = new Map()
  for (const [user, byWeek] of grouped) {
    // 用该用户全部周里出现的旧/新设备共同定位设备对，
    // 避免某一周只有单侧设备时错配桥接结论。
    const allRecords = [...byWeek.values()].flat()
    const oldDevices = [...new Set(allRecords.filter((r) => r.fw === 'old').map((r) => r.device))]
    const newDevices = [...new Set(allRecords.filter((r) => r.fw === 'new').map((r) => r.device))]
    const bridgeInfo = bridgeForUserDevices(bridgeEvaluation, oldDevices, newDevices)

    const weeks = new Map()
    const sortedWeeks = [...byWeek.keys()].sort()
    for (const week of sortedWeeks) {
      weeks.set(week, assessUserWeek(user, week, byWeek.get(week), bridgeInfo))
    }
    const userView = { weeks, trends: new Map() }
    for (let i = 1; i < sortedWeeks.length; i += 1) {
      const prevWeek = sortedWeeks[i - 1]
      const week = sortedWeeks[i]
      userView.trends.set(week, trendBetween(weeks.get(prevWeek), weeks.get(week)))
    }
    result.set(user, userView)
  }
  return result
}
