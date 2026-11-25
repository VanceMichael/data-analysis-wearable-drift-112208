// 订阅规则：按生效日解析用户在某一天的有效订阅模式，以及纠正窗口。
import { parseSubscription } from './load.js'

/**
 * 返回用户截至 day 的最新有效订阅记录（effective <= day 中的最大者）。
 * 尚未生效的记录不参与；没有任何生效记录时返回 null。
 */
export function effectiveSubscriptionAt(subscriptionRows, user, day) {
  const rows = subscriptionRows
    .map(parseSubscription)
    .filter((r) => r.user === user && r.effective <= day)
    .sort((a, b) => b.effective - a.effective)
  return rows[0] ?? null
}

/** 用户在 day 当天是否处于停订状态。 */
export function isCancelledAt(subscriptionRows, user, day) {
  const sub = effectiveSubscriptionAt(subscriptionRows, user, day)
  return sub?.mode === '停订'
}

/**
 * 纠正窗口判定。
 * 窗口长度取「交付当天生效的订阅」的 correction_days（与用户当时的约定一致）；
 * 停订后已交付且错误的历史摘要，仍可在该窗口内单独解释。
 * @returns {{open:boolean,deadline:number|null,daysLeft:number|null}}
 */
export function correctionWindow(subscriptionRows, delivery, day) {
  const subAtDelivery = effectiveSubscriptionAt(subscriptionRows, delivery.user, delivery.at)
  const days = subAtDelivery?.correctionDays ?? 0
  const deadline = delivery.at + days
  return {
    open: day <= deadline,
    deadline,
    daysLeft: deadline - day,
    correctionDays: days,
  }
}
