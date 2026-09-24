import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { announcement } from '@/mocks/fixtures/announcements'
import {
  incidentBannerResponse,
  noneBannerResponse,
  noticeBannerResponse,
} from '@/mocks/fixtures/banner'
import { fetchBanner } from './banner'

/*
 * API 層のテスト。BannerResponse の日本語キーがアプリ内モデルに変わることと、
 * nullable 項目の寄せ方を守る。種別の優先順位はサーバの判定なので、ここでは組み立て直さない。
 */

/** 応答を差し替えて、届いたパスを覚えておく */
function respondWith(body) {
  const seen = { pathname: null }
  server.use(
    http.get('*/api/operations/banner', ({ request }) => {
      seen.pathname = new URL(request.url).pathname
      return HttpResponse.json(body)
    }),
  )
  return seen
}

// シナリオ: docs/unit/api-banner.md
describe('api/banner', () => {
  it('[BNA-01] 既定モックはお知らせの現在値から NOTICE を返し、アプリ内モデルに変換される', async () => {
    // 既定ハンドラはフィクスチャの現在値（表示中）から組み立てる。届いたパスは素通しで覗く
    let pathname = null
    server.use(
      http.get('*/api/operations/banner', ({ request }) => {
        pathname = new URL(request.url).pathname
      }),
    )

    const banner = await fetchBanner()

    expect(pathname).toBe('/api/operations/banner')
    expect(announcement.表示中).toBe(true)
    expect(banner).toEqual({
      kind: noticeBannerResponse.種別,
      severity: noticeBannerResponse.重要度,
      message: announcement.本文,
      ordersSuspended: false,
      suspendedTargets: [],
      suspendedTargetNames: [],
      announcementVisible: true,
      announcementMessage: announcement.本文,
    })
  })

  it('[BNA-02] 発注停止中は INCIDENT と停止対象がそのまま返る', async () => {
    respondWith(incidentBannerResponse)

    const banner = await fetchBanner()

    expect(banner).toEqual({
      kind: 'INCIDENT',
      severity: incidentBannerResponse.重要度,
      message: incidentBannerResponse.メッセージ,
      ordersSuspended: true,
      suspendedTargets: incidentBannerResponse.停止中の対象,
      suspendedTargetNames: incidentBannerResponse.停止中の対象名,
      // 停止中でもお知らせの生の状態は返る
      announcementVisible: incidentBannerResponse.お知らせ表示中,
      announcementMessage: incidentBannerResponse.お知らせ本文,
    })
  })

  it('[BNA-03] NONE の null のメッセージとお知らせ本文は空文字になる', async () => {
    respondWith(noneBannerResponse)

    const banner = await fetchBanner()

    expect(banner.kind).toBe('NONE')
    expect(banner.message).toBe('')
    expect(banner.announcementMessage).toBe('')
    expect(banner.announcementVisible).toBe(false)
    expect(banner.ordersSuspended).toBe(false)
  })

  it('[BNA-04] 項目が欠けた応答でも既定値に寄る', async () => {
    respondWith({})

    const banner = await fetchBanner()

    expect(banner).toEqual({
      kind: 'NONE',
      severity: 'normal',
      message: '',
      ordersSuspended: false,
      suspendedTargets: [],
      suspendedTargetNames: [],
      announcementVisible: false,
      announcementMessage: '',
    })
  })
})
