import { expect, test } from '@playwright/test'
import { calculationSetting } from '../src/mocks/fixtures/calculationSettings'
import { clickSideMenuLink } from './helpers/sideMenu'
import { mockApi } from './helpers/mockApi'

const PATH = '/masters/provisional-calculation'
const API_PATH = '*/api/masters/calculation-settings'

/*
 * 既定モックの現在値の見え方。換算（比率 → %、bp → %）と桁数は画面の仕様そのものなので、
 * フィクスチャ（src/mocks/fixtures/calculationSettings.js）の値を画面の表記で書き下す:
 *   取引所税率 0.00002 → 0.002000% / 為替スプレッド 0.5 → 0.5000 円/USD
 *   現地手数料率_bp 10 → 0.100000% / NISA為替上乗せ率 5 → 5.0000%
 */
const CURRENT = {
  exchangeTax: '0.002000%',
  spread: '0.5000 円/USD',
  commission: '0.100000%',
  nisaMarkup: '5.0000%',
}

/** フィクスチャの更新日時（タイムゾーン無しの ISO）を formatDateTime の表記（YYYY/MM/DD HH:mm）に直す */
function fixtureUpdatedAt() {
  const iso = calculationSetting['更新日時']
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`
}

async function openWithDefaults(page) {
  await page.goto(PATH)
  await expect(page.getByTestId('calc-settings-exchange-tax')).toHaveText(CURRENT.exchangeTax)
}

// シナリオ: docs/e2e/calculation-settings.md（タイトル先頭の [PC-xx] が対応 ID）
// 現在値が読めること・保存した値が現在値に反映されること・失敗と入力の不備が伝わることを守る。
// dev サーバ側で MSW が起動しているため、既定ではフィクスチャの応答が返る。
// モックの可変状態はページ単位なので、保存しても他のテストには持ち越さない。
test.describe('仮計算マスタ', () => {
  test('[PC-01] 現在の設定が 4 項目と最終更新・更新者つきで表示される', async ({ page }) => {
    await page.goto(PATH)

    await expect(page.getByTestId('calc-settings-exchange-tax')).toHaveText(CURRENT.exchangeTax)
    await expect(page.getByTestId('calc-settings-spread')).toHaveText(CURRENT.spread)
    await expect(page.getByTestId('calc-settings-commission')).toHaveText(CURRENT.commission)
    await expect(page.getByTestId('calc-settings-nisa-markup')).toHaveText(CURRENT.nisaMarkup)

    const updated = page.getByTestId('calc-settings-updated')
    await expect(updated).toContainText(fixtureUpdatedAt())
    await expect(updated).toContainText(`更新者：${calculationSetting['更新者']}`)
  })

  test('[PC-02] 取得が失敗したときエラー表示と再試行ボタンが出る', async ({ page }) => {
    await mockApi(page, [
      { path: API_PATH, status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('calc-settings-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('calc-settings-form')).toHaveCount(0)
  })

  test('[PC-03] 設定が返らないとき未設定の表示になる', async ({ page }) => {
    await mockApi(page, [{ path: API_PATH, status: 200, body: null }])
    await page.goto(PATH)

    await expect(page.getByTestId('calc-settings-empty')).toHaveText(
      '仮計算マスタが設定されていません。',
    )
    await expect(page.getByTestId('calc-settings-form')).toHaveCount(0)
  })

  test('[PC-04] 値を変えて保存すると現在値に反映される', async ({ page }) => {
    await openWithDefaults(page)

    await page.getByTestId('calc-settings-exchange-tax-input').fill('0.003')
    await page.getByTestId('calc-settings-commission-input').fill('0.15')
    await page.getByTestId('calc-settings-save').click()

    await expect(page.getByTestId('calc-settings-notice')).toContainText(
      '仮計算マスタを変更しました。',
    )
    await expect(page.getByTestId('calc-settings-exchange-tax')).toHaveText('0.003000%')
    await expect(page.getByTestId('calc-settings-commission')).toHaveText('0.150000%')
    // 触っていない項目はそのまま
    await expect(page.getByTestId('calc-settings-spread')).toHaveText(CURRENT.spread)
    await expect(page.getByTestId('calc-settings-nisa-markup')).toHaveText(CURRENT.nisaMarkup)
  })

  test('[PC-05] 何も変えずに保存すると変更なしと伝わる', async ({ page }) => {
    await openWithDefaults(page)

    await page.getByTestId('calc-settings-save').click()

    await expect(page.getByTestId('calc-settings-notice')).toContainText('変更はありません。')
    await expect(page.getByTestId('calc-settings-exchange-tax')).toHaveText(CURRENT.exchangeTax)
    await expect(page.getByTestId('calc-settings-updated')).toContainText(fixtureUpdatedAt())
  })

  test('[PC-06] 範囲外の値で保存すると理由が出て現在値は変わらない', async ({ page }) => {
    await openWithDefaults(page)

    // NISA為替上乗せ率の上限は 100（拒否はサーバ側。文言はサーバの資産なので固定しない）
    await page.getByTestId('calc-settings-nisa-markup-input').fill('101')
    await page.getByTestId('calc-settings-save').click()

    await expect(page.getByTestId('calc-settings-save-error')).toBeVisible()
    await expect(page.getByTestId('calc-settings-notice')).toHaveCount(0)
    await expect(page.getByTestId('calc-settings-nisa-markup')).toHaveText(CURRENT.nisaMarkup)
  })

  test('[PC-07] 他の担当者が先に更新していると競合が出て現在値は変わらない', async ({ page }) => {
    // GET は既定のまま（画面は正常に開く）。PUT だけを 409 に差し替える
    await mockApi(page, [
      {
        method: 'put',
        path: API_PATH,
        status: 409,
        body: {
          detail: '他のユーザーによって更新されています。最新の情報を取得してからやり直してください。',
        },
      },
    ])
    await openWithDefaults(page)

    await page.getByTestId('calc-settings-exchange-tax-input').fill('0.003')
    await page.getByTestId('calc-settings-save').click()

    await expect(page.getByTestId('calc-settings-save-error')).toContainText('更新されています')
    await expect(page.getByTestId('calc-settings-notice')).toHaveCount(0)
    await expect(page.getByTestId('calc-settings-exchange-tax')).toHaveText(CURRENT.exchangeTax)
  })

  test('[PC-08] 未入力の項目があると保存されず入力を促す', async ({ page }) => {
    // PUT が飛べば保存できない理由が出るように 500 へ差し替えておき、それが出ないことで「送っていない」を見る
    await mockApi(page, [
      {
        method: 'put',
        path: API_PATH,
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await openWithDefaults(page)

    await page.getByTestId('calc-settings-spread-input').fill('')
    await page.getByTestId('calc-settings-save').click()

    await expect(page.getByTestId('calc-settings-form')).toContainText(
      'スプレッドを入力してください。',
    )
    await expect(page.getByTestId('calc-settings-save-error')).toHaveCount(0)
    await expect(page.getByTestId('calc-settings-notice')).toHaveCount(0)
    await expect(page.getByTestId('calc-settings-spread')).toHaveText(CURRENT.spread)
  })

  test('[PC-09] サイドメニューから遷移できる', async ({ page }) => {
    await page.goto('/')

    await clickSideMenuLink(page, '仮計算マスタ')

    await expect(page).toHaveURL(/\/masters\/provisional-calculation$/)
    await expect(page.getByTestId('calc-settings-current')).toBeVisible()
  })
})
