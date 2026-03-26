export const tooltipStyle = {
  backgroundColor: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text-primary)',
  fontSize: '12px',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter type is overly strict
export const formatValue: any = (value: number | string) => [
  `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  'Value',
];
