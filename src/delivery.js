// 交付侧状态机：区分「尚未送 / 已送 / 结果未知」，处理同一天到达的
// 计时器、补录、停订与送达回单，保证幂等、不重复发错版本；
// 并按「真正发出过的内容」判断谁需要更正。
import { parseOutbox, parseEvent } from './load.js'
import { effectiveSubscriptionAt, correctionWindow } from './subscriptions.js'

// 同一天内的处理顺序：先证据（补录），再订阅（停订），再计时器（到期），最后回单。
// 这样计时器决策能看到当天完整证据，回单只用于回填未知结果，不触发重发。
export const EVENT_PRIORITY = {
  补录: 0,
  停订: 1,
  到期: 2,
  送达回单: 3,
}

const STATUS = { PENDING: '待发', SENT: '已送', UNKNOWN: '未知' }

/** 全部事件按 (日, 同日优先级) 排序。 */
export function orderedEvents(eventRows) {
  return eventRows
    .map(parseEvent)
    .sort((a, b) => (a.at - b.at) || (EVENT_PRIORITY[a.event] ?? 99) - (EVENT_PRIORITY[b.event] ?? 99))
}

/** 截至 day 的送达回单引用集合（回单到达后「未知」才转为「已送」）。 */
function receiptsByDay(eventRows, day) {
  const set = new Set()
  for (const ev of eventRows.map(parseEvent)) {
    if (ev.event === '送达回单' && ev.at <= day) set.add(ev.ref)
  }
  return set
}

/**
 * 单日交付判定。纯函数：同一输入多次运行得到同一结论，不产生重复发送。
 * @param day              运行日（项目历日编号）
 * @param outboxRows       发件箱原始记录
 * @param eventRows        事件原始记录
 * @param subscriptionRows 订阅原始记录
 * @param assessments      assessAll() 在 day 当天证据下的结果 Map
 */
export function runDay({ day, outboxRows, eventRows, subscriptionRows, assessments }) {
  const receipts = receiptsByDay(eventRows, day)
  const decisions = []

  for (const row of outboxRows.map(parseOutbox).sort((a, b) => a.at - b.at)) {
    const sub = effectiveSubscriptionAt(subscriptionRows, row.user, day)
    const mode = sub?.mode ?? null
    const cancelled = mode === '停订'
    const assessment = assessments.get(row.user)?.weeks.get(row.week) ?? null
    const recorded = row.status

    // 1) 结果未知：只等回单，绝不重发，避免重复版本。
    let effectiveStatus = recorded
    let receipt = false
    if (recorded === STATUS.UNKNOWN) {
      if (receipts.has(row.delivery)) {
        effectiveStatus = STATUS.SENT
        receipt = true
      }
    }

    const decision = {
      delivery: row.delivery,
      user: row.user,
      week: row.week,
      requestedKind: row.kind,
      version: row.version,
      dueAt: row.at,
      day,
      recordedStatus: recorded,
      effectiveStatus,
      receiptArrived: receipt,
      mode,
      action: null,
      actionKind: null,
      reasons: [],
      reevaluable: recorded === STATUS.PENDING,
      correction: null,
    }

    // 2) 到期的待发件：按当天证据与订阅决定发送/抑制。
    if (recorded === STATUS.PENDING && row.at <= day) {
      if (cancelled) {
        decision.action = '抑制'
        decision.reasons.push('订阅已停订，停止新的常规周报')
      }

      if (row.kind === '趋势') {
        if (assessment?.trendEligible && !cancelled) {
          decision.action = '发送'
          decision.actionKind = '趋势'
          decision.reasons.push('整周桥接可比，发送趋势版')
        } else if (mode === '分段' && !cancelled) {
          decision.action = '发送'
          decision.actionKind = '实测'
          decision.reasons.push('趋势不可比，分段订阅改发实测摘要，箭头保持未知')
        } else if (!cancelled) {
          decision.action = '抑制'
          decision.actionKind = null
          decision.reasons.push('整周订阅只收可比趋势，当前证据不支持，暂不发送并保留复判')
          decision.reasons.push(...(assessment?.reasons ?? []))
        } else if (!assessment?.trendEligible) {
          // 停订当天证据同样不支持时，把证据原因一并留痕，便于后续复判。
          decision.reasons.push('整周订阅只收可比趋势，当前证据不支持，暂不发送并保留复判')
          decision.reasons.push(...(assessment?.reasons ?? []))
        }
      } else if (row.kind === '实测' && !cancelled) {
        decision.action = '发送'
        decision.actionKind = '实测'
        decision.reasons.push('分段实测摘要到期发送')
      }
    }

    // 3) 已交付内容的更正判断：只针对真正发出（含回单确认）的趋势版。
    if (effectiveStatus === STATUS.SENT) {
      const window = correctionWindow(subscriptionRows, row, day)
      decision.correctionWindow = window
      const trendNowSupported = row.kind === '实测' || assessment?.trendEligible === true
      if (!trendNowSupported) {
        if (window.open) {
          decision.action = decision.action ?? '更正'
          decision.correction = {
            target: row.delivery,
            kind: '更正',
            explanation: buildCorrectionExplanation(row, assessment),
            deadline: window.deadline,
            daysLeft: window.daysLeft,
          }
          decision.reasons.push('已发趋势版失去证据支持，纠正窗口内单独出具更正')
        } else {
          decision.correction = {
            target: row.delivery,
            kind: '逾期',
            explanation: '已发内容失去支持但纠正窗口已关闭',
            deadline: window.deadline,
          }
          decision.reasons.push('纠正窗口已关闭，仅可登记不可再发')
        }
      }
    }

    decisions.push(decision)
  }

  return {
    day,
    decisions,
    corrections: decisions.filter((d) => d.correction?.kind === '更正'),
    suppressed: decisions.filter((d) => d.action === '抑制'),
    sent: decisions.filter((d) => d.action === '发送'),
  }
}

function buildCorrectionExplanation(delivery, assessment) {
  const causes = assessment?.reasons?.length
    ? assessment.reasons.join('；')
    : '桥接证据变化'
  return `原 ${delivery.delivery}（${delivery.user} 第${delivery.week}周趋势版 v${delivery.version}）所依赖的可比性已不成立：${causes}。趋势箭头改为未知，实测分段数据仍然有效。`
}
