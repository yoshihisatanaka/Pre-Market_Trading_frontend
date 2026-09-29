import { describe, expect, it } from 'vitest'
import {
  currentOperatorFor,
  devOperators,
  salesOperator,
  supervisorOperator,
} from './currentOperator'

// シナリオ: docs/unit/mocks-current-operator.md

/** 既定の handlers（MSW node）が受ける URL。パスは '*' 始まりなのでホストは何でもよい */
const AUTH_ME_URL = 'http://localhost/api/auth/me'

async function fetchAuthMe(headers = {}) {
  const response = await fetch(AUTH_ME_URL, { headers })
  return response.json()
}

describe('currentOperatorFor', () => {
  it('[MCO-01] 4 人それぞれの操作者コードでその操作者が返る', () => {
    for (const operator of devOperators) {
      expect(currentOperatorFor(operator.操作者コード)).toBe(operator)
    }
  })

  it('[MCO-02] 知らないコード・空・null・undefined は管理責任者に倒す', () => {
    for (const code of ['test-user', '', null, undefined]) {
      expect(currentOperatorFor(code)).toBe(supervisorOperator)
    }
  })
})

describe('GET /auth/me のモック', () => {
  it('[MCO-03] X-User-Code の操作者を返す', async () => {
    await expect(fetchAuthMe({ 'X-User-Code': salesOperator.操作者コード })).resolves.toEqual(
      salesOperator,
    )
  })

  it('[MCO-04] X-User-Code が無ければ管理責任者を返す', async () => {
    await expect(fetchAuthMe()).resolves.toEqual(supervisorOperator)
  })
})
