import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import Toggle from './toggle';

const meta: Meta<typeof Toggle> = {
  title: 'Primitives/Toggle',
  component: Toggle,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

function ControlledToggle(props: Omit<React.ComponentProps<typeof Toggle>, 'checked' | 'onChange'> & { defaultChecked?: boolean }) {
  const { defaultChecked = false, ...rest } = props;
  const [checked, setChecked] = useState(defaultChecked);
  return <Toggle {...rest} checked={checked} onChange={setChecked} />;
}

export const Off: Story = {
  render: () => <ControlledToggle />,
};

export const On: Story = {
  render: () => <ControlledToggle defaultChecked />,
};

export const SmallSize: Story = {
  render: () => <ControlledToggle size="sm" />,
};

export const Disabled: Story = {
  render: () => <ControlledToggle disabled defaultChecked />,
};

export const WithLabel: Story = {
  render: () => (
    <div style={{ width: 400 }}>
      <ControlledToggle
        label="Morning digest"
        description="Daily portfolio summary at 8 AM"
        defaultChecked
      />
    </div>
  ),
};

export const SettingsGroup: Story = {
  render: () => (
    <div style={{ width: 400 }} className="space-y-4">
      <ControlledToggle label="Price alerts" description="Notify when positions hit target price" defaultChecked />
      <ControlledToggle label="Risk warnings" description="Alert on concentration or exposure changes" defaultChecked />
      <ControlledToggle label="Agent activity" description="Notify when agents complete tasks" />
      <ControlledToggle label="PII redaction" description="Strip identifiers before external API calls" defaultChecked />
    </div>
  ),
};
