import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import RightPanel from './right-panel';

const meta: Meta<typeof RightPanel> = {
  title: 'Layout/RightPanel',
  component: RightPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: 500 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RightPanel>;

export const WithTitle: Story = {
  args: {
    title: 'News & Intel',
    children: (
      <div className="space-y-3 p-3">
        {['Fed signals rate adjustment', 'NVDA reports record revenue', 'Tech rotation accelerates'].map((item) => (
          <div key={item} className="rounded-md bg-bg-tertiary p-2.5">
            <p className="text-xs text-text-primary">{item}</p>
          </div>
        ))}
      </div>
    ),
  },
};

function PanelWithTabs() {
  const [activeTab, setActiveTab] = useState('News');
  return (
    <RightPanel
      tabs={[
        { label: 'News', active: activeTab === 'News', onClick: () => setActiveTab('News') },
        { label: 'Alerts', active: activeTab === 'Alerts', onClick: () => setActiveTab('Alerts') },
      ]}
    >
      <div className="p-3">
        <p className="text-sm text-text-secondary">
          Showing: <span className="font-medium text-text-primary">{activeTab}</span>
        </p>
      </div>
    </RightPanel>
  );
}

export const WithTabs: Story = {
  render: () => <PanelWithTabs />,
};

export const TitleAndTabs: Story = {
  args: {
    title: 'Intel',
    tabs: [
      { label: 'Feed', active: true, onClick: () => {} },
      { label: 'Alerts', active: false, onClick: () => {} },
    ],
    children: <div className="p-3 text-sm text-text-muted">Panel content goes here</div>,
  },
};
