import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: '@storybook/react-vite',
  viteFinal(config) {
    config.plugins ??= [];
    config.plugins.push(tailwindcss());
    return config;
  },
};

export default config;
