import Modal from '../common/modal';

const layers = [
  {
    title: 'Layer 1 \u2014 Credential Vault',
    subtitle: 'Your secrets stay encrypted, on-disk, on your machine.',
    body: 'API keys and credentials are stored in a local encrypted vault using AES-256-GCM. The vault never makes network requests. When an AI agent needs a credential at runtime, it reads from the vault locally \u2014 the key is never hardcoded, logged, or transmitted.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
        />
      </svg>
    ),
  },
  {
    title: 'Layer 2 \u2014 Deterministic Guard Pipeline',
    subtitle: 'Rules that can\u2019t be reasoned with.',
    body: 'Before any agent action executes, it passes through a pipeline of security guards \u2014 code-based rules with binary outcomes. A regex either matches or it doesn\u2019t. The AI cannot persuade, interpret, or work around them.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
        />
      </svg>
    ),
  },
  {
    title: 'Layer 3 \u2014 PII Redaction',
    subtitle: 'Sensitive data is scrubbed before it reaches any AI model.',
    body: 'Every piece of data flowing into the LLM or any external API is filtered and stripped before being processed. Account IDs are hashed. Names and emails are stripped. The AI reasons over sanitized data \u2014 it never sees the raw values.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
        />
      </svg>
    ),
  },
  {
    title: 'Layer 4 \u2014 Approval Gate',
    subtitle: 'The agent can think. It cannot act without you.',
    body: 'Agents have read access to observe and analyze. They have no write access until you explicitly approve an action. Irreversible operations \u2014 executing a trade, adding a new connection \u2014 require a confirmation step through your active channel.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.05 4.575a1.575 1.575 0 1 0-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 0 1 3.15 0v1.5m-3.15 0 .075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 0 1 3.15 0V15M6.9 7.575a1.575 1.575 0 1 0-3.15 0v8.175a6.75 6.75 0 0 0 6.75 6.75h2.018a5.25 5.25 0 0 0 3.712-1.538l1.732-1.732a5.25 5.25 0 0 0 1.538-3.712l.003-2.024a.668.668 0 0 0-.668-.668 1.667 1.667 0 0 0-1.667 1.667v-1.093"
        />
      </svg>
    ),
  },
];

interface SecurityModalProps {
  open: boolean;
  onClose: () => void;
}

export function SecurityModal({ open, onClose }: SecurityModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-3xl"
      wrapperClassName="pl-(--spacing-sidebar-width)"
      className="min-h-[70vh] px-10 py-8 flex items-center"
      aria-labelledby="security-modal-title"
    >
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Intro */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5 text-accent-primary">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
          </div>
          <div className="space-y-2">
            <h2 id="security-modal-title" className="text-base font-semibold text-text-primary">
              Your data never leaves your machine.
            </h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Your credentials, positions, and account details are stored and processed on your computer &mdash; not on
              our servers, not in the cloud. The architecture below enforces this at four independent layers, so no
              single point of failure can expose your data.
            </p>
          </div>
        </div>

        {/* Security layers */}
        {layers.map((layer, i) => (
          <div key={i} className="border-t border-border pt-5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5 text-text-muted">{layer.icon}</div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-text-primary">{layer.title}</h3>
                <p className="text-xs font-medium italic text-text-muted">{layer.subtitle}</p>
                <p className="text-sm text-text-secondary leading-relaxed">{layer.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
