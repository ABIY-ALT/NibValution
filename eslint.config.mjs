import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint configuration.
 *
 * The two boundary rules at the bottom are the ones that matter most: they are
 * what keeps the architecture in docs/06-folder-structure.md real rather than
 * aspirational. Both are errors, not warnings — a warning that everyone learns
 * to scroll past enforces nothing.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts', 'storage/**', '.smoke/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    /**
     * The domain layer must stay free of framework and I/O imports so the
     * valuation and workflow logic can be unit-tested without a database or a
     * request context.
     */
    files: ['src/server/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                'react-dom',
                '@prisma/client',
                '@/server/infrastructure/*',
                '@/server/application/*',
                '@/app/*',
                '@/components/*',
              ],
              message:
                'The domain layer must not import frameworks, Prisma, or infrastructure. Depend on an interface in src/server/domain/ports instead.',
            },
          ],
        },
      ],
    },
  },
  {
    /** UI must go through server actions, never straight to the database. */
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@/server/infrastructure/db/*'],
              message:
                'UI must go through server actions and application services, never Prisma directly.',
            },
          ],
        },
      ],
    },
  },
  {
    /** Seeds, tests and development scripts legitimately print. */
    files: ['prisma/seed/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default eslintConfig;
