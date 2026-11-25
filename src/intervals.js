// 分钟区间运算与可证实范围（provable bounds）。
// 活动的分钟区间只在所属周里相对比较；原始汇总未精细到每分钟时，
// 允许以能证实的范围表达（见 README），不臆造分钟级明细。

/** 两个半开区间 [start, end) 的交集长度，无交集时为 0。 */
export function overlapLength(aStart, aEnd, bStart, bEnd) {
  const lo = Math.max(aStart, bStart)
  const hi = Math.min(aEnd, bEnd)
  return Math.max(0, hi - lo)
}

/** 两个半开区间并集长度。 */
export function unionLength(aStart, aEnd, bStart, bEnd) {
  const spanA = aEnd - aStart
  const spanB = bEnd - bStart
  return spanA + spanB - overlapLength(aStart, aEnd, bStart, bEnd)
}

/**
 * 两条佩戴区间的重叠描述。
 * @returns {{start:number,end:number,length:number}|null} 无正长度交集时为 null
 */
export function overlapWindow(a, b) {
  const start = Math.max(a.start, b.start)
  const end = Math.min(a.end, b.end)
  if (end <= start) return null
  return { start, end, length: end - start }
}

/**
 * 同一用户、同一周两条设备记录的重复佩戴可证实范围。
 * 已知：各自窗口、各自佩戴分钟、窗口交集长度，但不知道佩戴落在窗口内的具体分钟。
 * 重复佩戴分钟 x 满足：
 *   下界 max(0, wornA + wornB - unionSpan)
 *   上界 min(wornA, wornB, overlapSpan)
 * 并集佩戴分钟 = wornA + wornB - x，因此也得到一个可证实范围。
 */
export function doubleWornBounds(a, b) {
  const overlapSpan = overlapLength(a.start, a.end, b.start, b.end)
  const unionSpan = unionLength(a.start, a.end, b.start, b.end)
  const lower = Math.max(0, a.worn + b.worn - unionSpan)
  const upper = Math.min(a.worn, b.worn, overlapSpan)
  return {
    overlapSpan,
    unionSpan,
    doubleWorn: { low: lower, high: upper },
    unionWorn: { low: a.worn + b.worn - upper, high: a.worn + b.worn - lower },
  }
}

/**
 * 同一重叠窗内两份活动量的可证实范围。
 * 重叠窗内两份读数都存在时，活动时间只能贡献一份：
 *   合计量下界 = 两份读数的较大者（另一份完全落在重叠窗内）
 *   合计量上界 = 两份读数之和（没有任何活动分钟真正重合）
 */
export function combinedValueBounds(a, b) {
  return { low: Math.max(a.value, b.value), high: a.value + b.value }
}

/** 单个记录的佩戴覆盖度 = 佩戴分钟 / 窗口分钟。 */
export function recordCoverage(record) {
  const span = record.end - record.start
  if (span <= 0) return 0
  return record.worn / span
}

/**
 * 同组（同一用户/周/固件侧）多条记录的覆盖度。
 * 佩戴与窗口都按并集去重；缺少分钟级明细时用可证实的佩戴并集范围，
 * 返回保守下界（high 端的重复佩戴被扣除后的最小并集佩戴）。
 */
export function groupCoverage(records) {
  if (records.length === 0) return 0
  if (records.length === 1) return recordCoverage(records[0])
  let unionSpan = 0
  // 用区间合并求窗口并集。
  const spans = records
    .map((r) => [r.start, r.end])
    .sort((x, y) => x[0] - y[0])
  const merged = []
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
  unionSpan = merged.reduce((sum, [s, e]) => sum + (e - s), 0)
  // 佩戴并集保守下界：先求和，再扣除所有成对重复佩戴的上界。
  let wornSum = records.reduce((sum, r) => sum + r.worn, 0)
  let maxDouble = 0
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      maxDouble += doubleWornBounds(records[i], records[j]).doubleWorn.high
    }
  }
  const unionWornLow = Math.max(0, wornSum - maxDouble)
  return unionWornLow / unionSpan
}
