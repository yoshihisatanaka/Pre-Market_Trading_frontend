import { expect, test } from '@playwright/test'
import { formatDateTime, formatMonthDayTime } from '../src/utils/format'

/*
 * 障害管理を「実 API に当てて」確かめる E2E（スモーク 2 本 IR-01 / IR-02 と、網羅の IR-03〜IR-09）。
 * シナリオ: docs/e2e/incidents-real-api.md（タイトル先頭の [IR-xx] が対応 ID）
 *
 * incidents.spec.js（IN）とは目的が違う。IN は MSW のモックに当てて画面の挙動を
 * 細かく固定する。こちらはフロントとバックエンドの噛み合わせだけを見るので、
 * 期待値に**データの中身を書かない**（現在値は実行時に画面と API から読む）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test incidents.real-api
 *
 * IR-02 / IR-06 / IR-07 はローカル DB の発注停止マスタを実際に書き換える（VWAP `2` を停止 → 再開）。
 * IR-08 / IR-09 は全体（ALL）を停止 → 再開する（注文の新規受付・取消まで止まる。進捗表の「注文入力制御」）。
 * 停止はバックエンド全体に効くので、他の実 API E2E と排他で流す。途中で落ちても
 * afterEach / afterAll が API を直接叩いて再開に戻す。停止理由・日時・操作者と履歴（1 回の実行で 10 行）は
 * 戻せないので、ローカルの開発 DB 前提（docs/e2e/incidents-real-api.md）。
 */

const SUSPEND_API = '/api/operations/order-suspensions/suspend'
const HISTORY_API = '/api/operations/order-suspensions/history'

// src/stores/incidents.js の INCIDENT_HISTORY_PAGE_SIZE（= utils/pagination.js の DEFAULT_PAGE_SIZE）と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない
const HISTORY_PAGE_SIZE = 50

const PATH = '/operations/incidents'

const STATUS_API = '/api/operations/order-suspensions'
const RESUME_API = '/api/operations/order-suspensions/resume'

// 操作するのは全体ではなく注文ルート 1 つ（影響を最小にする）。
// IB（1）は自己取引も含むので避け、VWAP を使う
const TARGET = '2'

// 全体（IR-08 / IR-09 だけが止める。全体停止はルート単位の停止に優先し、注文の新規受付・取消まで止まる）
const ALL_TARGET = 'ALL'

// 誰が触ったかを実 DB に残す（更新系は X-User-Code が要る。src/api/client.js の暫定実装と同じ扱い）
const USER_CODE = 'e2e'

/** 更新系の宛先。dev サーバの /api プロキシ越しに実 API へ届く */
const baseURL = process.env.E2E_BASE_URL || 'http://frontend:5173'

/** 実 API を直接叩くためのコンテキスト。beforeAll で作り afterAll で捨てる */
let api = null

async function getStatus() {
  const res = await api.get(STATUS_API)
  expect(
    res.ok(),
    `実 API から発注停止状態を取得できない（${res.status()}）。api コンテナが動いているか確認する`,
  ).toBe(true)
  return res.json()
}

function targetOf(status, code) {
  const row = (status.targets ?? []).find((item) => item['停止対象'] === code)
  expect(row, `実 API の targets に停止対象 ${code} が無い`).toBeTruthy()
  return row
}

/** 実 API を見ているかを確かめる。MSW はサービスワーカーで横取りするので、それで判別できる */
async function assertRealApi(page) {
  const mswActive = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))
  expect(
    mswActive,
    'MSW が有効なままなので実 API を見ていない。VITE_ENABLE_MSW を false にして frontend を作り直すこと',
  ).toBe(false)
}

/** 停止対象のカード（1 対象 = 1 枚。サーバの並びのまま） */
function targetCardsOf(page) {
  return page.getByTestId('incidents-targets').getByTestId('incidents-target')
}

function targetCardOf(page, code) {
  return targetCardsOf(page).filter({ has: page.getByTestId(`incidents-target-${code}-action`) })
}

function historyRowsOf(page) {
  return page.getByTestId('incidents-history').getByTestId('data-table-row')
}

/**
 * 取得が終わるのを待つ。画面が描画される前はローディング表示も無いので、
 * 先に「データあり」の表が出るのを待ってからローディングの消滅を確かめる。
 * 実 API では状態と履歴の 2 本を並列に引き、履歴は 1〜2 秒かかる（2026-10-01 実測）。
 * Vite の変換が重なると既定の 5 秒を断続的に超えるので、初回描画だけ長めに待つ。
 */
async function settleView(page) {
  await expect(page.getByTestId('incidents-targets')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('incidents-loading')).toHaveCount(0)
}

/** 画面を開いて、実 API に当たっていることまで確認する */
async function openView(page) {
  await page.goto(PATH)
  await settleView(page)
  await assertRealApi(page)
}

/* ここから IR-03 以降の部品 */

/** 履歴 API の 1 ページ（画面と同じ limit） */
async function getHistoryPage(offset) {
  const res = await api.get(HISTORY_API, { params: { limit: HISTORY_PAGE_SIZE, offset } })
  expect(res.ok(), `実 API から操作履歴を取得できない（${res.status()}）`).toBe(true)
  return res.json()
}

/**
 * 履歴 1 件が画面に出るはずの 4 列（変更日時 / 制御内容 / 停止理由 / 更新者）。
 * 変更日時は年なしの書式。更新者は 操作者（コード）だけ（氏名 操作者名 は依頼中 #39 で、実 API はまだ返さない）
 */
function historyCellsOf(item) {
  return [
    formatMonthDayTime(item['操作日時']),
    `${item['停止対象名']}：${item['操作区分名']}`,
    item['変更後データ']?.['停止理由'] ?? '—',
    item['操作者'],
  ]
}

function paginationOf(page) {
  return page.getByTestId('incidents-history-pagination')
}

/** 件数表示（BasePagination の rangeLabel と同じ形） */
function rangeText(total, first, last) {
  return `${total} 件中 ${first}–${last} 件`
}

/** API を直接叩いて VWAP を止める / 戻す（画面を経由しない別経路の操作） */
async function suspendViaApi(reason) {
  const row = targetOf(await getStatus(), TARGET)
  const res = await api.post(SUSPEND_API, {
    data: { 停止対象: TARGET, 停止理由: reason, 更新日時: row['更新日時'] ?? null },
  })
  expect(res.ok(), `API での停止が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
}

async function resumeViaApi() {
  const row = targetOf(await getStatus(), TARGET)
  const res = await api.post(RESUME_API, {
    data: { 停止対象: TARGET, 更新日時: row['更新日時'] ?? null },
  })
  expect(res.ok(), `API での再開が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
}

/** 書き込み系の前提（IR-02 と同じ）。全体が通常で VWAP も通常であること。VWAP の行を返す */
async function expectRouteIdle() {
  const status = await getStatus()
  expect(
    status['全体停止中'],
    '全体（ALL）が停止中のため、ルートの操作は画面が塞ぐ。DB で全体を再開してから流すこと',
  ).toBe(false)
  const row = targetOf(status, TARGET)
  expect(
    row['発注停止中'],
    'VWAP が停止中のまま始まった（前回の後片付け漏れ）。再開してから流すこと',
  ).toBe(false)
  return row
}

// IR-02 が実 DB の停止状態を書き換えるので、IR-01 と並走させない
test.describe.configure({ mode: 'serial' })

test.describe('障害管理（実 API 接続）', () => {
  test.skip(
    process.env.E2E_REAL_API !== '1',
    '実 API に当てるテスト。E2E_REAL_API=1 のときだけ実行する',
  )

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { 'X-User-Code': USER_CODE },
    })
  })

  test.afterEach(async () => {
    // 途中で落ちても VWAP を停止のまま残さない。停止中なら最新の 更新日時 で再開する
    const status = await getStatus()
    const row = targetOf(status, TARGET)
    if (row['発注停止中'] !== true) return
    const res = await api.post(RESUME_API, {
      data: { 停止対象: TARGET, 更新日時: row['更新日時'] ?? null },
    })
    expect(res.ok(), `後片付けの再開が失敗した: ${res.status()} ${await res.text()}`).toBe(true)
  })

  test.afterAll(async () => {
    await api?.dispose()
  })

  test('[IR-01] 実データで停止対象のカードが API の targets と一致する', async ({ page }) => {
    await openView(page)

    const status = await getStatus()
    const targets = status.targets ?? []
    expect(targets.length, '実 API の targets が 0 件').toBeGreaterThan(0)
    expect(targets[0]['停止対象'], '先頭が全体（ALL）ではない').toBe('ALL')

    const cards = targetCardsOf(page)
    await expect(cards).toHaveCount(targets.length)

    for (const [index, target] of targets.entries()) {
      const card = cards.nth(index)
      await expect(card.getByTestId('incidents-target-name')).toHaveText(target['停止対象名'])
      await expect(card.getByTestId(`incidents-target-${target['停止対象']}-action`)).toHaveAttribute(
        'aria-checked',
        String(target['発注停止中'] === true),
      )
      await expect(card.getByTestId('incidents-target-state')).toHaveText(
        target['発注停止中'] === true ? '停止中' : '通常',
      )
    }

    // 4 状態のうち「データあり」に落ちている
    await expect(page.getByTestId('incidents-loading')).toHaveCount(0)
    await expect(page.getByTestId('incidents-error')).toHaveCount(0)
    await expect(page.getByTestId('incidents-empty')).toHaveCount(0)
  })

  test('[IR-02] VWAP を停止して再開するとカード・履歴・API が対で戻る', async ({ page }) => {
    const before = await getStatus()
    expect(
      before['全体停止中'],
      '全体（ALL）が停止中のため、ルートの操作は画面が塞ぐ。DB で全体を再開してから流すこと',
    ).toBe(false)
    const initial = targetOf(before, TARGET)
    expect(
      initial['発注停止中'],
      'VWAP が停止中のまま始まった（前回の後片付け漏れ）。再開してから流すこと',
    ).toBe(false)
    const targetName = initial['停止対象名']

    // 実行ごとに違う理由にして、前回の理由が残っているだけの状態と区別する
    const reason = `E2E 実 API 接続確認 ${new Date().toISOString()}`

    await openView(page)
    const state = targetCardOf(page, TARGET).getByTestId('incidents-target-state')
    const latestHistory = historyRowsOf(page).first()
    const toggle = page.getByTestId(`incidents-target-${TARGET}-action`)

    // 停止
    await toggle.click()
    await page.getByTestId('incidents-control-reason').fill(reason)
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(state).toHaveText('停止中')
    // 停止理由はカードに出さず、履歴の先頭行で見る
    await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${targetName}：発注停止`)
    await expect(latestHistory).toContainText(reason)

    // 再開
    await toggle.click()
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(state).toHaveText('通常')
    await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${targetName}：発注再開`)

    // 画面の状態ではなく、サーバに届いているかを見る
    const after = targetOf(await getStatus(), TARGET)
    expect(after['発注停止中']).toBe(false)
    expect(after['停止理由']).toBe(reason)
  })

  test('[IR-03] 現在の運用状態と全体停止中の抑止が API のフラグどおりになる', async ({ page }) => {
    await openView(page)

    const status = await getStatus()
    const targets = status.targets ?? []
    const allSuspended = status['全体停止中'] === true
    const state = page.getByTestId('incidents-state')

    // 全体（ALL）はこの spec では止めない。止まっていたときだけ全体停止中の分岐を見る
    if (allSuspended) {
      await expect(state).toHaveText('全体停止中')
    } else if (status['発注停止中'] === true) {
      await expect(state).toContainText('一部停止中')
      for (const code of status['停止中の対象'] ?? []) {
        const name = targets.find((row) => row['停止対象'] === code)?.['停止対象名'] ?? code
        await expect(state).toContainText(name)
      }
    } else {
      await expect(state).toHaveText('通常運用')
    }

    await expect(page.getByTestId('incidents-locked')).toHaveCount(allSuspended ? 1 : 0)
    for (const target of targets) {
      const toggle = page.getByTestId(`incidents-target-${target['停止対象']}-action`)
      if (allSuspended && target['停止対象'] !== 'ALL') {
        await expect(toggle).toBeDisabled()
      } else {
        await expect(toggle).toBeEnabled()
      }
    }
  })

  test('[IR-04] 履歴の各列が API の操作履歴と一致する', async ({ page }) => {
    // 履歴 1 ページ（50 行 × 4 列）を 1 行ずつ照合する。実 API は画面の表示に 4 秒前後かかり、
    // 履歴が 50 行に達すると既定の 30 秒を超える（2026-10-05 の検証で afterEach まで届かず打ち切られた）
    test.slow()
    await openView(page)

    const body = await getHistoryPage(0)
    const items = body.histories ?? []

    if (body.total === 0) {
      await expect(page.getByTestId('incidents-history-empty')).toHaveText(
        '障害対応履歴はありません。',
      )
      await expect(paginationOf(page)).toHaveCount(0)
      return
    }

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(items.length)
    // 停止理由は 変更後データ（description にしかキーが無い object）から読んでいる。そこが噛み合っているかを見る
    for (const [index, item] of items.entries()) {
      await expect(rows.nth(index).getByRole('cell')).toHaveText(historyCellsOf(item))
    }
    await expect(paginationOf(page).getByTestId('pagination-range')).toHaveText(
      rangeText(body.total, 1, Math.min(body.total, HISTORY_PAGE_SIZE)),
    )
  })

  test('[IR-05] 履歴の 2 ページ目が API の offset=50 の応答と一致する', async ({ page }) => {
    await openView(page)

    const { total } = await getHistoryPage(0)
    const pagination = paginationOf(page)

    if (total <= HISTORY_PAGE_SIZE) {
      test.info().annotations.push({
        type: 'note',
        description: `履歴が ${total} 件で 1 ページに収まるため、offset が実 API に効くかは確かめていない`,
      })
      await expect(pagination.getByTestId('pagination-page')).toHaveCount(0)
      return
    }

    const secondButton = pagination.getByRole('button', { name: '2', exact: true })
    await secondButton.click()

    await expect(pagination.getByTestId('pagination-range')).toHaveText(
      rangeText(total, HISTORY_PAGE_SIZE + 1, Math.min(total, HISTORY_PAGE_SIZE * 2)),
    )
    await expect(secondButton).toHaveAttribute('aria-current', 'page')

    const second = await getHistoryPage(HISTORY_PAGE_SIZE)
    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(second.histories.length)
    await expect(rows.first().getByRole('cell')).toHaveText(historyCellsOf(second.histories[0]))
  })

  test('[IR-06] 画面を開いたあとに別経路で更新されると、停止は 409 でダイアログに出る', async ({
    page,
  }) => {
    const initial = await expectRouteIdle()
    // 更新日時 が空だと画面は null を送り、競合の照合そのものが行われない。下ごしらえで埋める
    if (initial['更新日時'] == null) {
      await suspendViaApi(`E2E 下ごしらえ ${new Date().toISOString()}`)
      await resumeViaApi()
    }
    const stale = targetOf(await getStatus(), TARGET)
    const reason = `E2E 競合確認 ${new Date().toISOString()}`

    await openView(page)

    // 別経路で停止 → 再開。状態は通常のままだが、画面が持っている 更新日時 は古くなる
    await suspendViaApi(`E2E 別経路 ${new Date().toISOString()}`)
    await resumeViaApi()
    const fresh = targetOf(await getStatus(), TARGET)
    expect(
      fresh['更新日時'],
      '別経路の操作で 更新日時 が変わらなかった（精度が粗く同じ時刻に丸められた可能性）。競合が起きないので確かめられない',
    ).not.toBe(stale['更新日時'])

    await page.getByTestId(`incidents-target-${TARGET}-action`).click()
    await page.getByTestId('incidents-control-reason').fill(reason)
    const responsePromise = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === SUSPEND_API && res.request().method() === 'POST',
    )
    await page.getByTestId('incidents-control-submit').click()
    const res = await responsePromise
    const body = await res.json().catch(() => null)

    expect(res.status(), `停止 API の応答: ${JSON.stringify(body)}`).toBe(409)
    const error = page.getByTestId('incidents-control-error')
    if (typeof body?.detail === 'string') {
      await expect(error).toHaveText(body.detail)
    } else {
      await expect(error).not.toBeEmpty()
    }
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByTestId('incidents-control-reason')).toHaveValue(reason)
    await expect(page.getByTestId('incidents-notice')).toHaveCount(0)

    // 画面からの停止は入っていない
    const after = targetOf(await getStatus(), TARGET)
    expect(after['発注停止中']).toBe(false)
    expect(after['停止理由']).not.toBe(reason)
  })

  test('[IR-07] 別経路で停止した VWAP の再開確認に停止時の記録が出て、再開できる', async ({
    page,
  }) => {
    await expectRouteIdle()
    // 実行ごとに違う理由にして、前回の理由が残っているだけの状態と区別する
    const reason = `E2E 再開確認 ${new Date().toISOString()}`
    await suspendViaApi(reason)
    const suspended = targetOf(await getStatus(), TARGET)
    const targetName = suspended['停止対象名']

    await openView(page)
    const toggle = page.getByTestId(`incidents-target-${TARGET}-action`)
    const state = targetCardOf(page, TARGET).getByTestId('incidents-target-state')

    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(state).toHaveText('停止中')
    await expect(page.getByTestId('incidents-state')).toContainText(targetName)

    await toggle.click()
    await expect(
      page.getByRole('dialog', { name: `${targetName}の発注を再開しますか？` }),
    ).toBeVisible()
    const summary = page.getByTestId('incidents-control-summary')
    await expect(summary).toContainText(reason)
    await expect(summary).toContainText(formatDateTime(suspended['停止日時']))
    await expect(summary).toContainText(suspended['停止者'] ?? '—')
    await expect(page.getByTestId('incidents-control-reason')).toHaveCount(0)

    // 停止と再開を同じテストの中で対にする
    await page.getByTestId('incidents-control-submit').click()

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('incidents-notice')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(state).toHaveText('通常')
    expect(targetOf(await getStatus(), TARGET)['発注停止中']).toBe(false)
  })

  /*
   * ここから全体（ALL）の停止・再開（IR-08 / IR-09）。
   * 全体を止めると注文の新規受付・取消と IB 発注・Dream 連携のバッチまで止まるので、
   *   - 全体もルートもすべて通常のときだけ始める（他の対象が止まっていたら誰かの意図かもしれないので戻さない）
   *   - 前提を通ったあとに全体が止まっていればこのテストが止めたもの。afterEach / afterAll で必ず再開する
   * 入れ子の describe にしているのは、ここの afterAll を外側の api.dispose() より先に走らせるため。
   */
  test.describe('全体（ALL）の停止・再開', () => {
    /** 前提の確認を通ったあとか（通る前の全体停止は他人のものなので触らない） */
    let allPreconditionPassed = false

    /** 全体（または任意の対象）を API で止める / 戻す。画面を経由しない別経路の操作 */
    async function suspendTargetViaApi(code, reason) {
      const row = targetOf(await getStatus(), code)
      const res = await api.post(SUSPEND_API, {
        data: { 停止対象: code, 停止理由: reason, 更新日時: row['更新日時'] ?? null },
      })
      expect(res.ok(), `API での停止（${code}）が失敗した: ${res.status()} ${await res.text()}`).toBe(
        true,
      )
    }

    async function resumeTargetViaApi(code) {
      const row = targetOf(await getStatus(), code)
      const res = await api.post(RESUME_API, {
        data: { 停止対象: code, 更新日時: row['更新日時'] ?? null },
      })
      expect(res.ok(), `API での再開（${code}）が失敗した: ${res.status()} ${await res.text()}`).toBe(
        true,
      )
    }

    /** 全体もルートもすべて通常であること。全体の行を返す */
    async function expectAllIdle() {
      const status = await getStatus()
      expect(
        status['全体停止中'],
        '全体（ALL）が停止中のまま始まった。誰かが意図して止めている可能性があるので、このテストは戻さない。DB で全体を再開してから流すこと',
      ).toBe(false)
      const suspended = (status.targets ?? [])
        .filter((row) => row['発注停止中'] === true)
        .map((row) => `${row['停止対象']}（${row['停止対象名']}）`)
      expect(
        suspended,
        `停止中の対象が残っている（${suspended.join(', ')}）。「通常運用」に戻ることを見るため、再開してから流すこと`,
      ).toEqual([])
      allPreconditionPassed = true
      return targetOf(status, ALL_TARGET)
    }

    /** このテストが止めた全体を戻す。前提確認の前の全体停止には触らない */
    async function resumeAllIfSuspendedByTest() {
      if (!allPreconditionPassed) return
      const row = targetOf(await getStatus(), ALL_TARGET)
      if (row['発注停止中'] !== true) return
      const res = await api.post(RESUME_API, {
        data: { 停止対象: ALL_TARGET, 更新日時: row['更新日時'] ?? null },
      })
      expect(
        res.ok(),
        `後片付けの全体再開が失敗した: ${res.status()} ${await res.text()}。全体停止が残っていると注文の新規受付・取消が止まる。DB で全体を再開すること`,
      ).toBe(true)
    }

    test.afterEach(async () => {
      await resumeAllIfSuspendedByTest()
    })

    // afterEach が途中で落ちたときの最後の砦（外側の api.dispose() より先に走る）
    test.afterAll(async () => {
      await resumeAllIfSuspendedByTest()
    })

    test('[IR-08] 全体を停止すると全体停止中の表示と抑止になり、再開で通常運用に戻る', async ({
      page,
    }) => {
      // 開く → 停止 → 再開で画面が状態と履歴を 3 回引く。実 API は 1 回 4 秒前後かかるので
      // 既定の 30 秒では足りないことがある（2026-10-05 の検証で再開後の API 確認の直前に打ち切られた）
      test.slow()
      const initial = await expectAllIdle()
      const allName = initial['停止対象名']
      const routeCodes = (await getStatus()).targets
        .map((row) => row['停止対象'])
        .filter((code) => code !== ALL_TARGET)
      expect(routeCodes.length, '実 API の targets にルートの行が無い').toBeGreaterThan(0)

      // 実行ごとに違う理由にして、前回の理由が残っているだけの状態と区別する
      const reason = `E2E 全体停止確認 ${new Date().toISOString()}`

      await openView(page)
      const toggle = page.getByTestId(`incidents-target-${ALL_TARGET}-action`)
      const state = targetCardOf(page, ALL_TARGET).getByTestId('incidents-target-state')
      const summaryState = page.getByTestId('incidents-state')
      const latestHistory = historyRowsOf(page).first()
      const routeToggles = routeCodes.map((code) =>
        page.getByTestId(`incidents-target-${code}-action`),
      )

      await expect(summaryState).toHaveText('通常運用')

      // 停止（全体だけに出る警告を確認してから確定する）
      await toggle.click()
      await expect(
        page.getByRole('dialog', { name: `${allName}の発注を停止しますか？` }),
      ).toBeVisible()
      await expect(page.getByTestId('incidents-control-warning')).toBeVisible()
      await page.getByTestId('incidents-control-reason').fill(reason)
      await page.getByTestId('incidents-control-submit').click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('incidents-notice')).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await expect(state).toHaveText('停止中')
      await expect(summaryState).toHaveText('全体停止中')
      // 全体停止中はルートの操作を塞ぎ、全体のトグルだけ押せる（IR-03 の分岐を確実に通す）
      await expect(page.getByTestId('incidents-locked')).toHaveCount(1)
      await expect(toggle).toBeEnabled()
      for (const routeToggle of routeToggles) {
        await expect(routeToggle).toBeDisabled()
      }
      await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${allName}：発注停止`)
      await expect(latestHistory).toContainText(reason)

      // 画面の状態ではなく、サーバに届いているかを見る
      const whileSuspended = await getStatus()
      expect(whileSuspended['全体停止中']).toBe(true)
      expect(targetOf(whileSuspended, ALL_TARGET)['発注停止中']).toBe(true)

      // 再開（確認には今回の停止の記録が出る）
      await toggle.click()
      await expect(
        page.getByRole('dialog', { name: `${allName}の発注を再開しますか？` }),
      ).toBeVisible()
      await expect(page.getByTestId('incidents-control-summary')).toContainText(reason)
      await expect(page.getByTestId('incidents-control-reason')).toHaveCount(0)
      await page.getByTestId('incidents-control-submit').click()

      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('incidents-notice')).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await expect(state).toHaveText('通常')
      await expect(summaryState).toHaveText('通常運用')
      await expect(page.getByTestId('incidents-locked')).toHaveCount(0)
      await expect(toggle).toBeEnabled()
      for (const routeToggle of routeToggles) {
        await expect(routeToggle).toBeEnabled()
      }
      await expect(latestHistory.getByRole('cell').nth(1)).toHaveText(`${allName}：発注再開`)

      const after = await getStatus()
      expect(after['全体停止中']).toBe(false)
      const allAfter = targetOf(after, ALL_TARGET)
      expect(allAfter['発注停止中']).toBe(false)
      expect(allAfter['停止理由']).toBe(reason)
    })

    test('[IR-09] 画面を開いたあとに別経路で全体が更新されると、全体の停止は 409 でダイアログに出る', async ({
      page,
    }) => {
      const initial = await expectAllIdle()
      // 更新日時 が空だと画面は null を送り、競合の照合そのものが行われない。下ごしらえで埋める
      if (initial['更新日時'] == null) {
        await suspendTargetViaApi(ALL_TARGET, `E2E 全体 下ごしらえ ${new Date().toISOString()}`)
        await resumeTargetViaApi(ALL_TARGET)
      }
      const stale = targetOf(await getStatus(), ALL_TARGET)
      const reason = `E2E 全体 競合確認 ${new Date().toISOString()}`

      await openView(page)

      // 別経路で停止 → 再開。状態は通常のままだが、画面が持っている 更新日時 は古くなる
      await suspendTargetViaApi(ALL_TARGET, `E2E 全体 別経路 ${new Date().toISOString()}`)
      await resumeTargetViaApi(ALL_TARGET)
      const fresh = targetOf(await getStatus(), ALL_TARGET)
      expect(
        fresh['更新日時'],
        '別経路の操作で 更新日時 が変わらなかった（精度が粗く同じ時刻に丸められた可能性）。競合が起きないので確かめられない',
      ).not.toBe(stale['更新日時'])

      await page.getByTestId(`incidents-target-${ALL_TARGET}-action`).click()
      await page.getByTestId('incidents-control-reason').fill(reason)
      const responsePromise = page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === SUSPEND_API && res.request().method() === 'POST',
      )
      await page.getByTestId('incidents-control-submit').click()
      const res = await responsePromise
      const body = await res.json().catch(() => null)

      expect(res.status(), `停止 API の応答: ${JSON.stringify(body)}`).toBe(409)
      const error = page.getByTestId('incidents-control-error')
      if (typeof body?.detail === 'string') {
        await expect(error).toHaveText(body.detail)
      } else {
        await expect(error).not.toBeEmpty()
      }
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByTestId('incidents-control-reason')).toHaveValue(reason)
      await expect(page.getByTestId('incidents-notice')).toHaveCount(0)

      // 画面からの全体停止は入っていない
      const after = await getStatus()
      expect(after['全体停止中']).toBe(false)
      const allAfter = targetOf(after, ALL_TARGET)
      expect(allAfter['発注停止中']).toBe(false)
      expect(allAfter['停止理由']).not.toBe(reason)
    })
  })
})
