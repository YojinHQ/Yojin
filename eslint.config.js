// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from 'eslint-plugin-storybook';

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    plugins: {
      'import-x': importX,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused vars
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Console — warn by default, overridden for CLI/gateway below
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Naming conventions: PascalCase for types, camelCase for everything else
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: ['class', 'interface', 'typeAlias', 'typeParameter'],
          format: ['PascalCase'],
        },
        {
          selector: ['function', 'parameter'],
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
      ],

      // Import ordering: node → external → internal → relative
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['sibling', 'parent'], 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',

      // Member sort within import statements
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          allowSeparatedGroups: true,
        },
      ],
    },
  },
  // CLI files and channel setup use console.log for user-facing output
  {
    files: ['src/cli/**/*.ts', 'src/trust/vault/cli.ts', 'src/gateway/server.ts', 'channels/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Test files — relax strict rules
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '**/*.mjs', 'vitest.config.ts', 'eslint.config.js', 'apps/', 'packages/'],
  },
  storybook.configs['flat/recommended'],
);
