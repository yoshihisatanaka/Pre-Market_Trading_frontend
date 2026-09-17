import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist/**',
      // Vite の依存事前バンドル（vite.config.js の cacheDir）。生成物なので検査しない。
      // node_modules は共有ボリュームなので cacheDir をここへ移した経緯は CLAUDE.md の
      // 「Docker は worktree ごとに分離」節にある。
      '.vite/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'public/mockServiceWorker.js',
      // 別セッションが repo 内に切った worktree（.git/info/exclude で git からは除外済み）。
      // ESLint は git の除外を見ないため、ここで明示しないと他 worktree の作業中コードまで
      // 本体の lint が拾ってしまう。
      '.claude/worktrees/**',
      // 文書ツリーは lint 対象外。docs/mock/ には Manus 出力の原本を無加工で置くため
      // （docs/mock/README.md）、コード規約を当ててはいけない。
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // docs/coding-standards.md の規約のうち機械的に検査できるもの。
      // レビュー担当が居ないため、守らせたい規約はできる限りここに落とす。
      'vue/multi-word-component-names': 'error',
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/define-macros-order': ['error', { order: ['defineProps', 'defineEmits'] }],
      'vue/no-unused-refs': 'error',
      'vue/require-default-prop': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---- レイヤ規約の機械検査（docs/coding-standards.md「2. レイヤ規約」）----
  //   views / components  →  stores / composables  →  api  →  (HTTP)
  //
  // src/api/ 以外で axios を直接使わせない
  {
    files: ['src/**/*.{js,vue}'],
    ignores: ['src/api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message:
                'axios は src/api/ の中でだけ使えます。src/api/client.js の apiClient を経由してください。',
            },
          ],
        },
      ],
    },
  },
  // views / components から api 層を直接呼ばせない（store か composable を経由する）
  {
    files: ['src/views/**/*.{js,vue}', 'src/components/**/*.{js,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message:
                'axios は src/api/ の中でだけ使えます。src/api/client.js の apiClient を経由してください。',
            },
          ],
          patterns: [
            {
              group: ['@/api/*', '@/api', '**/api/*', '**/api'],
              message:
                'view / component から api 層を直接 import しないでください。stores/ か composables/ を経由します。',
            },
          ],
        },
      ],
    },
  },
  // api 層は上位レイヤ（stores / views / components）に依存しない
  {
    files: ['src/api/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/stores/*', '@/views/*', '@/components/*', '@/composables/*'],
              message:
                'api 層から上位レイヤ（stores / views / components / composables）を import できません。',
            },
          ],
        },
      ],
    },
  },

  // テストコードと CLI スクリプトは制約を緩める
  {
    files: ['**/*.spec.js', 'vitest.setup.js', 'scripts/**/*.{js,mjs}'],
    rules: {
      'no-console': 'off',
    },
  },

  // フォーマット系ルールは Prettier に一任する（必ず最後）
  prettier,
]
