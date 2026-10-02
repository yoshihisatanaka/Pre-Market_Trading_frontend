/**
 * サイドメニュー（AppSidebar）の項目を click する道具。
 *
 * 区分はアコーディオンで、マスタメンテ / 運用管理 は既定で閉じている（navigation.js の defaultOpen）。
 * 閉じた区分のリンクは見えないので、そのまま click すると可触判定で止まる。
 * ここでは項目の属する区分を navigation.js から引き、閉じていれば見出しを押して開いてから click する。
 */
import { navSections } from '../../src/components/layout/navigation'

export const sideMenu = (page) => page.getByRole('navigation', { name: 'メインメニュー' })

/** 区分の見出しボタン（開閉の状態は aria-expanded に出る） */
export const sectionToggle = (page, sectionLabel) =>
  sideMenu(page).getByRole('button', { name: sectionLabel, exact: true })

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label メニュー項目のラベル（navigation.js の items[].label）
 */
export async function clickSideMenuLink(page, label) {
  const section = navSections.find((s) => s.items.some((item) => item.label === label))
  if (!section) throw new Error(`サイドメニューに「${label}」がありません（navigation.js を確認）`)

  // 権限の要る区分は /auth/me を読み終えてから現れる。getAttribute は現れるまで待つ
  const toggle = sectionToggle(page, section.label)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()

  await sideMenu(page).getByRole('link', { name: label, exact: true }).click()
}
