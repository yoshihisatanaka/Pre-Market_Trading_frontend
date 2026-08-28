/**
 * シナリオ文書（docs/e2e, docs/unit）の ID とテストタイトルの対応を検査する。
 *
 *   docker compose run --rm frontend npm run check:scenarios
 *
 * error（exit 1）:
 *   - 状態が「実装済」なのに対応するテストが無い
 *   - テストに付いた ID が文書に無い（文書が正）
 *   - 同じ ID が複数のテストに付いている / 複数の文書にある（種別をまたいでも不可）
 * warning（exit 0）:
 *   - 状態が「未着手」「保留」でテストが無い
 *   - ID の付いていない test() / it() がある
 *
 * docs/ はコンテナでは /docs/e2e, /docs/unit に read-only マウントされている（docker-compose.yml）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const KINDS = [
  {
    name: 'E2E',
    scenarioDir: process.env.E2E_SCENARIO_DIR || '/docs/e2e',
    testDir: resolve(process.cwd(), 'e2e'),
  },
  {
    name: 'Unit',
    scenarioDir: process.env.UNIT_SCENARIO_DIR || '/docs/unit',
    testDir: resolve(process.cwd(), 'src'),
  },
]
const STATUS_REQUIRED = '実装済'
const STATUS_OPTIONAL = new Set(['未着手', '保留'])
const ID_PATTERN = /^[A-Z]{2,4}-\d{2,3}$/
// test('[ID] …') / it("[ID] …") / test.only(`[ID] …`) など
const TEST_CALL = /\b(?:test|it)(?:\.(?:only|skip|fixme|todo))?\(\s*(['"`])(.*?)\1/g

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
function readScenarios(kind, errors) {
  if (!existsSync(kind.scenarioDir)) {
    console.error(`[${kind.name}] シナリオディレクトリが見つかりません: ${kind.scenarioDir}`)
    console.error('docker compose 経由で実行しているか、*_SCENARIO_DIR を確認してください。')
    process.exit(2)
  }
  const files = walk(kind.scenarioDir, (p) => p.endsWith('.md') && !p.endsWith('README.md'))
  const scenarios = new Map()
  for (const file of files) {
    const rel = relative(kind.scenarioDir, file)
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
          `[${kind.name}] ${rel}: ${id} の状態「${status}」は 実装済 / 未着手 / 保留 のいずれかにしてください`,
        )
      }
      if (scenarios.has(id)) {
        errors.push(
          `[${kind.name}] ${rel}: ${id} が重複しています（${scenarios.get(id).file} にもあります）`,
        )
      }
      scenarios.set(id, { id, status, file: rel })
    }
  }
  return scenarios
}

/** テストファイルから { withId: Map<id, file[]>, withoutId: Map<file, count> } を抽出する */
function readTests(kind) {
  const files = walk(kind.testDir, (p) => p.endsWith('.spec.js'))
  const withId = new Map()
  const withoutId = new Map()
  for (const file of files) {
    const rel = relative(process.cwd(), file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(TEST_CALL)) {
      const title = m[2]
      const idMatch = /^\[([A-Z]{2,4}-\d{2,3})\]/.exec(title)
      if (idMatch) {
        if (!withId.has(idMatch[1])) withId.set(idMatch[1], [])
        withId.get(idMatch[1]).push(rel)
      } else {
        withoutId.set(rel, (withoutId.get(rel) || 0) + 1)
      }
    }
  }
  return { withId, withoutId }
}

const errors = []
const warnings = []
const seenIds = new Map() // 種別をまたいだ重複検出

for (const kind of KINDS) {
  const scenarios = readScenarios(kind, errors)
  const { withId, withoutId } = readTests(kind)

  for (const s of scenarios.values()) {
    if (seenIds.has(s.id)) {
      errors.push(`${s.id}: ${kind.name} と ${seenIds.get(s.id)} の両方の文書にあります`)
    }
    seenIds.set(s.id, kind.name)

    const hit = withId.get(s.id)
    if (hit && hit.length > 1)
      errors.push(`${s.id}: 複数のテストに付いています → ${hit.join(', ')}`)
    if (!hit) {
      if (s.status === STATUS_REQUIRED)
        errors.push(`${s.id}: 「実装済」ですが対応するテストがありません（${s.file}）`)
      else warnings.push(`${s.id}: 「${s.status}」でテスト未作成（${s.file}）`)
    }
  }
  for (const [id, files] of withId) {
    if (!scenarios.has(id))
      errors.push(
        `${id}: テストにありますが ${kind.name} の文書に定義がありません → ${files.join(', ')}`,
      )
  }
  for (const [file, count] of withoutId) {
    warnings.push(`${file}: ID の無いテストが ${count} 件`)
  }

  const rows = [...scenarios.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (s) =>
        `  ${s.id.padEnd(8)} ${s.status.padEnd(4)} ${withId.has(s.id) ? '✓ ' + withId.get(s.id)[0] : '-'}`,
    )
  console.log(`[${kind.name}] シナリオ ${scenarios.size} 件 / ID 付きテスト ${withId.size} 件`)
  console.log(rows.join('\n'))
  console.log('')
}

if (warnings.length)
  console.log(`warning ${warnings.length} 件:\n` + warnings.map((w) => '  ' + w).join('\n'))
if (errors.length) {
  console.error(`\nerror ${errors.length} 件:\n` + errors.map((e) => '  ' + e).join('\n'))
  process.exit(1)
}
console.log('\nOK: シナリオとテストの対応に問題はありません')
