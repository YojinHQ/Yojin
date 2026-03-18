import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import Modal from './modal';
import Button from './button';

const meta: Meta<typeof Modal> = {
  title: 'Primitives/Modal',
  component: Modal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof Modal>;

function ModalDemo({ title, maxWidth, children }: { title?: string; maxWidth?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen items-center justify-center bg-bg-primary">
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} maxWidth={maxWidth}>
        {children}
      </Modal>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <ModalDemo title="Confirm Action">
      <p className="text-sm text-text-secondary">Are you sure you want to disconnect this account? This action cannot be undone.</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Disconnect</Button>
      </div>
    </ModalDemo>
  ),
};

export const Wide: Story = {
  render: () => (
    <ModalDemo title="Browse Skills" maxWidth="max-w-2xl">
      <div className="grid grid-cols-2 gap-4">
        {['Price Alert', 'Volume Spike', 'Rebalance Reminder', 'VaR Breach'].map((name) => (
          <div key={name} className="rounded-xl border border-border bg-bg-card p-4 hover:border-border-light transition-colors">
            <div className="text-sm font-medium text-text-primary">{name}</div>
            <div className="text-xs text-text-muted mt-1">Skill description goes here</div>
          </div>
        ))}
      </div>
    </ModalDemo>
  ),
};

export const NoTitle: Story = {
  render: () => (
    <ModalDemo>
      <div className="text-center py-4">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
          <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-text-primary">Account Connected</h3>
        <p className="mt-1 text-sm text-text-secondary">Interactive Brokers is now syncing your positions.</p>
      </div>
    </ModalDemo>
  ),
};
