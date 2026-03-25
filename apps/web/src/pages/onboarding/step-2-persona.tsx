import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useOnboarding } from '../../lib/onboarding-context';
import { cn } from '../../lib/utils';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { ChipSelect } from '../../components/onboarding/chip-select';
import Button from '../../components/common/button';
import Input from '../../components/common/input';

type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';
type CommunicationStyle = 'concise' | 'detailed' | 'technical';

const RISK_OPTIONS: { value: RiskTolerance; title: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'conservative',
    title: 'Conservative',
    description: 'Preserve capital first. Flag risk early.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
        />
      </svg>
    ),
  },
  {
    value: 'moderate',
    title: 'Moderate',
    description: 'Balanced growth with managed risk.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z"
        />
      </svg>
    ),
  },
  {
    value: 'aggressive',
    title: 'Aggressive',
    description: 'Maximize returns. Higher risk tolerance.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
        />
      </svg>
    ),
  },
];

const STYLE_OPTIONS: { value: CommunicationStyle; title: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'concise',
    title: 'Concise',
    description: 'TL;DR first, details on demand.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
        />
      </svg>
    ),
  },
  {
    value: 'detailed',
    title: 'Detailed',
    description: 'Full analysis with context and reasoning.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
        />
      </svg>
    ),
  },
  {
    value: 'technical',
    title: 'Technical',
    description: 'Charts, indicators, precise numbers.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
        />
      </svg>
    ),
  },
];

const ASSET_CLASSES = ['Stocks', 'Crypto', 'ETFs', 'Options', 'Other'];

export function Step2Persona() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();

  const [name, setName] = useState(state.persona?.name ?? '');
  const [risk, setRisk] = useState<RiskTolerance | null>(state.persona?.riskTolerance ?? null);
  const [assets, setAssets] = useState<string[]>(state.persona?.assetClasses ?? []);
  const [style, setStyle] = useState<CommunicationStyle | null>(state.persona?.communicationStyle ?? null);
  const [hardRules, setHardRules] = useState(state.persona?.hardRules ?? '');
  const [preview, setPreview] = useState(state.persona?.previewMarkdown ?? '');
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const isFormValid = name.trim() && risk && assets.length > 0 && style;

  const generatePreview = useCallback(async () => {
    if (!isFormValid || !risk || !style) return;
    setError('');
    setGenerating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($input: PersonaInput!) { generatePersona(input: $input) { markdown } }`,
          variables: {
            input: {
              name: name.trim(),
              riskTolerance: risk.toUpperCase(),
              assetClasses: assets,
              communicationStyle: style.toUpperCase(),
              hardRules: hardRules.trim() || null,
            },
          },
        }),
      });
      const json = await res.json();
      const md = json?.data?.generatePersona?.markdown;
      if (md) {
        setPreview(md);
      } else {
        setError('Failed to generate persona. Try again.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setGenerating(false);
    }
  }, [name, risk, assets, style, hardRules, isFormValid]);

  const handleConfirm = useCallback(async () => {
    if (!risk || !style) return;
    setConfirming(true);
    setError('');
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($markdown: String!) { confirmPersona(markdown: $markdown) }`,
          variables: { markdown: preview },
        }),
      });
      const json = await res.json();
      if (json?.data?.confirmPersona) {
        updateState({
          persona: {
            name: name.trim(),
            riskTolerance: risk,
            assetClasses: assets,
            communicationStyle: style,
            hardRules: hardRules.trim() || undefined,
            previewMarkdown: preview,
            confirmed: true,
          },
        });
        nextStep();
      } else {
        setError('Failed to save persona. Try again.');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setConfirming(false);
    }
  }, [preview, name, risk, assets, style, hardRules, updateState, nextStep]);

  return (
    <OnboardingShell currentStep={2}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <h1 className="mb-2 font-headline text-2xl text-text-primary">Build your persona</h1>
          <p className="text-sm text-text-secondary">This shapes how Yojin thinks and talks to you.</p>
        </div>

        <div
          className="space-y-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          {/* Q1: Name */}
          <Input
            label="What should I call you?"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {/* Q2: Risk Tolerance */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-secondary">How do you think about risk?</p>
            <div className="grid grid-cols-3 gap-2">
              {RISK_OPTIONS.map((opt) => {
                const isSelected = risk === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRisk(opt.value)}
                    className={cn(
                      'cursor-pointer rounded-xl border p-4 text-center transition-all duration-200',
                      isSelected
                        ? 'border-accent-primary/60 bg-accent-glow'
                        : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
                    )}
                  >
                    <div
                      className={cn('mb-2 flex justify-center', isSelected ? 'text-accent-primary' : 'text-text-muted')}
                    >
                      {opt.icon}
                    </div>
                    <p className={cn('text-sm font-medium', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                      {opt.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Q3: Asset Classes */}
          <ChipSelect label="What do you invest in?" options={ASSET_CLASSES} selected={assets} onChange={setAssets} />

          {/* Q4: Communication Style */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-secondary">How do you want me to talk to you?</p>
            <div className="grid grid-cols-3 gap-2">
              {STYLE_OPTIONS.map((opt) => {
                const isSelected = style === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStyle(opt.value)}
                    className={cn(
                      'cursor-pointer rounded-xl border p-4 text-center transition-all duration-200',
                      isSelected
                        ? 'border-accent-primary/60 bg-accent-glow'
                        : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
                    )}
                  >
                    <div
                      className={cn('mb-2 flex justify-center', isSelected ? 'text-accent-primary' : 'text-text-muted')}
                    >
                      {opt.icon}
                    </div>
                    <p className={cn('text-sm font-medium', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                      {opt.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Q5: Hard Rules */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              Any hard rules? <span className="text-text-muted">(optional)</span>
            </label>
            <textarea
              value={hardRules}
              onChange={(e) => setHardRules(e.target.value)}
              placeholder="e.g., Never hold more than 20% in one position. Flag any crypto above $10k."
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-bg-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/30"
            />
          </div>

          {/* Generate Preview */}
          {!preview && (
            <Button
              variant="secondary"
              size="md"
              disabled={!isFormValid}
              loading={generating}
              onClick={generatePreview}
              className="w-full"
            >
              {!generating && (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
                  />
                </svg>
              )}
              Generate persona preview
            </Button>
          )}

          {/* Persona Preview */}
          {preview && (
            <div className="rounded-xl border border-border bg-bg-secondary p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-accent-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
                    />
                  </svg>
                  <span className="text-xs font-medium text-text-primary">Persona preview</span>
                </div>
                <Button variant="ghost" size="sm" loading={generating} onClick={generatePreview}>
                  Regenerate
                </Button>
              </div>
              <div
                className={cn(
                  'prose prose-sm prose-invert max-w-none text-text-secondary',
                  // Headings
                  '[&_h1]:font-headline [&_h1]:text-sm [&_h1]:text-text-primary [&_h1]:mb-2 [&_h1]:pb-1.5 [&_h1]:border-b [&_h1]:border-border',
                  '[&_h2]:text-[11px] [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-text-muted [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-medium',
                  // Lists
                  '[&_ul]:space-y-1 [&_ul]:mt-1',
                  '[&_li]:text-xs [&_li]:leading-snug [&_li]:text-text-secondary [&_li]:pl-0.5',
                  '[&_li::marker]:text-accent-primary',
                  // Paragraphs
                  '[&_p]:text-xs [&_p]:leading-snug',
                  // Inline
                  '[&_strong]:text-text-primary [&_strong]:font-medium',
                )}
              >
                <ReactMarkdown>{preview}</ReactMarkdown>
              </div>
            </div>
          )}

          {error && <p className="text-center text-xs text-error">{error}</p>}
        </div>

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" size="md" onClick={prevStep}>
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!preview || confirming}
            loading={confirming}
            onClick={handleConfirm}
          >
            Confirm & Continue
            <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}
