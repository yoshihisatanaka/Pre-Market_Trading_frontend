import { expect, test } from '@playwright/test'
import { navItems, navSections } from '../src/components/layout/navigation'
import { announcement } from '../src/mocks/fixtures/announcements'
import { incidentBannerResponse, noneBannerResponse } from '../src/mocks/fixtures/banner'
import { noOperationOperator, supervisorOperator } from '../src/mocks/fixtures/currentOperator'
import { dreamOrders } from '../src/mocks/fixtures/dreamStatus'
import { closedMarketStatusResponse } from '../src/mocks/fixtures/marketStatus'
import { orderInquiryRows } from '../src/mocks/fixtures/orderInquiry'
import { mockApi } from './helpers/mockApi'
import { sectionToggle } from './helpers/sideMenu'

// シナリオ: docs/e2e/layout.md（タイトル先頭の [LAY-xx] が対応 ID）
// 画面固有の要素はここでは検証しない（各画面のシナリオで扱う）。
// getByRole の name は既定で部分一致のため、「注文」が「注文一覧」に当たらないよう exact: true を付ける。
//
// サイドメニューの初期状態はアプリ起動時に 1 度だけ決まり、以後のリサイズには追従しない。
// 幅を変えるテストは必ず page.goto() より前に setViewportSize すること（後から縮めても何も起きない）。
// 開閉状態は localStorage に残るが、test ごとに context が新しいので保存値は空から始まる。
const toggleButton = (page) => page.getByTestId('sidebar-toggle')
const contentLeft = async (page) => (await page.getByRole('main').boundingBox()).x

/*
 * LAY-03 で遷移に使うメニュー項目。既定の画面（注文一覧）ではない項目なら何でもよい。
 * navigation.js から引いて、名前や path が変わったときに黙って空振りしないようにする。
 * 2026-10-02 に預り検索が実装されてメニューの未実装の項目が無くなったので、「見つからない」は
 * メニューに無い URL（LAY-04）で見る形に分けた。
 */
const TARGET_LABEL = '預り検索'
const TARGET_PATH = navItems.find((item) => item.label === TARGET_LABEL)?.to
const UNKNOWN_PATH = '/no-such-page'

test.describe('共通レイアウト', () => {
  test('[LAY-01] サイドメニューにシステム名とセクションが出て、既定で開く区分のリンクだけが見える', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByText('米株発注システム')).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    for (const section of navSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toBeVisible()
    }
    // 閉じた区分のリンクも DOM には在る（隠れているだけ）
    await expect(nav.getByRole('link', { includeHidden: true })).toHaveCount(navItems.length)

    // 既定の開閉が要件どおりであること自体も確かめる（defaultOpen の付け外しで黙って変わらないように）
    expect(navSections.filter((s) => s.defaultOpen !== false).map((s) => s.label)).toEqual([
      '顧客',
      '注文・照会',
    ])
    for (const section of navSections) {
      const open = section.defaultOpen !== false
      await expect(sectionToggle(page, section.label)).toHaveAttribute(
        'aria-expanded',
        String(open),
      )
      for (const item of section.items) {
        const link = nav.getByRole('link', { name: item.label, exact: true, includeHidden: true })
        await (open ? expect(link).toBeVisible() : expect(link).toBeHidden())
      }
    }
  })

  test('[LAY-02] ヘッダに画面タイトルと市場ステータスが表示される', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(page.getByTestId('market-status')).toHaveText(
      /^(Pre-Market|Regular|After-Hours|Closed)$/,
    )
  })

  test('[LAY-03] サイドメニューから遷移すると見出しと現在ページ表示が切り替わる', async ({
    page,
  }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: TARGET_LABEL, exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`${TARGET_PATH}$`))
    // 見出しは遷移先のルートの meta.title（メニューの表示名と同じ）。画面の中身はここでは見ない
    await expect(page.getByRole('heading', { name: TARGET_LABEL, exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: TARGET_LABEL, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // 現在ページになるのは 1 件だけ
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('[LAY-04] メニューに無い URL を直接開いてもレイアウトは表示される', async ({ page }) => {
    await page.goto(UNKNOWN_PATH)

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await expect(nav).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
    // どのメニュー項目も現在ページにならない
    await expect(nav.getByRole('link').first()).toBeVisible()
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0)
  })

  test('[LAY-05] 広い画面では既定でサイドメニューが開いている', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await expect(page.getByTestId('app-sidebar')).toBeVisible()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'true')
  })

  test('[LAY-06] メニューボタンでサイドメニューを畳むと本文が全幅になる', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    const sidebar = page.getByTestId('app-sidebar')
    await expect(sidebar).toBeVisible()
    expect(await contentLeft(page)).toBeGreaterThan(0)

    await toggleButton(page).click()

    // 見えなくなるのは visibility: hidden のおかげ。負の margin だけでは矩形が残る
    await expect(sidebar).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => contentLeft(page)).toBe(0)

    await toggleButton(page).click()

    await expect(sidebar).toBeVisible()
    await expect.poll(() => contentLeft(page)).toBeGreaterThan(0)
  })

  test('[LAY-07] 畳んだ状態は再読み込みしても保たれる', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await toggleButton(page).click()
    await expect(page.getByTestId('app-sidebar')).toBeHidden()

    await page.reload()

    await expect(page.getByTestId('app-sidebar')).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('[LAY-08] 狭い画面では既定でサイドメニューが畳まれている', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.goto('/')

    const sidebar = page.getByTestId('app-sidebar')
    await expect(sidebar).toBeHidden()
    await expect(toggleButton(page)).toHaveAttribute('aria-expanded', 'false')

    await toggleButton(page).click()

    await expect(sidebar).toBeVisible()
  })

  test('[LAY-09] 畳んだサイドメニューのリンクにはフォーカスが入らない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    await toggleButton(page).click()
    await expect(page.getByTestId('app-sidebar')).toBeHidden()

    // リンク 15 件を通り越す回数だけ送っても、一度も中に入らないことを見る
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab')
      const inSidebar = await page.evaluate(
        () => !!document.activeElement?.closest('[data-testid="app-sidebar"]'),
      )
      expect(inSidebar).toBe(false)
    }
  })

  /*
   * 起動時の読み込みオーバーレイ（AppLoadingOverlay）。覆いの中身の出し分けは単体側（ALO）が持つので、
   * ここでは「起動時に実際に覆われるか」「覆いが操作を遮るか」だけを見る。
   *
   * 既定のモックは即座に応答するのでローディングが一瞬すぎて掴めない。
   * ?mockDelay=<ミリ秒> を付けた URL だけ /api/* の応答が遅れる（src/mocks/handlers/index.js）。
   */
  test('[LAY-10] 起動時はコードマスタを読み終えるまで画面全体が覆われる', async ({ page }) => {
    await page.goto('/?mockDelay=2000')

    const loading = page.getByTestId('app-loading')
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('読み込んでいます')

    // 読み終えれば覆いが外れ、下に組み上がっていた画面が現れる
    await expect(loading).toBeHidden()
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
  })

  test('[LAY-11] コードマスタの取得に失敗すると理由と再試行が覆いの中に出る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/codes', status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')

    const error = page.getByTestId('app-loading-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('サーバーでエラーが発生しました。')
    await expect(page.getByTestId('app-loading-retry')).toBeVisible()
    // 読み直し中ではないので回転マーク側は出ない
    await expect(page.getByTestId('app-loading')).toHaveCount(0)
  })

  test('[LAY-12] 取得に失敗して覆われている間は画面を操作できない', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/codes', status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')
    await expect(page.getByTestId('app-loading-error')).toBeVisible()

    /*
     * 覆いの下にはレイアウトが組み上がっている（App.vue は AppLayout を v-if で隠さない）。
     * リンクそのものを click すると Playwright の可触判定で止まってしまうので、
     * 座標を取って実際にその位置を押す。覆いが受け止めるので遷移は起きない。
     */
    const link = page.getByRole('link', { name: '顧客検索', exact: true })
    const box = await link.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('app-loading-error')).toBeVisible()
  })

  /*
   * ヘッダの取引時間帯（GET /market-status）。
   * モックは固定日のフィクスチャを「今日（JST）」へずらして返すので、実行日によって
   * どのセッションが現在になるかが変わる。ここでは枠組みだけを見て、具体的な時刻や
   * 境界での切り替えは単体側（MKS / UMS / AHD）に任せる。
   */
  test('[LAY-13] ヘッダのバッジにいまの時間帯が JST と ET で表示される', async ({ page }) => {
    await page.goto('/')

    // セッション中でもセッション外でも同じ形。日跨ぎの端点には 翌 が前置される
    await expect(page.getByTestId('market-jst')).toHaveText(
      /^日本時間 (翌)?\d{2}:\d{2}–(翌)?\d{2}:\d{2}（(夏|冬)時間）$/,
    )
    await expect(page.getByTestId('market-et')).toHaveText(/^ET \d{2}:\d{2}–\d{2}:\d{2}$/)
  })

  test('[LAY-14] 休場の日は理由が出て、取引時間帯は表示されない', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/market-status', body: closedMarketStatusResponse }])
    await page.goto('/')

    await expect(page.getByTestId('market-status')).toHaveText('Closed')
    await expect(page.getByTestId('market-jst')).toHaveText('休場（感謝祭）')
    await expect(page.getByTestId('market-et')).toHaveText('ET Market Holiday')
  })

  test('[LAY-15] 市場状況が取れなくてもヘッダは壊れず画面を操作できる', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/market-status',
        status: 500,
        body: { detail: 'サーバーでエラーが発生しました。' },
      },
    ])
    await page.goto('/')

    // 推定を出さない。覆いは codes の取得だけで外れる（市場状況は起動の条件ではない）
    await expect(page.getByTestId('market-status')).toHaveText('—')
    await expect(page.getByTestId('market-jst')).toHaveText('市場状況を取得できません')
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: '顧客検索', exact: true }).click()

    await expect(page).toHaveURL(/\/customers\/search$/)
  })

  /*
   * 権限の要る区分（navigation.js の requiredPermission）。ここで見るのは区分の有無だけで、
   * URL を直接開いたときの制限は e2e/access-control.spec.js（AC）が見る。
   * 既定モックの /auth/me は全権限ありなので、権限なしは mockApi() で差し替える。
   */
  const guardedSections = navSections.filter((section) => section.requiredPermission)
  const openSections = navSections.filter((section) => !section.requiredPermission)

  /** 権限の要る区分が見出しもリンクも出ず、それ以外の区分は出ていることを確かめる */
  async function expectGuardedSectionsHidden(page) {
    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    for (const section of openSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toBeVisible()
      for (const item of section.items) {
        await expect(nav.getByRole('link', { name: item.label, exact: true })).toBeVisible()
      }
    }
    for (const section of guardedSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toHaveCount(0)
      for (const item of section.items) {
        await expect(nav.getByRole('link', { name: item.label, exact: true })).toHaveCount(0)
      }
    }
    await expect(nav.getByRole('link')).toHaveCount(
      openSections.flatMap((section) => section.items).length,
    )
  }

  test('[LAY-16] 運用管理権限が無いとサイドメニューに運用管理の区分が出ない', async ({ page }) => {
    // 区分の名前が変わったときに黙って空振りしないよう、対象が在ることを先に確かめる
    expect(guardedSections.map((section) => section.label)).toContain('運用管理')

    await mockApi(page, [{ path: '*/api/auth/me', body: noOperationOperator }])
    await page.goto('/')

    await expectGuardedSectionsHidden(page)
  })

  test('[LAY-17] 操作者を取得できないときは運用管理の区分を出さない', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/auth/me', status: 500, body: { detail: 'サーバーでエラーが発生しました。' } },
    ])
    await page.goto('/')

    await expectGuardedSectionsHidden(page)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
  })

  test('[LAY-18] マスタ更新権限だけが無いとマスタメンテの区分だけが出ない', async ({ page }) => {
    // 全権限ありの管理責任者からマスタ更新権限だけを外す（運用管理は出たままになることで切り分ける）
    const noMasterOperator = {
      ...supervisorOperator,
      権限: { ...supervisorOperator.権限, master: false },
    }
    const masterSections = guardedSections.filter(
      (section) => section.requiredPermission === 'master',
    )
    const shownSections = navSections.filter((section) => section.requiredPermission !== 'master')
    // 区分の名前が変わったときに黙って空振りしないよう、対象が在ることを先に確かめる
    expect(masterSections.map((section) => section.label)).toContain('マスタメンテ')
    expect(shownSections.map((section) => section.label)).toContain('運用管理')

    await mockApi(page, [{ path: '*/api/auth/me', body: noMasterOperator }])
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    // 残る区分が描かれてから「無い」を見る（読み込み前の空振りで通らないように）
    for (const section of shownSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toBeVisible()
    }
    for (const section of masterSections) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toHaveCount(0)
      for (const item of section.items) {
        await expect(
          nav.getByRole('link', { name: item.label, exact: true, includeHidden: true }),
        ).toHaveCount(0)
      }
    }
    // 運用管理は既定で閉じているので、隠れたリンクも数える
    await expect(nav.getByRole('link', { includeHidden: true })).toHaveCount(
      shownSections.flatMap((section) => section.items).length,
    )
  })

  /*
   * 区分のアコーディオン。既定の開閉は LAY-01 が見る。
   * 各画面の「サイドメニューから開く」テストは helpers/sideMenu.js の clickSideMenuLink() で区分を開いてから押す。
   */
  test('[LAY-19] 閉じた区分の見出しを click すると開き、もう一度 click すると閉じる', async ({
    page,
  }) => {
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    const toggle = sectionToggle(page, 'マスタメンテ')
    const link = nav.getByRole('link', { name: '銘柄マスタ', exact: true, includeHidden: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(link).toBeHidden()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(link).toBeVisible()
    // 他の区分は巻き込まない
    await expect(sectionToggle(page, '運用管理')).toHaveAttribute('aria-expanded', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(link).toBeHidden()
  })

  test('[LAY-20] 閉じた区分の画面を直接開くとその区分が開いている', async ({ page }) => {
    await page.goto('/masters/symbols')

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await expect(sectionToggle(page, 'マスタメンテ')).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.getByRole('link', { name: '銘柄マスタ', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(sectionToggle(page, '運用管理')).toHaveAttribute('aria-expanded', 'false')
  })

  /*
   * 遷移の確定待ち（遅延 import のチャンク取得。src/composables/useRouteLoading.js）。
   * router の各フックの解除条件は単体側が持つので、ここでは「押した直後に反応が返るか」
   * 「読み終えたら消えるか」「後から押した方が勝つか」「マウスを載せると先読みするか」だけを見る。
   *
   * 遅延は page.route() で画面モジュールの取得を遅らせて作る。/src/** の import() は MSW の対象外で
   * ネットワークに出るので捕まえられる（API の ?mockDelay とは別物。API は MSW が横取りするので page.route が効かない）。
   * dev の URL は /src/views/CustomerSearchView.vue（HMR 後は ?t= が付く）。<style scoped> は同じ pathname に
   * ?vue&type=style を付けた別リクエストで、本体の評価中に取りに行く。遅らせるのは本体だけにし、
   * 「本体の応答が返った」= 「遅れていたチャンクが届いた」と読めるようにする。
   */
  const CUSTOMER_SEARCH_MODULE = '/src/views/CustomerSearchView.vue'
  const isCustomerSearchModule = (url) =>
    url.pathname.endsWith(CUSTOMER_SEARCH_MODULE) && !url.searchParams.has('type')

  /** 顧客検索の画面モジュールの取得を delayMs 遅らせる。page.goto() の後・click の前に仕掛ける */
  async function delayCustomerSearchModule(page, delayMs) {
    await page.route(isCustomerSearchModule, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      await route.continue()
    })
  }

  test('[LAY-21] 画面の読み込み中はバーと押した項目の回転マークが出て、読み終えると消える', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()

    await delayCustomerSearchModule(page, 1500)

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    const link = nav.getByRole('link', { name: '顧客検索', exact: true })
    const loading = page.getByTestId('route-loading')
    await link.click()

    // 押した直後の反応（読み込み中は URL も見出しも現在ページも動かない）
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('画面を読み込んでいます')
    await expect(link.locator('.base-spinner')).toBeVisible()
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0)

    // 読み終えると遷移が確定し、読み込み中の表示が全部消える
    await expect(page).toHaveURL(/\/customers\/search$/)
    await expect(page.getByRole('heading', { name: '顧客検索', exact: true })).toBeVisible()
    await expect(loading).toHaveCount(0)
    await expect(link.locator('.base-spinner')).toHaveCount(0)
    await expect(page.getByRole('main')).not.toHaveAttribute('aria-busy', 'true')
    await expect(link).toHaveAttribute('aria-current', 'page')
  })

  test('[LAY-22] 読み込み中に別の項目を押すと後から押した方が勝つ', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()

    await delayCustomerSearchModule(page, 1500)
    // 遅れていたチャンクが届いたことを「本体の応答が返った」で知る（固定 sleep の代わり）
    const delayedModuleArrived = page.waitForResponse((response) =>
      isCustomerSearchModule(new URL(response.url())),
    )

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    const loading = page.getByTestId('route-loading')
    await nav.getByRole('link', { name: '顧客検索', exact: true }).click()
    await expect(loading).toBeVisible()

    await nav.getByRole('link', { name: '注文照会', exact: true }).click()

    await expect(page).toHaveURL(/\/orders\/inquiry$/)
    await expect(page.getByRole('heading', { name: '注文照会', exact: true })).toBeVisible()
    await expect(loading).toHaveCount(0)

    // 遅れていた顧客検索が届いても追い越されたままで、表示も戻らない
    await delayedModuleArrived
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/orders\/inquiry$/)
    await expect(page.getByRole('heading', { name: '注文照会', exact: true })).toBeVisible()
    await expect(loading).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '注文照会', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
  })

  test('[LAY-23] メニューの項目にマウスを載せると画面を先読みする', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()

    // hover より前に仕掛ける（後からだと取り逃す）
    const prefetched = page.waitForRequest((request) =>
      isCustomerSearchModule(new URL(request.url())),
    )

    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    await nav.getByRole('link', { name: '顧客検索', exact: true }).hover()

    await prefetched
    // 先読みだけで遷移はしない
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0)
  })

  /*
   * ヘッダ直下の運用バナー（AppOperationBanner / GET /operations/banner）。
   * 既定モックはお知らせの現在値（fixtures/announcements.js の announcement）から NOTICE を組み立てるので、
   * どの画面でも帯が出る。ここでは / を開くだけで、画面の中身は見ない。
   * 保存での追随はお知らせ管理（AN-20 / AN-21）、定期の取り直しと閉じた状態の判定は単体側が持つ。
   */
  const bannerOf = (page) => page.getByTestId('operation-banner')
  const NOTICE_MESSAGE = announcement.本文

  test('[LAY-27] 既定ではヘッダ直下にお知らせの帯が出て閉じるボタンがある', async ({ page }) => {
    await page.goto('/')

    const banner = bannerOf(page)
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('data-kind', 'NOTICE')
    await expect(banner.getByTestId('operation-banner-label')).toHaveText('お知らせ')
    await expect(banner.getByTestId('operation-banner-message')).toHaveText(NOTICE_MESSAGE)
    await expect(banner.getByRole('button', { name: 'お知らせを閉じる' })).toBeVisible()
  })

  test('[LAY-28] お知らせの帯を閉じると消え、再読み込みしても同じ本文は出ない', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(bannerOf(page)).toBeVisible()

    await bannerOf(page).getByRole('button', { name: 'お知らせを閉じる' }).click()
    await expect(bannerOf(page)).toHaveCount(0)

    await page.reload()

    // 再読み込み後に画面が組み上がってから「無い」を見る（読み込み前の空振りで通らないように）
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(bannerOf(page)).toHaveCount(0)
  })

  test('[LAY-29] 発注停止中は閉じられない警告の帯に停止対象が出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/operations/banner', body: incidentBannerResponse }])
    await page.goto('/')

    const banner = bannerOf(page)
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('data-kind', 'INCIDENT')
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner.getByTestId('operation-banner-label')).toHaveText('発注停止中')
    await expect(banner.getByTestId('operation-banner-message')).toHaveText(
      incidentBannerResponse.メッセージ,
    )
    await expect(banner.getByTestId('operation-banner-targets')).toHaveText(
      `停止対象: ${incidentBannerResponse.停止中の対象名.join('、')}`,
    )
    await expect(banner.getByRole('button', { name: 'お知らせを閉じる' })).toHaveCount(0)
  })

  test('[LAY-30] お知らせも発注停止も無いときは帯を出さない', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/operations/banner', body: noneBannerResponse }])
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible()
    await expect(bannerOf(page)).toHaveCount(0)
  })

  /*
   * サイドメニューの件数（navigation.js の badge）。出どころは
   *   注文エラー      … GET /orders?status=101,103 の total（src/mocks/handlers/orders.js が処理状況で絞る）
   *   Dream登録エラー … GET /orders/dream-status?dream_status=ERROR の total（handlers/dreamStatus.js が 9 / C9 で絞る）
   * mockApi() は path で当てるので、*\/api/orders を差し替えると注文照会の一覧も同じ応答になる。
   * 件数だけを見たいので、注文照会以外の画面（顧客検索）を開く。STS変更での取り直しは DS-23 が見る。
   */
  const BADGE_PAGE = '/customers/search'
  const ORDER_ERROR_COUNT = orderInquiryRows.filter((row) =>
    ['101', '103'].includes(row.処理状況),
  ).length
  const DREAM_ERROR_COUNT = dreamOrders.filter(
    (row) => row.Dream状況 === '9' || row.Dream状況 === 'C9',
  ).length
  const badgeItems = navItems.filter((item) => item.badge)
  const badgeOf = (page, key) => page.getByTestId(`sidebar-badge-${key}`)

  /** 件数の 2 本を同じ応答に差し替える */
  function mockBadgeApis(override) {
    return ['*/api/orders', '*/api/orders/dream-status'].map((path) => ({ path, ...override }))
  }

  /** 顧客検索を開き、件数の付く 2 項目が描かれるまで待つ（読み込み前の空振りで「出ない」が通らないように） */
  async function openBadgePage(page) {
    await page.goto(BADGE_PAGE)
    await expect(page.getByRole('heading', { name: '顧客検索', exact: true })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'メインメニュー' })
    for (const item of badgeItems) {
      await expect(nav.getByRole('link', { name: item.label, exact: true })).toBeVisible()
    }
    return nav
  }

  test('[LAY-24] 注文照会と Dream登録状況にエラーの件数が出る', async ({ page }) => {
    // 件数の付く項目が 2 つあり、既定モックに両方のエラーが在ることを先に確かめる
    expect(badgeItems.map((item) => [item.label, item.badge.key])).toEqual([
      ['注文照会', 'orderErrors'],
      ['Dream登録状況', 'dreamErrors'],
    ])
    expect(ORDER_ERROR_COUNT).toBeGreaterThan(0)
    expect(DREAM_ERROR_COUNT).toBeGreaterThan(0)
    const expected = { orderErrors: ORDER_ERROR_COUNT, dreamErrors: DREAM_ERROR_COUNT }

    const nav = await openBadgePage(page)

    for (const item of badgeItems) {
      const count = expected[item.badge.key]
      // リンク名はラベルのまま（exact で当たる）で、件数は数字だけ・読み上げは説明文で添える
      const link = nav.getByRole('link', { name: item.label, exact: true })
      await expect(link.getByTestId(`sidebar-badge-${item.badge.key}`)).toHaveText(String(count))
      await expect(link).toHaveAccessibleDescription(`${item.badge.label} ${count} 件`)
    }
    // ほかの項目には件数が出ない
    await expect(nav.locator('[data-testid^="sidebar-badge-"]')).toHaveCount(badgeItems.length)
  })

  test('[LAY-25] 件数が 0 のときは何も出さない', async ({ page }) => {
    await mockApi(
      page,
      mockBadgeApis({ body: { total: 0, limit: 1, offset: 0, orders: [], items: [] } }),
    )
    const nav = await openBadgePage(page)

    for (const item of badgeItems) {
      await expect(badgeOf(page, item.badge.key)).toHaveCount(0)
      await expect(nav.getByRole('link', { name: item.label, exact: true })).not.toHaveAttribute(
        'aria-describedby',
        /.+/,
      )
    }
  })

  test('[LAY-26] 件数の取得に失敗しても何も出さず画面は使える', async ({ page }) => {
    await mockApi(
      page,
      mockBadgeApis({ status: 500, body: { detail: 'サーバーでエラーが発生しました。' } }),
    )
    const nav = await openBadgePage(page)

    for (const item of badgeItems) {
      await expect(badgeOf(page, item.badge.key)).toHaveCount(0)
    }
    await expect(page.getByText('サーバーでエラーが発生しました。')).toHaveCount(0)

    await nav.getByRole('link', { name: TARGET_LABEL, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${TARGET_PATH}$`))
    await expect(page.getByRole('heading', { name: TARGET_LABEL, exact: true })).toBeVisible()
  })
})
