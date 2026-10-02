import { describe, expect, it } from 'vitest'
import { navSections } from '@/components/layout/navigation'
import { routes } from './index'

/*
 * ルート定義（router/index.js の routes）の検査。ガードの挙動（権限の有無で forbidden へ回すか）は
 * permissionGuard.spec.js（PMG）が見るので、ここでは meta.requiredPermission の付け方だけを見る。
 * 運用管理の 4 ルートの権限は PMG-05 が見ている。
 */

const pathsOf = (list) => list.map((route) => route.path)
const routeAt = (path) => routes.find((route) => route.path === path)

// シナリオ: docs/unit/router-index.md
describe('router/index の routes', () => {
  it('[RTR-01] /masters/ 配下の全ルートがマスタ権限を要求する', () => {
    const masterRoutes = routes.filter((route) => route.path.startsWith('/masters/'))

    expect(masterRoutes.length).toBeGreaterThan(0)
    for (const route of masterRoutes) {
      expect(route.meta?.requiredPermission, route.path).toBe('master')
    }
  })

  it('[RTR-02] マスタ権限を要求するのは /masters/ 配下のルートだけ', () => {
    const requiringMaster = routes.filter((route) => route.meta?.requiredPermission === 'master')

    for (const path of pathsOf(requiringMaster)) {
      expect(path.startsWith('/masters/'), path).toBe(true)
    }
  })

  it('[RTR-03] 権限の要る区分のリンク先は、区分と同じ権限をルートの meta に持つ', () => {
    const guardedSections = navSections.filter((section) => section.requiredPermission)
    expect(guardedSections.length).toBeGreaterThan(0)

    for (const section of guardedSections) {
      // ルートの無い項目（未実装の画面）は NotFound に落ちるだけなので対象外
      const linked = section.items.map((item) => routeAt(item.to)).filter(Boolean)
      expect(linked.length, section.label).toBeGreaterThan(0)
      for (const route of linked) {
        expect(route.meta?.requiredPermission, route.path).toBe(section.requiredPermission)
      }

      // 逆向き: その権限を要求するルートは、すべてその区分に載っている（メニューから辿れない制限を作らない）
      const requiring = routes.filter(
        (route) => route.meta?.requiredPermission === section.requiredPermission,
      )
      expect(new Set(pathsOf(requiring))).toEqual(new Set(pathsOf(linked)))
    }
  })

  it('[RTR-04] 権限の要らない区分のリンク先は権限を要求しない', () => {
    const openItems = navSections
      .filter((section) => !section.requiredPermission)
      .flatMap((section) => section.items)
    const linked = openItems.map((item) => routeAt(item.to)).filter(Boolean)
    expect(linked.length).toBeGreaterThan(0)

    for (const route of linked) {
      expect(route.meta?.requiredPermission, route.path).toBeUndefined()
    }
  })

  it('[RTR-05] 回し先の forbidden と NotFound は権限を要求しない', () => {
    const forbidden = routes.find((route) => route.name === 'forbidden')
    const notFound = routes.find((route) => route.path === '/:pathMatch(.*)*')

    expect(forbidden?.path).toBe('/forbidden')
    expect(forbidden.meta?.requiredPermission).toBeUndefined()
    expect(notFound).toBeTruthy()
    expect(notFound.meta?.requiredPermission).toBeUndefined()
  })

  it('[RTR-06] 顧客詳細と子ルートは権限を要求せず、空パスは外株預りへ回す', () => {
    const detail = routeAt('/customers/:customerId(\\d+)')
    expect(detail).toBeTruthy()
    expect(detail.meta?.requiredPermission).toBeUndefined()

    const children = detail.children ?? []
    expect(pathsOf(children)).toEqual(expect.arrayContaining(['', 'summary', 'orders']))
    for (const child of children) {
      expect(child.meta?.requiredPermission, child.path).toBeUndefined()
    }

    const index = children.find((child) => child.path === '')
    const params = { customerId: '7' }
    expect(index.redirect({ params })).toEqual({ name: 'customer-summary', params })
    expect(children.find((child) => child.path === 'summary')?.name).toBe('customer-summary')
  })
})
