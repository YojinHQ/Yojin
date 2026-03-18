import type { Meta, StoryObj } from '@storybook/react-vite';
import RuleEditorView from './rule-editor-view';

const meta: Meta<typeof RuleEditorView> = {
  title: 'Skills/RuleEditorView',
  component: RuleEditorView,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: 900 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RuleEditorView>;

export const Default: Story = {};
