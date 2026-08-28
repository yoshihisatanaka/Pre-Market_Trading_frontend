/**
 * docs/e2e/*.md のシナリオ ID と e2e/**\/*.spec.js のテストタイトルを突き合わせる。
 *
 *   docker compose run --rm frontend npm run check:scenarios
 *
 * error（exit 1）:
 *   - 状態が「実装済」なのに対応するテストが無い
 *   - テストに付いた ID が文書に無い（文書が正）
 *   - 同じ ID が複数のテストに付いている
 * warning（exit 0）:
 *   - 状態が「未着手」「保留」でテストが無い
 *
 * docs/ はコンテナでは /docs/e2e に read-only マウントされている（docker-compose.yml）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SCENARIO_DIR = process.env.E2E_SCENARIO_DIR || '/docs/e2e'
const TEST_DIR = resolve(process.cwd(), 'e2e')
const STATUS_REQUIRED = '実装済'
const STATUS_OPTIONAL = new Set(['未着手', '保留'])
const ID_PATTERN = /^[A-Z]{2,4}-\d{2,3}$/

function walk(dir, filter) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, filter))
    else if (filter(p)) out.push(p)
  }
  return out
}

/** Markdown の表から { id, status, file } を抽出する */
function readScenarios() {
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`シナリオディレクトリが見つかりません: ${SCENARIO_DIR}`)
    console.error('docker compose 経由で実行しているか、E2E_SCENARIO_DIR を確認してください。')
    process.exit(2)
  }
  const files = walk(SCENARIO_DIR, (p) => p.endsWith('.md') && !p.endsWith('README.md'))
  const scenarios = new Map()
  const errors = []
  for (const file of files) {
    const rel = relative(SCENARIO_DIR, file)
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith('|')) continue
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
      const id = cells[0]
      if (!ID_PATTERN.test(id)) continue
      const status = cells[cells.length - 1]
      if (status !== STATUS_REQUIRED && !STATUS_OPTIONAL.has(status)) {
        errors.push(
          `${rel}: ${id} の状態「${status}」は 実装済 / 未着手 / 保留 のいずれかにしてください`,
        )
      }
      if (scenarios.has(id)) {
        errors.push(`${rel}: ${id} が重複しています（${scenarios.get(id).file} にもあります）`)
      }
      scenarios.set(id, { id, status, file: rel })
    }
  }
  return { scenarios, errors }
}

/** test('[ID] …') / test("[ID] …") / test(`[ID] …`) から ID を抽出する */
function readTests() {
  const files = walk(TEST_DIR, (p) => p.endsWith('.spec.js'))
  const tests = new Map()
  const re = /\btest(?:\.only|\.skip|\.fixme)?\(\s*['"`]\[([A-Z]{2,4}-\d{2,3})\]/g
  for (const file of files) {
    const rel = relative(process.cwd(), file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(re)) {
      const id = m[1]
      if (!tests.has(id)) tests.set(id, [])
      tests.get(id).push(rel)
    }
  }
  return tests
}

const { scenarios, errors } = readScenarios()
const tests = readTests()
const warnings = []

for (const s of scenarios.values()) {
  const hit = tests.get(s.id)
  if (hit && hit.length > 1) errors.push(`${s.id}: 複数のテストに付いています → ${hit.join(', ')}`)
  if (!hit) {
    if (s.status === STATUS_REQUIRED)
      errors.push(`${s.id}: 「実装済」ですが対応するテストがありません（${s.file}）`)
    else warnings.push(`${s.id}: 「${s.status}」でテスト未作成（${s.file}）`)
  }
}
for (const [id, files] of tests) {
  if (!scenarios.has(id))
    errors.push(`${id}: テストにありますが docs/e2e/ に定義がありません → ${files.join(', ')}`)
}

const rows = [...scenarios.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(
    (s) =>
      `  ${s.id.padEnd(8)} ${s.status.padEnd(4)} ${tests.has(s.id) ? '✓ ' + tests.get(s.id)[0] : '-'}`,
  )
console.log(`シナリオ ${scenarios.size} 件 / テスト ${tests.size} 件`)
console.log(rows.join('\n'))

if (warnings.length)
  console.log(`\nwarning ${warnings.length} 件:\n` + warnings.map((w) => '  ' + w).join('\n'))
if (errors.length) {
  console.error(`\nerror ${errors.length} 件:\n` + errors.map((e) => '  ' + e).join('\n'))
  process.exit(1)
}
console.log('\nOK: シナリオとテストの対応に問題はありません')
