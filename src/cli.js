// 命令行入口：同一条日常路径产出报告文件，并支持按用户/台账/更正单查询。
// 用法：
//   node src/cli.js run [--day 105] [--data data] [--out reports]
//   node src/cli.js user U1 [--day 105]
//   node src/cli.js matrix|deliveries|corrections [--day 105]
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runPipeline } from './pipeline.js'
import {
  buildReports,
  comparabilityMatrix,
  deliveryLedger,
  correctionWorklist,
  userView,
} from './reports.js'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else {
        args[key] = next
        i += 1
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0] ?? 'run'
  const dataDir = resolve(process.cwd(), args.data ?? 'data')
  const day = args.day === undefined || args.day === true ? undefined : Number(args.day)
  const result = await runPipeline(dataDir, day)

  if (command === 'run') {
    const outDir = resolve(process.cwd(), args.out ?? 'reports')
    await mkdir(outDir, { recursive: true })
    const reports = buildReports(result)
    const file = resolve(outDir, `day-${result.day}.json`)
    await writeFile(file, `${JSON.stringify(reports, null, 2)}\n`, 'utf8')
    console.log(`已生成第 ${result.day} 日报告: ${file}`)
    console.log(
      `可比性 ${reports.comparability.length} 行；交付动作 ${result.delivery.decisions.length} 条；待更正 ${reports.corrections.length} 条`,
    )
    return
  }

  if (command === 'user') {
    const userId = args._[1]
    if (!userId) throw new Error('user 命令需要用户编号，例如: node src/cli.js user U1')
    console.log(JSON.stringify(userView(result.assessments, userId), null, 2))
    return
  }

  const views = {
    matrix: () => comparabilityMatrix(result.assessments),
    deliveries: () => deliveryLedger(result.delivery),
    corrections: () => correctionWorklist(result.delivery),
  }
  if (!views[command]) throw new Error(`未知命令: ${command}`)
  console.log(JSON.stringify(views[command](), null, 2))
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
