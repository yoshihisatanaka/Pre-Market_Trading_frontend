import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

/** ブラウザ用（dev サーバ・E2E）。main.js から VITE_ENABLE_MSW=true のときだけ起動する */
export const worker = setupWorker(...handlers)
