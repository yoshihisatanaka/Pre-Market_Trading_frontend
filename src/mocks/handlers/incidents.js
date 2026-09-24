import { http, HttpResponse } from 'msw'
import { incidentHistories, incidentStatus } from '../fixtures/incidents'

/*
 * 障害管理（/operations/incidents）。
 *
 * ⚠ 実 API には存在しないパス。形は仮置き（fixtures/incidents.js を参照）。
 *
 * いまは読むだけで書き換えないので fixtures をそのまま返す（resetMockState に登録しない）。
 */
export const incidentHandlers = [
  http.get('*/api/operations/incidents', () => HttpResponse.json(incidentStatus)),

  http.get('*/api/operations/incidents/histories', () =>
    HttpResponse.json({
      total: incidentHistories.length,
      limit: incidentHistories.length,
      offset: 0,
      histories: incidentHistories,
    }),
  ),
]
