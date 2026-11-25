// 同一条日常业务路径：加载资料 -> 按当日证据评估桥接 -> 逐用户/周判定可比性
// -> 驱动交付状态机 -> 汇总产品组与用户视图。
import { loadAll } from './load.js'
import { evaluateBridges } from './bridge.js'
import { assessAll } from './comparability.js'
import { runDay } from './delivery.js'

/**
 * 以 day 当天可见的全部证据跑一遍日常路径。
 * @param dataDir 资料目录（作为参数传入，不在该目录内执行任何代码）
 * @param day     项目历日编号；默认取全部事件中的最大日
 */
export async function runPipeline(dataDir, day) {
  const data = await loadAll(dataDir)
  const runDayValue = day ?? Math.max(...data.events.map((e) => Number(e.at)))

  const bridgeEvaluation = evaluateBridges(
    data.bridge,
    data.policies,
    data.evidence,
    data.events,
    runDayValue,
  )
  const assessments = assessAll(data.activities, bridgeEvaluation)
  const delivery = runDay({
    day: runDayValue,
    outboxRows: data.outbox,
    eventRows: data.events,
    subscriptionRows: data.subscriptions,
    assessments,
  })

  return {
    day: runDayValue,
    data,
    bridgeEvaluation,
    assessments,
    delivery,
  }
}
