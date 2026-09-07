import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './src/mocks/server'
import { resetMockState } from './src/mocks/handlers'

// 単体テストは常に MSW(node) 経由で API を解決する。
// テストごとに handlers を上書きした場合も afterEach で既定に戻る。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  // 登録系ハンドラが書き換えたモックデータも戻す（残すと後続テストの件数が狂う）
  resetMockState()
})
afterAll(() => server.close())
