import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** 単体テスト(Vitest)用。vitest.setup.js から起動する */
export const server = setupServer(...handlers)
