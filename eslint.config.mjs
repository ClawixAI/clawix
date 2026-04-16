// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'references/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/prisma/seed.ts',
      '**/prisma/seed.example.ts',
      '**/generated/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            'vitest.workspace.ts',
            'packages/*/vitest.config.ts',
          ],
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // Allow non-null assertions - common pattern with validated data
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Allow empty functions - common for default callbacks
      '@typescript-eslint/no-empty-function': 'off',
      // Relax unnecessary condition - too strict with complex union types
      '@typescript-eslint/no-unnecessary-condition': 'off',
      'no-console': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // Prisma's generated PrismaClient uses a dynamically-constructed class
    // ($Class.getPrismaClientClass()) whose members can't be resolved by
    // ESLint's type checker. This affects PrismaService and all repositories.
    files: ['packages/*/src/**/prisma.service.ts', 'packages/*/src/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
  {
    // Test files - disable type-checked rules since tests are excluded from main tsconfig
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
    },
  },
  {
    // React components - relax rules that conflict with common React patterns
    files: ['packages/web/src/**/*.tsx'],
    rules: {
      // onClick={() => setState(x)} is idiomatic React
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // Allow async event handlers like onClick={async () => {...}}
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // API package - relax unsafe rules throughout
    // Zod validation, Prisma, external SDKs create complex types that ESLint can't resolve
    files: ['packages/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Shared package - providers and schemas use complex type inference
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
    },
  },
  {
    // Error boundary pages need console.error for debugging
    files: ['**/error.tsx'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Vanta background can have console warnings for missing deps
    files: ['**/vanta-background.tsx'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Workspace/scoped-fs use control characters in regex for security validation
    files: ['**/scoped-fs.ts', '**/workspace.schema.ts', '**/telegram.formatter.ts'],
    rules: {
      'no-control-regex': 'off',
    },
  },
  {
    // Web package - relax strict rules that conflict with common patterns
    files: ['packages/web/src/**/*.ts', 'packages/web/src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // react-hooks plugin not installed - disable to avoid errors
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: [
      'eslint.config.mjs',
      'vitest.workspace.ts',
      '**/vitest.config.ts',
      '**/prisma.config.ts',
      '**/next.config.ts',
      '**/postcss.config.mjs',
    ],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
);
