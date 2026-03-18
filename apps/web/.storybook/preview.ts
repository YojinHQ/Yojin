import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: { disabled: true },
    layout: 'centered',
  },
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.style.backgroundColor = 'var(--color-bg-primary)';
      document.body.style.color = 'var(--color-text-primary)';
      document.body.style.fontFamily = 'var(--font-body)';
      return Story();
    },
  ],
};

export default preview;
