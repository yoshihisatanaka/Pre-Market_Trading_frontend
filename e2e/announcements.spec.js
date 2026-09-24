import { expect, test } from '@playwright/test'
import { announcement, announcementHistories } from '../src/mocks/fixtures/announcements'
import { incidentBannerResponse } from '../src/mocks/fixtures/banner'
import { mockApi } from './helpers/mockApi'

// シナリオ: docs/e2e/announcements.md（タイトル先頭の [AN-xx] が対応 ID）
// お知らせは全画面共通の 1 行だけ。現在値の編集フォームと操作履歴の表の 2 段構成なので、
// 本体・履歴の 4 状態を別々に見て、保存（表示 / 非表示 / 本文変更 / 変更なし / 拒否）の結果を実ブラウザで守る。
// 既定モックは保存内容を保持する（現在値の置き換えと履歴の先頭への 1 行追加）。
// mockApi() は固定の body を返すだけで limit / offset を解釈しないので、履歴のページングは既定ハンドラで見る。

const PATH = '/operations/announcements'

// src/stores/announcements.js の ANNOUNCEMENT_HISTORY_PAGE_SIZE と同じ値。
// ストアは import.meta.env を辿る api/client.js に依存しており Playwright からは import できない。
const PAGE_SIZE = 50

const HISTORY_TOTAL = announcementHistories.length
const secondPage = announcementHistories.slice(PAGE_SIZE)

// フィクスチャはバックエンドの生の形（日本語キー）。現在の本文と最新の履歴はここから導く
const CURRENT_MESSAGE = announcement.本文
const latestHistory = announcementHistories[0]

const NEW_MESSAGE = '本日は米国市場の祝日のため、発注は翌営業日の扱いになります。（E2E）'

// 成功文言は既定ハンドラ（src/mocks/handlers/announcements.js の MESSAGES）が返す AnnouncementActionResponse.message
const NOTICE_UPDATE = 'お知らせを更新しました。'
const NOTICE_SHOW = 'お知らせを表示しました。'
const NOTICE_HIDE = 'お知らせを非表示にしました。'
const NOTICE_UNCHANGED = '変更はありません。'

const SERVER_ERROR = 'サーバーでエラーが発生しました。'

/** ページ送りの件数表示（BasePagination の rangeLabel と同じ形） */
function rangeText(total, first, last) {
  return `${total} 件中 ${first}–${last} 件`
}

/** 履歴の行。data-table-row は全画面共通の名前なので履歴の表にスコープを切る */
function historyRowsOf(page) {
  return page.getByTestId('announcements-history-table').getByTestId('data-table-row')
}

function historyRangeOf(page) {
  return page.getByTestId('announcements-history-pagination').getByTestId('pagination-range')
}

/** 画面を開き、編集フォームと履歴が描画されるまで待つ */
async function openLoaded(page) {
  await page.goto(PATH)
  await expect(page.getByTestId('announcements-form')).toBeVisible()
  await expect(historyRowsOf(page)).toHaveCount(PAGE_SIZE)
}

test.describe('お知らせ管理 表示', () => {
  test('[AN-01] サイドメニューから開くと現在のお知らせと履歴が表示される', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('navigation', { name: 'メインメニュー' })
      .getByRole('link', { name: 'お知らせ管理', exact: true })
      .click()

    await expect(page).toHaveURL(new RegExp(`${PATH}$`))
    await expect(page.getByRole('heading', { name: 'お知らせ管理', exact: true })).toBeVisible()
    // 画面固有の操作がヘッダ（#topbar-actions）へ差し込まれている
    await expect(page.getByTestId('announcements-reload')).toBeVisible()

    await expect(page.getByTestId('announcements-status')).toContainText('通常運用')
    await expect(page.getByTestId('announcements-suspended')).toHaveCount(0)

    await expect(page.getByTestId('announcements-enabled')).toBeChecked()
    await expect(page.getByTestId('announcements-message')).toHaveValue(CURRENT_MESSAGE)

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(PAGE_SIZE)
    await expect(rows.first()).toContainText(latestHistory.操作区分名)
    await expect(rows.first()).toContainText(CURRENT_MESSAGE)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL, 1, PAGE_SIZE))
  })

  test('[AN-02] お知らせの取得が失敗するとエラーと再試行ボタンが出て履歴は残る', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/operations/announcements', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('announcements-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('announcements-form')).toHaveCount(0)

    // 履歴は別の API なので巻き添えにならない
    await expect(historyRowsOf(page)).toHaveCount(PAGE_SIZE)
  })

  test('[AN-03] お知らせが空の応答だと未登録の表示になる', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/operations/announcements', body: null }])
    await page.goto(PATH)

    const empty = page.getByTestId('announcements-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('お知らせが登録されていません。')
    await expect(page.getByTestId('announcements-form')).toHaveCount(0)
  })

  test('[AN-04] 履歴の取得が失敗すると履歴だけエラーになり編集はできる', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/operations/announcements/history', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await page.goto(PATH)

    const error = page.getByTestId('announcements-history-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText(SERVER_ERROR)
    await expect(error.getByRole('button', { name: '再試行' })).toBeVisible()
    await expect(page.getByTestId('announcements-history-table')).toHaveCount(0)
    await expect(page.getByTestId('announcements-history-pagination')).toHaveCount(0)

    await expect(page.getByTestId('announcements-form')).toBeVisible()
    await expect(page.getByTestId('announcements-message')).toHaveValue(CURRENT_MESSAGE)
  })

  test('[AN-05] 履歴が 0 件のとき空状態が表示される', async ({ page }) => {
    await mockApi(page, [
      {
        path: '*/api/operations/announcements/history',
        body: { total: 0, limit: PAGE_SIZE, offset: 0, histories: [] },
      },
    ])
    await page.goto(PATH)

    const empty = page.getByTestId('announcements-history-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('お知らせ履歴はありません。')
    await expect(page.getByTestId('announcements-history-table')).toHaveCount(0)
    await expect(page.getByTestId('announcements-history-pagination')).toHaveCount(0)
  })
})

test.describe('お知らせ管理 保存', () => {
  test('[AN-06] 本文だけ変更して保存すると更新され履歴が 1 件増える', async ({ page }) => {
    await openLoaded(page)

    await page.getByTestId('announcements-message').fill(NEW_MESSAGE)
    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_UPDATE)

    const first = historyRowsOf(page).first()
    await expect(first).toContainText('本文変更')
    await expect(first).toContainText(NEW_MESSAGE)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL + 1, 1, PAGE_SIZE))
  })

  test('[AN-07] チェックを外して保存すると非表示になり履歴が 1 件増える', async ({ page }) => {
    await openLoaded(page)

    await page.getByTestId('announcements-enabled').uncheck()
    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_HIDE)
    // 入力欄は保存後の現在値で洗い替わる。解除しても本文は消さない
    await expect(page.getByTestId('announcements-enabled')).not.toBeChecked()
    await expect(page.getByTestId('announcements-message')).toHaveValue(CURRENT_MESSAGE)

    await expect(historyRowsOf(page).first()).toContainText('非表示')
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL + 1, 1, PAGE_SIZE))
  })

  test('[AN-08] 非表示の状態からチェックを入れて保存すると表示になる', async ({ page }) => {
    await openLoaded(page)

    // 既定モックは表示 ON なので、いったん非表示にしてから始める
    await page.getByTestId('announcements-enabled').uncheck()
    await page.getByTestId('announcements-save').click()
    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_HIDE)

    await page.getByTestId('announcements-enabled').check()
    await page.getByTestId('announcements-message').fill(NEW_MESSAGE)
    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_SHOW)

    const first = historyRowsOf(page).first()
    await expect(first).toContainText('表示')
    await expect(first).not.toContainText('非表示')
    await expect(first).toContainText(NEW_MESSAGE)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL + 2, 1, PAGE_SIZE))
  })

  test('[AN-09] 何も変えずに保存すると「変更はありません。」で履歴は増えない', async ({ page }) => {
    await openLoaded(page)

    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_UNCHANGED)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL, 1, PAGE_SIZE))
    await expect(historyRowsOf(page).first()).toContainText(CURRENT_MESSAGE)
  })

  test('[AN-10] 表示 ON のまま本文を空白だけにすると画面で止まり保存されない', async ({ page }) => {
    await openLoaded(page)

    // 画面の検査は trim して空かを見る。完全な空文字は AN-18
    await page.getByTestId('announcements-message').fill('   ')
    await page.getByTestId('announcements-save').click()

    await expect(
      page.getByTestId('announcements-form').getByText('お知らせを表示するには本文を入力してください。'),
    ).toBeVisible()
    await expect(page.getByTestId('announcements-notice')).toHaveCount(0)
    await expect(page.getByTestId('announcements-save-error')).toHaveCount(0)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL, 1, PAGE_SIZE))
  })

  test('[AN-18] 表示 ON のまま本文を完全に空にすると画面の文言で止まり保存されない', async ({ page }) => {
    await openLoaded(page)

    await page.getByTestId('announcements-message').fill('')
    await page.getByTestId('announcements-save').click()

    // フォームは novalidate なので、ブラウザ標準の検証ではなく画面の検査が止める
    await expect(
      page.getByTestId('announcements-form').getByText('お知らせを表示するには本文を入力してください。'),
    ).toBeVisible()
    await expect(page.getByTestId('announcements-notice')).toHaveCount(0)
    await expect(page.getByTestId('announcements-save-error')).toHaveCount(0)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL, 1, PAGE_SIZE))
  })
})

// サーバの拒否（AN-11〜13）。画面からは起こせない応答も含むので、PUT の応答を差し替えて理由の出し先だけを見る
// check:scenarios はタイトルを静的に読むので、ID はテンプレートリテラルで組み立てずに書く
test.describe('お知らせ管理 サーバの拒否', () => {
  /** PUT を status / body で拒否させ、本文を書き換えて保存し、理由がフォーム先頭に出て入力が残ることを見る */
  async function expectRejected(page, { status, body, expected }) {
    await mockApi(page, [{ method: 'put', path: '*/api/operations/announcements', status, body }])
    await openLoaded(page)

    await page.getByTestId('announcements-message').fill(NEW_MESSAGE)
    await page.getByTestId('announcements-save').click()

    const saveError = page.getByTestId('announcements-save-error')
    await expect(saveError).toBeVisible()
    await expect(saveError).toContainText(expected)

    // 失敗時は入力を残して直させる
    await expect(page.getByTestId('announcements-message')).toHaveValue(NEW_MESSAGE)
    await expect(page.getByTestId('announcements-notice')).toHaveCount(0)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL, 1, PAGE_SIZE))
  }

  test('[AN-11] 更新 API が 400 を返すとサーバの理由がフォーム先頭に出る', async ({ page }) => {
    const reason = 'お知らせを表示する場合は本文を入力してください。'
    await expectRejected(page, { status: 400, body: { detail: reason }, expected: reason })
  })

  test('[AN-12] 更新 API が 422 を返すと項目名付きの理由がフォーム先頭に出る', async ({ page }) => {
    await expectRejected(page, {
      status: 422,
      body: {
        detail: [
          { loc: ['body', '本文'], msg: '500文字以内で入力してください', type: 'string_too_long' },
        ],
      },
      // client.js は loc の末尾（項目名）を理由の前に付ける
      expected: '本文: 500文字以内で入力してください',
    })
  })

  test('[AN-13] 更新 API が 409 を返すと競合の理由がフォーム先頭に出る', async ({ page }) => {
    const reason = '他のユーザーによってお知らせが更新されました。最新情報を再取得してください。'
    await expectRejected(page, { status: 409, body: { detail: reason }, expected: reason })
  })
})

test.describe('お知らせ管理 履歴のページング', () => {
  test('[AN-14] 「次のページ」を押すと履歴の 2 ページ目が表示される', async ({ page }) => {
    await openLoaded(page)

    const pagination = page.getByTestId('announcements-history-pagination')
    await pagination.getByRole('button', { name: '次のページ' }).click()

    const rows = historyRowsOf(page)
    await expect(rows).toHaveCount(secondPage.length)
    await expect(rows.first()).toContainText(secondPage[0].操作区分名)
    await expect(historyRangeOf(page)).toHaveText(
      rangeText(HISTORY_TOTAL, PAGE_SIZE + 1, HISTORY_TOTAL),
    )
    await expect(pagination.getByRole('button', { name: '2', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('[AN-15] 2 ページ目を見ているときに保存すると先頭ページへ戻る', async ({ page }) => {
    await openLoaded(page)

    await page
      .getByTestId('announcements-history-pagination')
      .getByRole('button', { name: '次のページ' })
      .click()
    await expect(historyRowsOf(page)).toHaveCount(secondPage.length)

    await page.getByTestId('announcements-message').fill(NEW_MESSAGE)
    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_UPDATE)
    await expect(historyRangeOf(page)).toHaveText(rangeText(HISTORY_TOTAL + 1, 1, PAGE_SIZE))
    await expect(historyRowsOf(page)).toHaveCount(PAGE_SIZE)
    await expect(historyRowsOf(page).first()).toContainText(NEW_MESSAGE)
  })
})

test.describe('お知らせ管理 運用状態', () => {
  test('[AN-16] 発注停止中なら運用状態が「発注停止中」になり警告が出る', async ({ page }) => {
    await mockApi(page, [{ path: '*/api/operations/banner', body: incidentBannerResponse }])
    await openLoaded(page)

    await expect(page.getByTestId('announcements-status')).toContainText('発注停止中')

    const suspended = page.getByTestId('announcements-suspended')
    await expect(suspended).toBeVisible()
    await expect(suspended).toContainText('現在は発注停止中です。')

    // 停止中でもお知らせの編集は止めない
    await expect(page.getByTestId('announcements-save')).toBeEnabled()
  })

  test('[AN-17] バナーの取得が失敗しても運用状態が「—」になるだけで保存できる', async ({ page }) => {
    await mockApi(page, [
      { path: '*/api/operations/banner', status: 500, body: { detail: SERVER_ERROR } },
    ])
    await openLoaded(page)

    await expect(page.getByTestId('announcements-status')).toContainText('—')
    await expect(page.getByTestId('announcements-status')).not.toContainText('通常運用')
    await expect(page.getByTestId('announcements-suspended')).toHaveCount(0)

    await page.getByTestId('announcements-message').fill(NEW_MESSAGE)
    await page.getByTestId('announcements-save').click()

    await expect(page.getByTestId('announcements-notice')).toHaveText(NOTICE_UPDATE)
  })
})
