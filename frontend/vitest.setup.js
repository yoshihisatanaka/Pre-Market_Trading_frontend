import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './src/mocks/server'

// 単体テストは常に MSW(node) 経由で API を解決する。
// テストごとに handlers を上書きした場合も afterEach で既定に戻る。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
