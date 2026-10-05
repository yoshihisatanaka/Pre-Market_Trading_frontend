import { expect, test } from '@playwright/test'
import { navSections } from '../src/components/layout/navigation'
import { assertRealApi, skipUnlessRealApi } from './helpers/realApi.js'
import { sideMenu } from './helpers/sideMenu'

/*
 * アクセス制御（権限の要るルート・サイドメニューの区分・発注権限の導線）を「実 API に当てて」確かめる E2E。
 * シナリオ: docs/e2e/access-control-real-api.md（タイトル先頭の [ACR-xx] が対応 ID）
 *
 * access-control.spec.js（AC）とは目的が違う。AC は MSW のモックで /auth/me を差し替えて
 * 権限なし・500 の経路を固定する。こちらは実 API の GET /auth/me の応答の形と、フロントの出し分けの
 * 噛み合わせだけを見る。操作者は .env の VITE_USER_CODE で決まりテストからは変えられないので、
 * 期待値に**権限の値を書かない**（ブラウザ自身が受け取った応答の 権限.* から導く）。
 *
 * 既定では丸ごとスキップする。実 API に当てるときだけ次の 2 つをそろえて実行する。
 *   1. 環境変数 VITE_ENABLE_MSW を false にして frontend を作り直す
 *   2. バックエンドの api を起動しておく
 *   docker compose run --rm -e E2E_REAL_API=1 e2e npx playwright test access-control.real-api
 *
 * 実 DB には書き込まない（GET だけ）。
 */

const AUTH_ME_PATH = '/api/auth/me'

// openapi.json の CurrentOperatorResponse の required と、PermissionFlags の 4 つ
const REQUIRED_KEYS = ['操作者コード', '登録済', '権限', '認可強制']
const PERMISSION_FLAGS = ['order', 'master', 'operation', 'branch_all']

// ForbiddenView.vue の文言と、router/index.js の /forbidden の meta.title
const FORBIDDEN_TITLE = 'アクセス権限がありません'
const FORBIDDEN_MESSAGE = 'この画面を開く権限がありません。'

/*
 * 権限の要るルート。src/router/index.js の meta.requiredPermission と同じ
 * （router は views を辿るので import せず、メニュー定義と再掲で組む）。
 * マスタメンテ / 運用管理の path と見出しは navigation.js の区分から取る（meta.title と同じ文言）。
 * 注文訂正・取消はメニューに無いので title ごと再掲する。:orderId は数字なら何でもガードは走る。
 */
const sectionOf = (label) => navSections.find((section) => section.label === label)
const routesOf = (label, permission) =>
  sectionOf(label).items.map((item) => ({ path: item.to, title: item.label, permission }))

const ORDER_ID = '1'
const GUARDED_ROUTES = [
  ...routesOf('マスタメンテ', 'master'),
  ...routesOf('運用管理', 'operation'),
  { path: `/orders/${ORDER_ID}/amend`, title: '外株注文訂正', permission: 'order' },
  { path: `/orders/${ORDER_ID}/cancel`, title: '注文取消', permission: 'order' },
]

/** navigation.js の requiredPermission が付いた区分と、付いていない区分 */
const GUARDED_SECTIONS = navSections.filter((section) => section.requiredPermission)
const OPEN_SECTIONS = navSections.filter((section) => !section.requiredPermission)

/**
 * 画面を開き、ブラウザ自身が受け取った GET /auth/me の応答（生の形）を返す。
 * /auth/me は起動時に main.js が引くので、goto の前から待ち受ける。
 */
async function openAndCaptureMe(page, path) {
  const me = page.waitForResponse((res) => new URL(res.url()).pathname === AUTH_ME_PATH)
  await page.goto(path)
  const res = await me
  await assertRealApi(page)
  expect(res.ok(), `${AUTH_ME_PATH} が ${res.status()} を返した: ${await res.text()}`).toBe(true)
  return { res, body: await res.json() }
}

/** 応答の 権限.<flag> を真偽値で読む（api 層と同じく、無ければ false） */
const can = (body, flag) => Boolean(body?.権限?.[flag])

test.describe('アクセス制御（実 API 接続）', () => {
  skipUnlessRealApi(test)

  test('[ACR-01] 起動時に GET /auth/me が実 API から 200 で返り、応答が仕様の形になっている', async ({
    page,
  }) => {
    const { res, body } = await openAndCaptureMe(page, '/')

    // VITE_USER_CODE が空だとヘッダが飛ばず、実 API は未登録（全権限なし）として返す
    const headers = await res.request().allHeaders()
    expect(
      headers['x-user-code'],
      'X-User-Code が送られていない。.env の VITE_USER_CODE が未設定のまま frontend が動いている',
    ).toBeTruthy()

    for (const key of REQUIRED_KEYS) {
      expect(body, `応答に ${key} が無い`).toHaveProperty(key)
    }
    for (const flag of PERMISSION_FLAGS) {
      expect(typeof body.権限[flag], `権限.${flag} が真偽値でない`).toBe('boolean')
    }
    expect(typeof body.登録済).toBe('boolean')
    expect(typeof body.認可強制).toBe('boolean')

    // 権限の要らない画面は応答の中身に関わらず開ける
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: '注文一覧', exact: true })).toBeVisible()
    await expect(page.getByTestId('forbidden')).toHaveCount(0)
  })

  test('[ACR-02] 権限の要るルートが /auth/me の権限フラグどおりに開ける / 権限なしの画面に回される', async ({
    page,
  }) => {
    test.slow() // 15 画面を読み込み直す
    // 再掲した区分がメニュー定義から外れていない（改名・移動に気づくため）
    expect(GUARDED_ROUTES.filter((route) => route.permission === 'master')).toHaveLength(9)
    expect(GUARDED_ROUTES.filter((route) => route.permission === 'operation')).toHaveLength(4)

    const { body } = await openAndCaptureMe(page, '/')

    for (const route of GUARDED_ROUTES) {
      // ページを読み込み直すたびに /auth/me は引き直されるが、同じ操作者なので結論は変わらない
      await page.goto(route.path)

      if (can(body, route.permission)) {
        await expect(page, `${route.path} は 権限.${route.permission} が真なのに開けない`).toHaveURL(
          new RegExp(`${route.path}$`),
        )
        await expect(page.getByRole('heading', { name: route.title, exact: true })).toBeVisible()
        await expect(page.getByTestId('forbidden')).toHaveCount(0)
      } else {
        await expect(page, `${route.path} は 権限.${route.permission} が偽なのに開けた`).toHaveURL(
          /\/forbidden$/,
        )
        await expect(page.getByRole('heading', { name: FORBIDDEN_TITLE, exact: true })).toBeVisible()
        await expect(page.getByTestId('forbidden-message')).toHaveText(FORBIDDEN_MESSAGE)
        // 「確認できなかった」は /auth/me が読めなかったときの文言。200 で返っているので出ない
        await expect(page.getByTestId('forbidden-check-failed')).toHaveCount(0)
        await expect(page.getByRole('heading', { name: route.title, exact: true })).toHaveCount(0)
      }
    }
  })

  test('[ACR-03] サイドメニューの区分が /auth/me の権限フラグどおりに出し分けられる', async ({
    page,
  }) => {
    // 区分の名前が変わったときに黙って空振りしないよう、対象が在ることを先に確かめる
    expect(GUARDED_SECTIONS.map((section) => section.label)).toEqual(['マスタメンテ', '運用管理'])

    const { body } = await openAndCaptureMe(page, '/')
    const nav = sideMenu(page)

    // 権限の要らない区分が描かれてから「無い」を見る（読み込み前の空振りで通らないように）
    for (const section of OPEN_SECTIONS) {
      await expect(nav.getByRole('heading', { name: section.label, exact: true })).toBeVisible()
    }

    for (const section of GUARDED_SECTIONS) {
      const heading = nav.getByRole('heading', { name: section.label, exact: true })
      if (can(body, section.requiredPermission)) {
        await expect(heading, `「${section.label}」が出ない`).toBeVisible()
        // 区分は既定で畳まれているので、隠れたリンクも数える
        for (const item of section.items) {
          await expect(
            nav.getByRole('link', { name: item.label, exact: true, includeHidden: true }),
          ).toHaveCount(1)
        }
      } else {
        await expect(heading, `「${section.label}」が権限なしなのに出ている`).toHaveCount(0)
        for (const item of section.items) {
          await expect(
            nav.getByRole('link', { name: item.label, exact: true, includeHidden: true }),
          ).toHaveCount(0)
        }
      }
    }
  })

  test('[ACR-04] 注文照会の「新規注文」が /auth/me の発注権限で出し分けられる', async ({ page }) => {
    const { body } = await openAndCaptureMe(page, '/orders/inquiry')

    // どちらかが必ず出る（操作者を読み終える前はどちらも出ない）。testid は OrderInquiryListView.vue
    const newOrder = page.getByTestId('order-inquiry-new-order')
    const noPermission = page.getByTestId('order-inquiry-no-permission')
    await expect(newOrder.or(noPermission)).toBeVisible()

    if (can(body, 'order')) {
      await expect(newOrder).toBeVisible()
      await expect(noPermission).toHaveCount(0)
    } else {
      await expect(noPermission).toHaveText('発注権限なし')
      await expect(newOrder).toHaveCount(0)
    }
  })
})
