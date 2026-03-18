import type { Meta, StoryObj } from '@storybook/react-vite';
import Card from './card';

const meta: Meta<typeof Card> = {
  title: 'Common/Card',
  component: Card,
  argTypes: {
    title: { control: 'text' },
  },
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: <p className="text-text-secondary text-sm">Card content goes here.</p>,
  },
};

export const WithTitle: Story = {
  args: {
    title: 'Portfolio Summary',
    children: (
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-2xl font-bold text-text-primary">$142,580</div>
          <div className="text-xs text-text-muted">Total Value</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-success">+2.4%</div>
          <div className="text-xs text-text-muted">Day P&L</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-text-primary">18</div>
          <div className="text-xs text-text-muted">Positions</div>
        </div>
      </div>
    ),
  },
};
