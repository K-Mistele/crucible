import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    plugins: ['typescript'],
    overrides: [
      {
        files: ['apps/control-center/**/*.{ts,tsx}'],
        plugins: ['react'],
      },
      {
        files: ['apps/infra/**/*.ts'],
        env: {
          node: true,
        },
        rules: {
          'no-console': 'off',
        },
      },
    ],
  },
});
