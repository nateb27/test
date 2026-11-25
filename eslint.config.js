// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Math members allowed in src/sim (plan 2.2). Everything else on Math is an error. */
const ALLOWED_MATH = [
  'sqrt', 'floor', 'ceil', 'round', 'trunc', 'abs', 'min', 'max',
  // constants are deterministic values
  'PI', 'E', 'SQRT2', 'SQRT1_2', 'LN2', 'LN10', 'LOG2E', 'LOG10E',
];

const DETERMINISM_MSG = 'Banned in src/sim (plan 2.2 determinism rules).';

/** Globals that are non-deterministic or do I/O. */
const BANNED_SIM_GLOBALS = [
  'Date', 'performance', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'window', 'document', 'navigator', 'location', 'localStorage',
  'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker',
  'crypto', 'process', 'Intl', 'globalThis', 'self',
].map((name) => ({ name, message: DETERMINISM_MSG }));

/** Import boundaries for code that must never depend on the client or rendering libs. */
const CLIENT_IMPORT_PATTERNS = [
  { group: ['**/client', '**/client/**'], message: 'sim, data and bot may not import from src/client (plan 9.2).' },
  { group: ['pixi.js', 'pixi.js/*', '@pixi/*'], message: 'sim, data and bot may not import pixi.js (plan 9.2).' },
  { group: ['preact', 'preact/*', '@preact/*'], message: 'sim, data and bot may not import preact (plan 9.2).' },
];

export default tseslint.config(
  {
    ignores: ['.claude/**', 'dist/**', 'dist-e2e*/**', 'dist-perf/**', 'node_modules/**', 'coverage/**', 'test-results*/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // ---- Boundaries: sim, data and bot never import client / pixi / preact ----
  {
    files: ['src/sim/**/*.{ts,tsx}', 'src/bot/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: CLIENT_IMPORT_PATTERNS }],
    },
  },
  // data imports only types from sim (dependency direction data -> sim/types).
  {
    files: ['src/data/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            ...CLIENT_IMPORT_PATTERNS,
            {
              group: ['**/sim', '**/sim/**'],
              allowTypeImports: true,
              message: 'src/data may import only types from src/sim.',
            },
          ],
        },
      ],
    },
  },
  // ---- Determinism rules for the simulation (plan 2.2, 9.2) ----
  {
    files: ['src/sim/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...BANNED_SIM_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG in src/sim/rng.ts. ' + DETERMINISM_MSG },
        { object: 'Date', property: 'now', message: DETERMINISM_MSG },
        { object: 'performance', property: 'now', message: DETERMINISM_MSG },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[object.name='Math'][computed=false]:not([property.name=/^(${ALLOWED_MATH.join('|')})$/])`,
          message: `Only Math.${ALLOWED_MATH.slice(0, 8).join('/')} are allowed in src/sim. ${DETERMINISM_MSG}`,
        },
        {
          selector: "MemberExpression[object.name='Math'][computed=true]",
          message: `Computed Math access is not allowed in src/sim. ${DETERMINISM_MSG}`,
        },
        {
          selector: "VariableDeclarator[init.name='Math']",
          message: `Destructuring Math is not allowed in src/sim. ${DETERMINISM_MSG}`,
        },
        {
          selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']",
          message: `Exponentiation is banned in src/sim (use multiplication). ${DETERMINISM_MSG}`,
        },
        {
          selector:
            'MemberExpression[property.name=/^(localeCompare|toLocaleString|toLocaleLowerCase|toLocaleUpperCase)$/]',
          message: `Locale-dependent functions are banned in src/sim. ${DETERMINISM_MSG}`,
        },
      ],
    },
  },
);
