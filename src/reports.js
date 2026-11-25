// 报告视图：产品组按用户/报告周查看可比性、真正发送过的内容、待处理更正；
// 用户查看自己拿到的是两周可信趋势还是只覆盖部分周。
// 所有视图都由同一条日常路径的结果派生，不需要手工重跑对照表。

/** 产品组：用户 × 报告周可比性矩阵。 */
export function comparabilityMatrix(assessments) {
  const rows = []
  for (const [user, view] of assessments) {
    for (const [week, a] of [...view.weeks.entries()].sort()) {
      rows.push({
        user,
        week,
        comparable: a.comparable,
        trendEligible: a.trendEligible,
        basis: a.mode,
        oldCoverage: round(a.coverage.old),
        newCoverage: round(a.coverage.new),
        coverageGatePassed: a.coverage.gatePassed,
        bridgeDevice: a.bridge?.device ?? null,
        bridgeUsable: a.bridge?.usable ?? false,
        valueErrorLimit: a.bridge?.valueErrorLimit ?? null,
        wornErrorLimit: a.bridge?.wornErrorLimit ?? null,
        overlapWindows: a.measured.overlaps.map((o) => ({
          records: [o.left, o.right],
          window: o.window,
          doubleWorn: o.doubleWorn,
          combinedValue: o.combinedValue,
        })),
        reasons: a.reasons,
      })
    }
  }
  return rows
}

/** 产品组：交付台账，区分尚未送 / 已送 / 结果未知 / 被抑制。 */
export function deliveryLedger(delivery) {
  return delivery.decisions.map((d) => ({
    delivery: d.delivery,
    user: d.user,
    week: d.week,
    requestedKind: d.requestedKind,
    version: d.version,
    recordedStatus: d.recordedStatus,
    effectiveStatus: d.effectiveStatus,
    action: d.action,
    actionKind: d.actionKind,
    mode: d.mode,
    reevaluable: d.reevaluable,
    correctionWindow: d.correctionWindow
      ? {
          open: d.correctionWindow.open,
          deadline: d.correctionWindow.deadline,
          daysLeft: d.correctionWindow.daysLeft,
        }
      : null,
    reasons: d.reasons,
  }))
}

/** 产品组：当前仍需处理的更正清单（按真正发出过的内容判断）。 */
export function correctionWorklist(delivery) {
  return delivery.corrections.map((d) => ({
    user: d.user,
    week: d.week,
    targetDelivery: d.delivery,
    ...d.correction,
  }))
}

/**
 * 用户视图：说明拿到的是「两周可信趋势」还是「只覆盖一部分」。
 * - bridged 且跨周趋势箭头非 unknown => 两周可信趋势；
 * - 否则给出分段实测摘要与覆盖差异，趋势箭头未知。
 */
export function userView(assessments, user) {
  const view = assessments.get(user)
  if (!view) return null
  const weeks = [...view.weeks.keys()].sort()
  const trendWeeks = [...view.trends.entries()]
  const anyTrustedTrend = trendWeeks.some(([, t]) => t.overall !== 'unknown')
  const segments = []
  for (const week of weeks) {
    const a = view.weeks.get(week)
    segments.push({
      week,
      trendEligible: a.trendEligible,
      basis: a.mode,
      coverage: { old: round(a.coverage.old), new: round(a.coverage.new) },
      measured: a.measured.segments,
      deduped: a.measured.overlaps.length
        ? {
            value: a.measured.dedupedValue,
            worn: a.measured.dedupedWorn,
            windows: a.measured.overlaps.map((o) => o.window),
          }
        : null,
    })
  }
  return {
    user,
    reportType: anyTrustedTrend ? '两周可信趋势' : '分段实测（趋势未知）',
    weeks,
    trends: trendWeeks.map(([week, t]) => ({ week, ...t })),
    segments,
    note: anyTrustedTrend
      ? '相邻两周经桥接换算后误差区间外形成可信趋势'
      : '仅覆盖部分可比区间或桥接失效/覆盖不足，按分段实测呈现，箭头保持未知',
  }
}

/** 汇总整套报告对象。 */
export function buildReports(result, userId) {
  const reports = {
    asOfDay: result.day,
    bridge: [...result.bridgeEvaluation.byDevice.values()].map((b) => ({
      device: b.device,
      usable: b.usable,
      pairCount: b.pairCount,
      meanValueDelta: b.meanValueDelta,
      meanWornDelta: b.meanWornDelta,
      valueErrorLimit: b.valueErrorLimit,
      wornErrorLimit: b.wornErrorLimit,
      reasons: b.reasons,
    })),
    comparability: comparabilityMatrix(result.assessments),
    deliveries: deliveryLedger(result.delivery),
    corrections: correctionWorklist(result.delivery),
  }
  if (userId) reports.user = userView(result.assessments, userId)
  return reports
}

function round(n) {
  return n === null || n === undefined ? null : Math.round(n * 1000) / 1000
}
