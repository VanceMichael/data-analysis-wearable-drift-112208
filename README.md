# 穿戴固件换代的趋势可比性与订阅报告

活动值仅表示合成运动量。佩戴窗按分钟计，订阅不提供医疗判定。 所有资料均为合成记录。文件编码为 UTF-8，数字、日期及标记在原始记录中均以字符串保存。问号表示来源未能提供该值；加号分隔来源系统使用的组合编号。

## 资料

日从项目历法起点编号，活动的分钟区间仅在所属周里相对比较。两设备重合活动窗口不能把佩戴分钟或活动量求和，原始汇总没有精细到每一分钟时允许以能证实的范围表达。桥接误差限分别使用活动量和分钟。

- `activities.json` 记录字段为 `record`、`user`、`device`、`fw`、`week`、`start`、`end`、`value`、`worn`。
- `bridge.json` 记录字段为 `pair`、`device`、`old`、`new`、`worn_old`、`worn_new`、`condition`、`revision`、`state`。
- `subscriptions.json` 记录字段为 `user`、`mode`、`effective`、`correction_days`。
- `outbox.json` 记录字段为 `delivery`、`user`、`week`、`kind`、`version`、`at`、`status`。
- `events.json` 记录字段为 `at`、`event`、`ref`。
- `policies.json` 记录字段为 `device`、`min_pairs`、`min_coverage`、`max_value_error`、`max_worn_error`。
- `calendar.json` 记录字段为 `week`、`start_day`、`end_day`。
- `evidence.json` 记录字段为 `bridge`、`predecessor`、`firmware_from`、`firmware_to`、`released_day`。

## 运行

使用 Node.js 22。项目无需下载第三方依赖。

```sh
npm ci --offline --ignore-scripts
npm test
```

`npm run data:check` 检查合成资料能否读取并核对相关记录的引用。资料校验脚本可以独立运行。

## 日常业务路径

趋势计算与报告发送在同一条路径里完成（`src/pipeline.js`），按项目历日编号做「截至当日」判断：

1. `src/load.js` 读取并解析来源表，保留原始字符串行，`?` 解析为空值、`+` 拆分为组合编号。
2. `src/bridge.js` 按生效日选择桥接修订版本（首版取 `evidence.released_day`，撤回等后续修订取指向该 pair 的「补录」日），再按 `policies.json` 的配对数、活动量误差、佩戴分钟误差门槛判定每个设备对是否可用，并分别给出两类误差限。
3. `src/comparability.js` 识别同人同周的重叠窗（重复佩戴的活动时间只计一份，缺少分钟级明细时用可证实范围表达），计算佩戴覆盖度门槛，把达标旧读数按桥接偏差换算到新口径，并输出跨周趋势箭头；桥接失效、覆盖不足或无重合参照时箭头保持未知，只保留分段实测摘要。不使用旧版人口整体均值纠正单个边界用户。
4. `src/delivery.js` 是交付状态机，区分 `待发 / 已送 / 未知`；同一天事件按 补录 → 停订 → 到期 → 回单 排序，未知状态只等回单不重发，待发件可随证据变化重新判断；已发出且失去证据支持的趋势版，按交付当时订阅的 `correction_days` 纠正窗口单独出具更正，停订后停止新的常规周报但不关闭历史更正窗口。
5. `src/reports.js` 派生产品组视图（可比性矩阵、交付台账、更正工作清单）与用户视图（两周可信趋势或分段实测）。

```sh
npm run report -- --day 105        # 生成 reports/day-105.json
node src/cli.js user U3            # 查某用户看到的是可信趋势还是分段报告
node src/cli.js matrix             # 用户 × 报告周可比性
node src/cli.js deliveries         # 真正发送过/抑制/未知的交付台账
node src/cli.js corrections        # 当前仍需处理的更正
```

### 资料内隐含的判定口径

- 覆盖度 = 佩戴分钟 / 窗口分钟；多记录按窗口并集去重，佩戴并集取可证实的保守下界。
- 桥接换算：新口径点估计 = 旧读数 + 有效配对的平均偏差；误差限取有效配对绝对偏差的最大值，活动量与佩戴分钟分别计算。
- 趋势箭头保守判定：新读数落在桥接误差区间内时箭头为 `unknown`，点估计方向仅作参考。
- 设备对按用户实际出现的旧/新设备共同定位（D1 同时属于 D1+D2 与 D1+D3，不能只凭单台设备取第一个匹配项）。

## 测试

`npm test` 运行全部单元与端到端测试（Node 内置 test runner，无第三方依赖）。
