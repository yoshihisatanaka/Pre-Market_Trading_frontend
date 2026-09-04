import { expect, test } from '@playwright/test'

// シナリオ: docs/e2e/ui-catalog.md（タイトル先頭の [UC-xx] が対応 ID）
// 開発用の部品カタログ。部品ごとの振る舞いは単体テスト側で見るので、ここは開けることだけを確かめる。
test.describe('UI カタログ', () => {
  test('[UC-01] 各節の部品が一通り表示される', async ({ page }) => {
    await page.goto('/dev/ui-catalog')

    await expect(page.getByRole('heading', { name: 'UI カタログ' })).toBeVisible()

    for (const section of [
      'ボタン',
      '入力（boxed）― 検索カード / モーダルの様式',
      '入力（underline）― 注文入力画面の様式',
      'ファイル取込み',
      '通知とチップ',
      'カードとダイアログ',
    ]) {
      await expect(page.getByText(section, { exact: true })).toBeVisible()
    }

    await expect(page.getByRole('button', { name: '買い' })).toBeVisible()
    await expect(page.getByLabel('口座番号')).toBeVisible()
  })

  test('[UC-02] 削除確認ダイアログを開いて閉じられる', async ({ page }) => {
    await page.goto('/dev/ui-catalog')

    await page.getByRole('button', { name: '削除確認を開く' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('削除しますか？')

    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(dialog).toBeHidden()
  })
})
