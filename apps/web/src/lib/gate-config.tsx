import type { ReactNode } from 'react';

export type GateRequirement = 'jintel' | 'ai' | 'both';

export interface GateConfig {
  title: string;
  subtitle: string;
  cta: string;
  href: string;
}

export const GATES: Record<'jintel' | 'ai', GateConfig> = {
  jintel: {
    title: 'Set up your Jintel API key',
    subtitle: 'Jintel is free to use. Connect it to unlock live market data and analytics.',
    cta: 'Set up in Profile',
    href: '/profile',
  },
  ai: {
    title: 'AI provider not configured',
    subtitle: 'Configure an AI provider to unlock this feature.',
    cta: 'Set up in Settings',
    href: '/settings',
  },
};

export function YojinLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return <img src="/brand/yojin_icon_color.png" alt="Yojin" className={`${cls} rounded-lg`} />;
}

export function AiLogos({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <div className="flex items-center -space-x-2">
      <img src="/ai-providers/claude.png" alt="Claude" className={`${cls} rounded-lg ring-2 ring-bg-card`} />
      <img src="/ai-providers/openai.png" alt="OpenAI" className={`${cls} rounded-lg ring-2 ring-bg-card`} />
    </div>
  );
}

export function GateLogo({ requires, size = 'md' }: { requires: 'jintel' | 'ai'; size?: 'sm' | 'md' }): ReactNode {
  return requires === 'jintel' ? <YojinLogo size={size} /> : <AiLogos size={size} />;
}

export function getMissing(
  requires: GateRequirement,
  jintelConfigured: boolean,
  aiConfigured: boolean,
): ('jintel' | 'ai')[] {
  const missing: ('jintel' | 'ai')[] = [];
  if ((requires === 'jintel' || requires === 'both') && !jintelConfigured) missing.push('jintel');
  if ((requires === 'ai' || requires === 'both') && !aiConfigured) missing.push('ai');
  return missing;
}
