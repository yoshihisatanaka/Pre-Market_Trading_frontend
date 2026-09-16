import { ref } from 'vue'

/*
 * サイドメニューの開閉状態。押し出し式（閉じると画面外へ出て本文が全幅になる）。
 *
 * 状態の実体は AppLayout が 1 つだけ持ち、AppSidebar / AppHeader へは props で配る。
 * アプリ内で 2 回呼ぶと state が分裂するので呼ばないこと。
 */
const STORAGE_KEY = 'app.sidebar.open'

/**
 * この幅「以下」では、保存値が無いときの既定を閉にする。
 * CSS の @media では var() が使えず、そもそも今回 CSS 側にメディアクエリは要らない
 * （表示は state が全部決める）。よって幅の正はこの定数 1 箇所だけ。
 */
export const SIDEBAR_BREAKPOINT = 1024

/**
 * 保存された開閉状態。
 * @returns {boolean | null} 未保存・壊れた値・localStorage が使えない環境では null
 */
function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    // Safari のプライベートモードなど。保存が使えないだけで機能は止めない
    return null
  }
}

function writeStored(open) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(open))
  } catch {
    // 保存できなくても開閉そのものは成立する
  }
}

/**
 * サイドメニューの開閉状態を作る。
 *
 * 初期値は **保存値 > 画面幅による既定**。幅を見るのは保存値が無いときだけで、
 * 以後のリサイズには追従しない（手で開いたものをウィンドウ操作で畳まない）。
 *
 * @returns {{ isOpen: import('vue').Ref<boolean>, toggle: () => void }}
 */
export function useSidebarToggle() {
  // 1024 > 1024 は false なので、ちょうど 1024px は「閉」。
  const isOpen = ref(readStored() ?? window.innerWidth > SIDEBAR_BREAKPOINT)

  const toggle = () => {
    isOpen.value = !isOpen.value
    writeStored(isOpen.value)
  }

  return { isOpen, toggle }
}
