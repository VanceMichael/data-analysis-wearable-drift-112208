// 桥接试行评估：按生效日选择修订版本、判定设备对的桥接是否成立，
// 并给出适用区间与分别针对活动量、佩戴分钟的误差限。
import { parseBridge, parsePolicy, parseEvidence } from './load.js'

const STATE_ACTIVE = '有效'

/**
 * 每个桥接修订版本的到达日：
 * - 首个版本（revision=1）的到达日取 evidence.released_day；
 * - 后续版本（如撤回）没有单独 evidence 时，取 events 中指向该 pair 的「补录」日；
 *   同一 pair 多次补录时，按修订序号顺序依次对应。
 * 返回 Map: pair -> revision -> availableAt
 */
export function revisionAvailability(bridgeRows, evidenceRows, eventRows) {
  const evidenceByBridge = new Map(evidenceRows.map((row) => [row.bridge, parseEvidence(row)]))
  const backfillsByPair = new Map()
  for (const ev of eventRows) {
    if (ev.event !== '补录') continue
    if (!backfillsByPair.has(ev.ref)) backfillsByPair.set(ev.ref, [])
    backfillsByPair.get(ev.ref).push(Number(ev.at))
  }
  const availability = new Map()
  const revisionsByPair = new Map()
  for (const row of bridgeRows) {
    const rec = parseBridge(row)
    if (!revisionsByPair.has(rec.pair)) revisionsByPair.set(rec.pair, [])
    revisionsByPair.get(rec.pair).push(rec)
  }
  for (const [pair, recs] of revisionsByPair) {
    const sorted = [...recs].sort((a, b) => a.revision - b.revision)
    const backfillDays = backfillsByPair.get(pair) ?? []
    const atByRevision = new Map()
    sorted.forEach((rec, idx) => {
      if (rec.revision === 1) {
        const ev = evidenceByBridge.get(pair)
        atByRevision.set(rec.revision, ev ? ev.releasedDay : null)
      } else {
        // 第 2 个及以后的修订对应第 1 个及以后的补录日。
        atByRevision.set(rec.revision, backfillDays[idx - 1] ?? null)
      }
    })
    availability.set(pair, atByRevision)
  }
  return availability
}

/**
 * 截至 day 某桥接 pair 的最新可见修订；尚未到达的修订不可见。
 */
export function visibleRevision(bridgeRows, availability, pair, day) {
  const recs = bridgeRows
    .map(parseBridge)
    .filter((r) => r.pair === pair)
    .filter((r) => {
      const at = availability.get(pair)?.get(r.revision)
      return at !== null && at !== undefined && at <= day
    })
    .sort((a, b) => b.revision - a.revision)
  return recs[0] ?? null
}

/**
 * 截至 day 每个设备对的有效桥接配对（最新可见修订且状态为「有效」）。
 * 被「撤回」的配对不贡献样本。
 */
export function activePairsAt(bridgeRows, availability, day) {
  const latestByPair = new Map()
  for (const pair of new Set(bridgeRows.map((r) => r.pair))) {
    const latest = visibleRevision(bridgeRows, availability, pair, day)
    if (latest && latest.state === STATE_ACTIVE) latestByPair.set(pair, latest)
  }
  return latestByPair
}

/** 配对级偏差（新版相对旧版）。 */
function pairBias(rec) {
  return {
    pair: rec.pair,
    device: rec.device,
    valueDelta: rec.new - rec.old,
    wornDelta: rec.wornNew - rec.wornOld,
    valueError: Math.abs(rec.new - rec.old),
    wornError: Math.abs(rec.wornNew - rec.wornOld),
    condition: rec.condition,
    revision: rec.revision,
  }
}

/**
 * 按策略评估每个设备对在 day 当天的桥接结论。
 * 策略门槛：min_pairs、max_value_error、max_worn_error 全部满足才成立。
 * 误差限分别使用活动量与佩戴分钟（README 要求），取有效配对绝对偏差的最大值。
 */
export function evaluateBridges(bridgeRows, policyRows, evidenceRows, eventRows, day) {
  const policies = new Map(policyRows.map((row) => {
    const p = parsePolicy(row)
    return [p.device, p]
  }))
  const availability = revisionAvailability(bridgeRows, evidenceRows, eventRows)
  const active = activePairsAt(bridgeRows, availability, day)

  const byDevice = new Map()
  for (const policy of policies.values()) {
    const samples = [...active.values()]
      .filter((rec) => rec.device === policy.device)
      .map(pairBias)
    const pairCount = samples.length
    const valueErrors = samples.map((s) => s.valueError)
    const wornErrors = samples.map((s) => s.wornError)
    const maxValueError = valueErrors.length ? Math.max(...valueErrors) : null
    const maxWornError = wornErrors.length ? Math.max(...wornErrors) : null
    const meanValueDelta = samples.length
      ? samples.reduce((sum, s) => sum + s.valueDelta, 0) / samples.length
      : null
    const meanWornDelta = samples.length
      ? samples.reduce((sum, s) => sum + s.wornDelta, 0) / samples.length
      : null

    const reasons = []
    if (pairCount < policy.minPairs) reasons.push(`有效配对 ${pairCount} < 最少 ${policy.minPairs}`)
    if (maxValueError !== null && maxValueError > policy.maxValueError) {
      reasons.push(`活动量误差 ${maxValueError} > 限值 ${policy.maxValueError}`)
    }
    if (maxWornError !== null && maxWornError > policy.maxWornError) {
      reasons.push(`佩戴分钟误差 ${maxWornError} > 限值 ${policy.maxWornError}`)
    }

    byDevice.set(policy.device, {
      device: policy.device,
      day,
      usable: reasons.length === 0,
      reasons,
      policy,
      samples,
      pairCount,
      meanValueDelta,
      meanWornDelta,
      valueErrorLimit: maxValueError,
      wornErrorLimit: maxWornError,
    })
  }
  return { day, availability, byDevice }
}

/** 找到覆盖某台具体设备的设备对评估（设备对由两台设备编号组成）。 */
export function bridgeForDevice(evaluation, device) {
  for (const info of evaluation.byDevice.values()) {
    if (info.policy.devices.includes(device)) return info
  }
  return null
}

/**
 * 按用户实际使用的旧/新设备组合解析设备对。
 * D1 可能同时属于 D1+D2 与 D1+D3，必须用用户两侧设备共同定位，
 * 不能只凭一台设备取第一个匹配项。
 */
export function bridgeForUserDevices(evaluation, oldDevices, newDevices) {
  for (const info of evaluation.byDevice.values()) {
    const touchesOld = info.policy.devices.some((d) => oldDevices.includes(d))
    const touchesNew = info.policy.devices.some((d) => newDevices.includes(d))
    if (touchesOld && touchesNew) return info
  }
  // 只有单侧设备时退化为按旧设备匹配。
  return oldDevices.length ? bridgeForDevice(evaluation, oldDevices[0]) : null
}
