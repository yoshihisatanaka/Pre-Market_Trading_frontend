/**
 * モンキーテスト。画面ごとに 1 test を立て、ランダムな操作を steps 回撒く。
 *
 *   docker compose run --rm -e MONKEY_TARGETS=/masters/fx e2e \
 *     npx playwright test --config=monkey/playwright.monkey.config.js
 *
 * 環境変数:
 *   MONKEY_TARGETS  対象画面（カンマ区切り・path でもラベルでもよい。既定は all）
 *   MONKEY_SEED     乱数の seed（既定 1。同じ seed なら同じ操作列）
 *   MONKEY_STEPS    1 画面あたりの操作回数（既定 60）
 *   MONKEY_STRICT   1 なら warn でも失敗させる（既定は error だけ）
 *
 * これは受け入れ条件のテストではない（docs/e2e/ のシナリオ ID を持たない）。
 * 合否ではなく「異常が出たかどうか」を見るための道具なので、e2e/ ではなくここに置く。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from '@playwright/test'
import { resolveTargets, slugify } from './targets.js'
import { runMonkey } from './runner.js'

const SEED = Number(process.env.MONKEY_SEED ?? 1)
const STEPS = Number(process.env.MONKEY_STEPS ?? 60)
const STRICT = process.env.MONKEY_STRICT === '1'
const RUN_ID = process.env.MONKEY_RUN_ID ?? `seed${SEED}`
const REPORT_DIR = resolve(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'monkey-report',
  RUN_ID,
)

const { targets, unknown } = resolveTargets(process.env.MONKEY_TARGETS)

if (unknown.length > 0) {
  throw new Error(
    `MONKEY_TARGETS に未知の指定がある: ${unknown.join(', ')}\n` +
      'path（例 /masters/fx）かサイドメニューのラベル（例 為替マスタ）で指定する。',
  )
}

function summarize(findings) {
  const counts = { error: 0, warn: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

test.describe('モンキーテスト', () => {
  for (const target of targets) {
    test(`${target.label} (${target.to})`, async ({ page }, testInfo) => {
      const result = await runMonkey({ page, target, seed: SEED, steps: STEPS })
      const counts = summarize(result.findings)
      const slug = slugify(target.to)

      mkdirSync(REPORT_DIR, { recursive: true })
      const reportPath = join(REPORT_DIR, `${slug}.json`)
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            target,
            seed: SEED,
            steps: STEPS,
            status: result.status,
            counts,
            findings: result.findings,
            actions: result.steps,
          },
          null,
          2,
        ),
        'utf8',
      )
      await testInfo.attach(`${slug}.json`, { path: reportPath, contentType: 'application/json' })

      if (result.status === 'not-implemented') {
        test.skip(true, `${target.to} はルート未定義（「ページが見つかりません」に落ちた）`)
        return
      }

      if (counts.error > 0 || counts.warn > 0) {
        const shot = join(REPORT_DIR, `${slug}.png`)
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
        await testInfo.attach(`${slug}.png`, { path: shot, contentType: 'image/png' })
      }

      const failed = STRICT ? counts.error + counts.warn : counts.error
      if (failed > 0) {
        const lines = result.findings
          .filter((f) => (STRICT ? f.severity !== 'info' : f.severity === 'error'))
          .map((f) => `  [${f.severity}] step ${f.step} ${f.kind}: ${f.message}`)
        throw new Error(
          `異常 ${failed} 件（error ${counts.error} / warn ${counts.warn}）\n` +
            `${lines.join('\n')}\n` +
            `操作列とレポート: monkey-report/${RUN_ID}/${slug}.json（seed ${SEED} で再現できる）`,
        )
      }
    })
  }
})
