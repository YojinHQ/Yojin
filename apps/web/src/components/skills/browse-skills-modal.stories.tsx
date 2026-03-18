import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import BrowseSkillsModal from './browse-skills-modal';

const meta: Meta<typeof BrowseSkillsModal> = {
  title: 'Skills/BrowseSkillsModal',
  component: BrowseSkillsModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof BrowseSkillsModal>;

export const Open: Story = {
  args: { open: true, onClose: () => {} },
};

function InteractiveModal() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-center p-12">
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-secondary"
      >
        Open Skill Browser
      </button>
      <BrowseSkillsModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveModal />,
};
