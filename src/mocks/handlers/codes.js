import { http, HttpResponse } from 'msw'
import { codeMasters } from '../fixtures/codes'

export const codeHandlers = [
  /*
   * 全コードマスタ一括取得。各画面のプルダウンの選択肢はここから来る。
   * 実 API は絞り込みのクエリを持たず、常に全部返す。
   */
  http.get('*/api/codes', () => HttpResponse.json(codeMasters)),
]
