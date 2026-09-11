/**
 * seed から決まる擬似乱数。同じ seed なら同じ操作列になる（monkey/README.md）。
 * Math.random は使わない（再現できないと、落ちた操作列を追えない）。
 */

/** mulberry32。32bit 整数 seed から [0, 1) を返す関数を作る */
export function createRandom(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 0 以上 max 未満の整数 */
export function randomInt(random, max) {
  return Math.floor(random() * max)
}

/** 配列から 1 件。空配列なら undefined */
export function pick(random, items) {
  return items.length === 0 ? undefined : items[randomInt(random, items.length)]
}

/** 入力欄に流し込む文字列。境界値・記号・全角・長文を混ぜる */
export function randomText(random) {
  const canned = [
    '',
    ' ',
    '0',
    '-1',
    '99999999',
    '1.5',
    'AAPL',
    'aapl',
    'あいうえお',
    '<script>x</script>',
    "'; DROP TABLE orders; --",
    '2026-02-30',
    '2026/09/11',
    'a'.repeat(300),
    '😀🙃',
  ]
  return pick(random, canned)
}

/**
 * 数値入力に流し込む値。input[type=number] は数値以外を fill できない
 * （Playwright が拒否して操作が 1 回まるごと無駄になる）ので、型で使い分ける。
 * 境界値と桁あふれを混ぜる。
 */
export function randomNumber(random) {
  const canned = ['', '0', '1', '-1', '0.5', '999999999', '-999999999', '1e9']
  return pick(random, canned)
}

/** 日付入力に流し込む値。入力型が date のときだけ使う */
export function randomDate(random) {
  const year = 2020 + randomInt(random, 10)
  const month = 1 + randomInt(random, 12)
  const day = 1 + randomInt(random, 28)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
