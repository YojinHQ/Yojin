import { useState } from 'react';
import { cn } from '../../lib/utils';

interface PlatformConfig {
  id: string;
  name: string;
  logo?: string; // local SVG path in /platforms/
  domain: string;
  instructions: string[];
}

export const PLATFORMS: PlatformConfig[] = [
  {
    id: 'INTERACTIVE_BROKERS',
    name: 'IBKR',
    logo: '/platforms/interactive-brokers.png',
    domain: 'interactivebrokers.com',
    instructions: [
      'Open the IBKR mobile app or web portal',
      'Go to Portfolio → Positions',
      'Take a screenshot showing all your holdings',
    ],
  },
  {
    id: 'ROBINHOOD',
    name: 'Robinhood',
    logo: '/platforms/robinhood.png',
    domain: 'robinhood.com',
    instructions: [
      'Open the Robinhood app or robinhood.com',
      'Go to your portfolio page',
      'Screenshot showing your positions list',
    ],
  },
  {
    id: 'COINBASE',
    name: 'Coinbase',
    logo: '/platforms/coinbase.png',
    domain: 'coinbase.com',
    instructions: ['Open Coinbase app or coinbase.com', 'Go to Assets tab', 'Screenshot your full asset list'],
  },
  {
    id: 'BINANCE',
    name: 'Binance',
    logo: '/platforms/binance.png',
    domain: 'binance.com',
    instructions: ['Open Binance app or binance.com', 'Go to Wallet → Overview or Spot', 'Screenshot your holdings'],
  },
  {
    id: 'METAMASK',
    name: 'MetaMask',
    logo: '/platforms/metamask.png',
    domain: 'metamask.io',
    instructions: [
      'Open the MetaMask extension or app',
      'View your token list on the main screen',
      'Screenshot your holdings',
    ],
  },
  {
    id: 'WEBULL',
    name: 'WeBull',
    logo: '/platforms/webull.png',
    domain: 'webull.com',
    instructions: ['Open the WeBull app or webull.com', 'Go to your Positions tab', 'Screenshot all positions'],
  },
  {
    id: 'SOFI',
    name: 'SoFi',
    logo: '/platforms/sofi.png',
    domain: 'sofi.com',
    instructions: ['Open the SoFi app or sofi.com', 'Go to Invest → Holdings', 'Screenshot your portfolio'],
  },
  {
    id: 'SCHWAB',
    name: 'Schwab',
    logo: '/platforms/schwab.png',
    domain: 'schwab.com',
    instructions: ['Open schwab.com or the Schwab app', 'Go to Positions', 'Screenshot your holdings'],
  },
  {
    id: 'FIDELITY',
    name: 'Fidelity',
    logo: '/platforms/fidelity.png',
    domain: 'fidelity.com',
    instructions: ['Open fidelity.com or the Fidelity app', 'Go to Positions', 'Screenshot your holdings'],
  },
  {
    id: 'PHANTOM',
    name: 'Phantom',
    logo: '/platforms/phantom.png',
    domain: 'phantom.app',
    instructions: ['Open the Phantom wallet extension', 'View your token list', 'Screenshot your holdings'],
  },
];

const PALETTE = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#6366f1', '#14b8a6'];

function getColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

interface PlatformTileProps {
  platform: PlatformConfig;
  connected: boolean;
  onClick: () => void;
  className?: string;
}

export function PlatformTile({ platform, connected, onClick, className }: PlatformTileProps) {
  const [imgError, setImgError] = useState(false);

  // Use local SVG if available, otherwise Clearbit
  const logoSrc = platform.logo || `https://logo.clearbit.com/${platform.domain}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-3 rounded-xl border p-5 transition-all duration-200',
        connected
          ? 'border-success/30 bg-success/[0.04]'
          : 'border-border bg-bg-card hover:border-border-light hover:bg-bg-hover/50',
        className,
      )}
    >
      {/* Connected checkmark */}
      {connected && (
        <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-success">
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
      )}

      {/* Logo */}
      <div
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg"
        style={imgError ? { backgroundColor: getColor(platform.name) } : undefined}
      >
        {imgError ? (
          <span className="text-xs font-bold text-white">{platform.name.slice(0, 2).toUpperCase()}</span>
        ) : (
          <img
            src={logoSrc}
            alt={`${platform.name} logo`}
            className="h-full w-full object-contain"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      <span
        className={cn(
          'text-xs font-medium transition-colors',
          connected ? 'text-success' : 'text-text-secondary group-hover:text-text-primary',
        )}
      >
        {platform.name}
      </span>
    </button>
  );
}
