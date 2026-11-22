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
