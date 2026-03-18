import type { Meta, StoryObj } from '@storybook/react-vite';
import IntelAlerts from './intel-alerts';

const meta: Meta<typeof IntelAlerts> = {
  title: 'Overview/IntelAlerts',
  component: IntelAlerts,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }} className="border border-border rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof IntelAlerts>;

export const Default: Story = {};
