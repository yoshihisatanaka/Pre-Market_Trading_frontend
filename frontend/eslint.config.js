import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'public/mockServiceWorker.js',
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
