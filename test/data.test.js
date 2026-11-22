import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const tableNames = ["activities", "bridge", "subscriptions", "outbox", "events", "policies", "calendar", "evidence"]
const records = new Map()

for (const name of tableNames) {
  const file = new URL(`../data/${name}.json`, import.meta.url)
  records.set(name, JSON.parse(await readFile(file, 'utf8')))
}

test('每张来源表保留一致的字段及原始值格式', () => {
  for (const [name, rows] of records) {
    assert.ok(rows.length > 0, name)
    const columns = Object.keys(rows[0])
    for (const row of rows) {
      assert.deepEqual(Object.keys(row), columns, name)
      assert.ok(Object.values(row).every(value => typeof value === 'string'), name)
    }
  }
})

test('关联的来源记录保留各自的引用字段', () => {
  const [left, leftKey, leftId, right, rightKey, rightId, leftField, rightField] =
    ["bridge", "pair", "P2", "outbox", "user", "U1", "revision", "status"]
  const leftRows = records.get(left).filter(row => row[leftKey] === leftId)
  const rightRows = records.get(right).filter(row => row[rightKey] === rightId)
  assert.ok(leftRows.length > 0)
  assert.ok(rightRows.length > 0)
  assert.ok(leftRows.every(row => row[leftField]))
  assert.ok(rightRows.every(row => row[rightField]))
})
