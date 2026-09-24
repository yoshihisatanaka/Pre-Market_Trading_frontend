import { http, HttpResponse } from 'msw'
import { noneBannerResponse, noticeBannerResponse } from '../fixtures/banner'
import { currentAnnouncementRow } from './announcements'

/*
 * 全画面ヘッダ用バナー（GET /operations/banner）。
 *
 * 実 API は発注停止（障害管理）とお知らせを 1 回で統合判定する。モックは発注停止を持たないので
 * 常に通常運用とし、**お知らせの現在値から NOTICE / NONE を組み立てる**
 * （お知らせ管理で表示 ON にして保存したら、次の取得で NOTICE になる）。
 * 発注停止中（INCIDENT）は fixtures/banner.js の incidentBannerResponse を
 * server.use() / mockApi() で差し替えて再現する。
 */
export const bannerHandlers = [
  http.get('*/api/operations/banner', () => {
    const row = currentAnnouncementRow()
    if (!row['表示中']) return HttpResponse.json(noneBannerResponse)

    return HttpResponse.json({
      ...noticeBannerResponse,
      メッセージ: row['本文'],
      お知らせ本文: row['本文'],
    })
  }),
]
