/**
 * 1 画面ぶんのモンキーテスト本体。
 *
 * 「ランダムに触る」だけでなく、触っている間に出た異常を拾うのが仕事。拾うのは 4 種類:
 *   console   … console.error / console.warn（Vue の警告を含む）
 *   pageerror … 未処理の例外・Promise 拒否
 *   network   … 5xx 応答・リクエスト失敗
 *   render    … #app が空（白画面）・横スクロールの発生（崩れ）
 *
 * 画面をまたぐ操作はしない。サイドメニューは操作対象から除き、URL が対象 path から
 * 離れたら unexpected-navigation として記録して戻る（画面横断は別スキルの担当）。
 */
import { createRandom, pick, randomDate, randomNumber, randomText } from './random.js'

/** 操作対象にする要素 */
const CANDIDATE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** この中の要素は触らない（画面をまたぐため） */
const EXCLUDED_ROOTS = ['nav[aria-label="メインメニュー"]', '.sidebar']

/** 押すキー。フォーカスを持った要素にそのまま送る */
const KEYS = ['Enter', 'Escape', 'Tab', 'Space', 'ArrowDown', 'ArrowUp', 'End', 'Home']

const MAX_LABEL = 60

function truncate(text) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL)}…` : flat
}

/**
 * console / pageerror / network を購読して findings に積む。
 * page.goto より前に呼ぶこと（初期描画中のエラーを取り逃がす）。
 */
export function attachWatchers(page, findings, state) {
  page.on('console', (message) => {
    const type = message.type()
    // MSW は起動時にこの行を出す（src/mocks/browser.js が quiet: false で start している）。
    // Service Worker の有無より確実な「モックが効いている」証拠なので拾っておく
    if (message.text().includes('[MSW] Mocking enabled')) state.mswDetected = true
    if (type !== 'error' && type !== 'warning') return
    findings.push({
      kind: 'console',
      severity: type === 'error' ? 'error' : 'warn',
      step: state.step,
      message: truncate(message.text()),
      url: page.url(),
    })
  })

  page.on('pageerror', (error) => {
    findings.push({
      kind: 'pageerror',
      severity: 'error',
      step: state.step,
      message: truncate(`${error.name}: ${error.message}`),
      stack: (error.stack ?? '').split('\n').slice(0, 5).join('\n'),
      url: page.url(),
    })
  })

  page.on('response', (response) => {
    if (response.status() < 500) return
    findings.push({
      kind: 'network',
      severity: 'error',
      step: state.step,
      message: `${response.status()} ${response.request().method()} ${response.url()}`,
      url: page.url(),
    })
  })

  page.on('requestfailed', (request) => {
    // 操作で遷移・中断したリクエストは異常ではない
    const failure = request.failure()?.errorText ?? ''
    if (failure.includes('net::ERR_ABORTED')) return
    findings.push({
      kind: 'network',
      severity: 'error',
      step: state.step,
      message: `${failure} ${request.method()} ${request.url()}`,
      url: page.url(),
    })
  })

  // 確認ダイアログは必ず「いいえ」で閉じる（承諾すると MSW でも一覧が消え、
  // 以降の操作が「消えた後の画面」だけを触ることになる）
  page.on('dialog', async (dialog) => {
    findings.push({
      kind: 'dialog',
      severity: 'info',
      step: state.step,
      message: `${dialog.type()}: ${truncate(dialog.message())}`,
      url: page.url(),
    })
    await dialog.dismiss().catch(() => {})
  })

  page.on('popup', async (popup) => {
    findings.push({
      kind: 'popup',
      severity: 'warn',
      step: state.step,
      message: popup.url(),
      url: page.url(),
    })
    await popup.close().catch(() => {})
  })
}

/**
 * 触れる要素を数え上げ、data-monkey-id を振って一覧を返す。
 * 属性で指すのは、操作のたびに DOM が入れ替わっても指し直せるようにするため。
 */
async function collectCandidates(page) {
  return page.evaluate(
    ({ selector, excluded }) => {
      const roots = excluded.map((sel) => document.querySelector(sel)).filter((el) => el !== null)
      const isExcluded = (el) => roots.some((root) => root.contains(el))
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        const style = window.getComputedStyle(el)
        return style.visibility !== 'hidden' && style.display !== 'none'
      }

      const elements = Array.from(document.querySelectorAll(selector)).filter(
        (el) => !isExcluded(el) && isVisible(el) && !el.hasAttribute('disabled'),
      )

      document
        .querySelectorAll('[data-monkey-id]')
        .forEach((el) => el.removeAttribute('data-monkey-id'))

      return elements.map((el, index) => {
        el.setAttribute('data-monkey-id', String(index))
        return {
          id: index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') ?? '',
          role: el.getAttribute('role') ?? '',
          testid: el.getAttribute('data-testid') ?? '',
          label: (el.getAttribute('aria-label') || el.textContent || '').slice(0, 80),
        }
      })
    },
    { selector: CANDIDATE_SELECTOR, excluded: EXCLUDED_ROOTS },
  )
}

/** 要素 1 つに 1 操作。何をしたかの説明文を返す */
async function actOnCandidate(page, candidate, random) {
  const locator = page.locator(`[data-monkey-id="${candidate.id}"]`)
  const target =
    `${candidate.tag}${candidate.type ? `[${candidate.type}]` : ''}` +
    `${candidate.testid ? `#${candidate.testid}` : ''} "${truncate(candidate.label)}"`

  if (candidate.tag === 'select') {
    const options = await locator
      .locator('option')
      .evaluateAll((els) => els.filter((el) => !el.disabled).map((el) => el.value))
    const value = pick(random, options)
    if (value === undefined) return `skip(option 無し) ${target}`
    await locator.selectOption(value, { timeout: 3000 })
    return `select("${value}") ${target}`
  }

  if (candidate.tag === 'input' || candidate.tag === 'textarea') {
    const type = candidate.type.toLowerCase()
    if (type === 'checkbox' || type === 'radio') {
      await locator.click({ timeout: 3000, force: true })
      return `toggle ${target}`
    }
    if (type === 'file') {
      // ファイル選択は OS のダイアログを開くので触らない（CSV 取込は専用の E2E で扱う）
      return `skip(file input) ${target}`
    }
    const valueByType = {
      date: () => randomDate(random),
      number: () => randomNumber(random),
      range: () => randomNumber(random),
    }
    const value = (valueByType[type] ?? (() => randomText(random)))()
    await locator.fill(value, { timeout: 3000 })
    return `fill("${truncate(value)}") ${target}`
  }

  await locator.click({ timeout: 3000, force: true })
  return `click ${target}`
}

/** 表示が壊れていないかを見る。白画面と横スクロールを拾う */
async function checkRender(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app')
    const problems = []
    if (!app || app.children.length === 0 || (app.textContent ?? '').trim() === '') {
      problems.push({ kind: 'render', severity: 'error', message: '#app が空（白画面）' })
    }
    const overflow = document.documentElement.scrollWidth - window.innerWidth
    if (overflow > 2) {
      problems.push({
        kind: 'render',
        severity: 'warn',
        message: `横スクロールが発生（+${overflow}px）`,
      })
    }
    return problems
  })
}

/** 「ページが見つかりません」に落ちたか（= ルート未定義） */
async function isNotFound(page) {
  return page.evaluate(() => document.title.startsWith('ページが見つかりません'))
}

/**
 * 1 画面を steps 回だけ触る。
 *
 * @returns {Promise<{status: 'ok'|'findings'|'not-implemented', target: object, seed: number,
 *   steps: Array<{step: number, action: string}>, findings: Array<object>}>}
 */
export async function runMonkey({ page, target, seed, steps, settleMs = 120 }) {
  const random = createRandom(seed)
  const findings = []
  const log = []
  const state = { step: 0, mswDetected: false }

  attachWatchers(page, findings, state)

  await page.goto(target.to, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})

  if (await isNotFound(page)) {
    return { status: 'not-implemented', target, seed, steps: log, findings }
  }

  // MSW が効いていないと、ランダムな更新操作が実 API のデータを壊す。
  //
  // Service Worker の有無だけで判定してはいけない。E2E コンテナから見た
  // http://frontend:5173 は secure context ではないため SW を登録できず、MSW は
  // ページ内で fetch を横取りする fallback mode で動く（src/mocks/browser.js のコメント）。
  // そのため「起動ログ」「SW の制御」「fetch が差し替わっているか」の 3 つで見る。
  const mswActive =
    state.mswDetected ||
    (await page.evaluate(
      () =>
        Boolean(navigator.serviceWorker?.controller) ||
        !/\[native code\]/.test(String(window.fetch)),
    ))
  if (!mswActive && process.env.MONKEY_ALLOW_REAL_API !== '1') {
    throw new Error(
      'MSW が動いていない。実 API に対してランダムな更新操作を撒くとデータを壊すので中止した。' +
        '環境変数ファイルの VITE_ENABLE_MSW を true に戻して frontend を作り直すか、' +
        '意図して実 API に当てるなら MONKEY_ALLOW_REAL_API=1 を付けて実行する。',
    )
  }

  for (let step = 1; step <= steps; step += 1) {
    state.step = step

    const candidates = await collectCandidates(page)
    if (candidates.length === 0) {
      log.push({ step, action: 'skip(操作できる要素が無い)' })
      break
    }

    // 1 割はキー操作にする（クリックだけでは開かない・閉じない経路が残る）
    let action
    try {
      if (random() < 0.1) {
        const key = pick(random, KEYS)
        await page.keyboard.press(key)
        action = `key(${key})`
      } else {
        action = await actOnCandidate(page, pick(random, candidates), random)
      }
    } catch (error) {
      // 操作そのものの失敗（要素が消えた等）は異常ではない。記録して次へ進む
      action = `failed(${truncate(String(error.message).split('\n')[0])})`
    }
    log.push({ step, action })

    await page.waitForTimeout(settleMs)

    for (const problem of await checkRender(page)) {
      findings.push({ ...problem, step, url: page.url() })
    }

    const path = new URL(page.url()).pathname
    if (path !== target.to) {
      findings.push({
        kind: 'unexpected-navigation',
        severity: 'warn',
        step,
        message: `${target.to} から ${path} へ遷移した`,
        url: page.url(),
      })
      await page.goto(target.to, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
    }
  }

  return {
    status: findings.some((f) => f.severity === 'error') ? 'findings' : 'ok',
    target,
    seed,
    steps: log,
    findings,
  }
}
