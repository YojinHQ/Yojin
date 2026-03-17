import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'providers/**/*.ts', 'channels/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // CLI files and channel setup use console.log for user-facing output
  {
    files: ['src/cli/**/*.ts', 'src/gateway/server.ts', 'channels/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.mjs',
      'vitest.config.ts',
      'eslint.config.js',
      'apps/',
      'packages/',
    ],
  },
);
