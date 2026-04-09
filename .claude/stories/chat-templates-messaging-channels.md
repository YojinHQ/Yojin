# Bring rich chat templates to Telegram, Slack & WhatsApp

**Labels:** `runtime` `channels` `chat`
**Estimate:** L (split into the follow-ups at the bottom if you want S/M slices)

## Why

Today the Yojin web app has a polished chat experience — a **Query Builder** landing card, a multi-step **Waterfall Flow** drill-down, the **Manual Position** step form, the gradient **Morning Briefing** hero, and the four tool cards (portfolio overview, positions list, allocation, morning briefing). All of that lives in `apps/web/src/components/chat/`.

On Telegram, Slack and WhatsApp users get **plain text**. The only things that render richly on those channels are the four `DisplayCardData` tool cards, because we built `src/tools/channel-display-formatters.ts` for them. Everything else — every interactive template, every onboarding flow, every briefing hero — either falls back to a text dump or isn't available at all.

That means a Telegram user who wants to add a manual position has to type it out in one line, a Slack user can't get the "Let's knock something off your list" quick-entry menu, and a WhatsApp user never sees a Morning Briefing hero — they get the same four tool cards we already ship and nothing else.

We want feature parity: the agent should be able to emit any chat template and have each channel render it in its most native form (Block Kit on Slack, inline keyboards on Telegram, list messages / quick replies on WhatsApp).

## How

You'll introduce a new **`ChatTemplate`** abstraction that sits alongside `DisplayCardData` and covers the interactive surfaces. Then you'll teach each channel to render the new template types, and wire a small amount of per-channel session state for the multi-step flows.

### 1. Define the `ChatTemplate` data model

Create `src/tools/chat-template-data.ts` — mirrors the pattern of `src/tools/display-data.ts`. Each template gets a Zod schema + inferred type:

```typescript
export const QueryBuilderTemplateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  suggestions: z.array(z.object({
    id: z.string().min(1),
    icon: z.enum(['portfolio', 'research', 'risk', 'news', 'sparkle']).optional(),
    label: z.string().min(1),
    query: z.string().min(1),
    prefill: z.boolean().optional(),
  })).min(1),
});

export const OptionSelectorTemplateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  layout: z.enum(['grid', 'stack']),
  options: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
  })).min(1),
  backId: z.string().optional(),
});

export const WaterfallStepTemplateSchema = z.object({
  flowId: z.string().min(1),       // identifies the waterfall tree (e.g. 'portfolio', 'research')
  stepId: z.string().min(1),       // current node in the tree
  title: z.string().min(1),
  subtitle: z.string().optional(),
  layout: z.enum(['grid', 'stack']),
  options: z.array(/* same shape as OptionSelector */).min(1),
});

export const ManualPositionStepTemplateSchema = z.object({
  step: z.enum(['symbol', 'account', 'quantity', 'price', 'confirm', 'success']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  formState: z.object({
    symbol: z.string().optional(),
    account: z.string().optional(),
    quantity: z.string().optional(),
    costBasis: z.string().optional(),
  }),
  presets: z.array(z.string()).optional(),   // e.g. ACCOUNT_PRESETS for the 'account' step
});

export const BriefingHeroTemplateSchema = z.object({
  variant: z.enum(['morning', 'full']),
  date: z.string().min(1),
  updatedAt: z.string().optional(),
  stats: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
  ctaLabel: z.string().optional(),
  ctaActionId: z.string().optional(),
});

export const ChatTemplateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('query-builder'), data: QueryBuilderTemplateSchema }),
  z.object({ type: z.literal('option-selector'), data: OptionSelectorTemplateSchema }),
  z.object({ type: z.literal('waterfall-step'), data: WaterfallStepTemplateSchema }),
  z.object({ type: z.literal('manual-position-step'), data: ManualPositionStepTemplateSchema }),
  z.object({ type: z.literal('briefing-hero'), data: BriefingHeroTemplateSchema }),
]);
export type ChatTemplate = z.infer<typeof ChatTemplateSchema>;
```

The Zod schemas are the single source of truth (per `.claude/rules/code-quality.md` → DRY). Use `.enum.X` constants in the rest of the code, not string literals (per `.claude/rules/typescript.md`).

### 2. Add `templates` to `OutgoingMessage`

`src/plugins/types.ts` already has `displayCards?: DisplayCardData[]` on `OutgoingMessage`. Add a sibling:

```typescript
interface OutgoingMessage {
  text: string;
  threadId?: string;
  displayCards?: DisplayCardData[];
  templates?: ChatTemplate[];   // new
}
```

This is the one place upstream callers hand templates to the channel layer — same pattern as display cards.

### 3. Write per-channel renderers

Extend `src/tools/channel-display-formatters.ts` (or split into a sibling `chat-template-formatters.ts` if it starts getting large). Each channel gets a `formatChatTemplateFor<Channel>` function that returns the channel-native payload.

The three channels each need a different return shape, so don't try to force a common return type — return what the channel can send natively:

#### Telegram (`formatChatTemplateForTelegram`)
Return `{ text: string; replyMarkup?: InlineKeyboardMarkup }`. Telegram supports **inline keyboards** (`grammy`'s `InlineKeyboardMarkup`) — each option becomes an inline button with `callback_data` encoding `flowId/stepId/optionId` (keep under Telegram's 64-byte callback_data limit). Always HTML-escape user-visible text via the existing `escapeHtml()` helper (per `.claude/rules/channel-formatting.md`).

#### Slack (`formatChatTemplateForSlack`)
Return `{ text: string; blocks: SlackBlock[] }`. Slack supports **Block Kit `actions` blocks** with `button` / `overflow` / `radio_buttons` elements. The Query Builder and Option Selector map cleanly to an `actions` block with buttons. The Waterfall step is the same — just a different set of buttons per step. Manual Position form → Block Kit **modal** or a stacked series of `section + actions` blocks.

#### WhatsApp (`formatChatTemplateForWhatsApp`)
Return `{ text: string; interactive?: WhatsAppInteractivePayload }`. WhatsApp Cloud API supports **list messages** (up to 10 rows, ideal for Option Selector/Waterfall) and **reply buttons** (up to 3, ideal for Query Builder top-level choices). Long-text templates (Briefing Hero) fall back to text since WhatsApp has no analogue for the gradient card.

Each renderer must handle every variant in the `ChatTemplate` discriminated union — TypeScript's exhaustiveness check catches missing cases. Per `.claude/rules/code-quality.md` → "Every enum value must have a switch case" — add an `assertNever(t.type)` default branch.

### 4. Consume templates in each channel's `sendMessage`

Each channel's `channel.ts` already loops `msg.displayCards` — do the same for `msg.templates`:

- **Telegram** — `channels/telegram/src/channel.ts`: after the existing `displayCards` branch, walk `msg.templates`, call `formatChatTemplateForTelegram`, and send each with `bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup })`. Wire an `on('callback_query', …)` handler at bot construction time that parses `callback_data` and routes the user's choice back into the message handler (same pathway as incoming text).
- **Slack** — `channels/slack/src/channel.ts`: push each template's `blocks` into the existing `chat.postMessage` call. The `action_id` on each Block Kit button follows the `flowId:stepId:optionId` convention; Slack's Bolt `app.action()` listener routes it back to the orchestrator as a synthetic incoming message.
- **WhatsApp** — `channels/whatsapp/src/channel.ts`: if `template.interactive` is present, call the Cloud API `messages` endpoint with `type: 'interactive'`. Button/list replies come back on the webhook as `interactive.button_reply.id` / `interactive.list_reply.id` — map these to an `IncomingMessage`.

The per-channel **callback → incoming message** translation is the tricky part. Treat a button tap as if the user typed the option's `query` field (for Query Builder / Waterfall leaves) or the option's `id` (for form steps). That way the existing orchestrator doesn't need to know about buttons at all.

### 5. Multi-step state for Manual Position & Waterfall

The webapp holds multi-step flow state in React `useState`. On messaging channels we need server-side state keyed by `(channelId, threadId)`:

- Add a `ChatTemplateSessionStore` under `src/sessions/` (JSONL-backed, per `.claude/rules/architecture.md` → file-driven state). Key: `channelId:threadId:flowId`. Value: `{ step, formState, updatedAt }`.
- On every template emission from the agent, the store writes the current state.
- On every callback/reply coming in, the channel looks up the store, advances the state machine, and either emits the next template or calls the underlying tool (e.g. `addManualPosition` for the final `confirm` step).
- Expire sessions after 30 minutes of inactivity (prune on read).

Wire this via the composition root (`src/composition.ts`) and pass the store into each channel's deps interface. **Don't forget the wiring checklist** from `.claude/rules/code-quality.md` — all four of: data dir in `src/paths.ts`, setter in `composition.ts`, (no GraphQL surface needed here), channel deps interface updated.

### 6. Emit templates from the orchestrator

Pilot one emission path end-to-end: when a user on a non-web channel sends `/start` or their first message of the day, the agent returns an `OutgoingMessage` with a Query Builder template. This replaces the current plain-text welcome.

For the other templates, hook them into the existing agent flows:
- Waterfall — emitted after a user taps a Query Builder suggestion that has sub-options
- Manual Position Step — emitted by the `addManualPosition` tool when invoked without all fields (each step emits the next template)
- Briefing Hero — emitted by the morning cron that currently posts the Morning Briefing display card

### 7. Pilot first, fan out after

Don't try to ship all five templates to all three channels in one PR — the blast radius is too big. Split it:

1. **Slice 1 (this story)**: land the `ChatTemplate` data model + `OutgoingMessage` field + Telegram renderer for `query-builder` only. End-to-end demo: `/start` on Telegram shows inline buttons, tapping one fires the agent.
2. **Slice 2**: add Slack Block Kit renderer for `query-builder`.
3. **Slice 3**: add WhatsApp interactive renderer for `query-builder`.
4. **Slice 4**: Waterfall on all three channels (needs `ChatTemplateSessionStore`).
5. **Slice 5**: Manual Position Step flow.
6. **Slice 6**: Briefing Hero.

The story's **AC below covers Slice 1**. The remaining slices are listed in **Follow-ups**.

## Acceptance Criteria

- [ ] `src/tools/chat-template-data.ts` exports `ChatTemplateSchema` + `ChatTemplate` type, with Zod schemas for all five template variants (query-builder, option-selector, waterfall-step, manual-position-step, briefing-hero)
- [ ] `OutgoingMessage` in `src/plugins/types.ts` has `templates?: ChatTemplate[]`
- [ ] `formatChatTemplateForTelegram` exists and handles all five variants, returning `{ text, replyMarkup? }`; every variant covered by a unit test in `test/`
- [ ] `channels/telegram/src/channel.ts` sends a Telegram inline-keyboard message when `msg.templates` contains a `query-builder` entry; the keyboard buttons carry `callback_data` under 64 bytes
- [ ] Telegram `callback_query` handler decodes button taps and re-enters the channel's `messageHandlers` with a synthetic `IncomingMessage` whose `text` is the chosen suggestion's `query`
- [ ] A `/start` on Telegram (or first inbound of the day) now emits a Query Builder template instead of the current plain-text welcome; verified manually against a real Telegram bot
- [ ] HTML-escape audit: all user-visible text passed to Telegram goes through `escapeHtml()` (per `.claude/rules/channel-formatting.md`) — no bare `&`, `<`, `>`
- [ ] `pnpm ci` passes (format + typecheck + lint + test)
- [ ] No new top-level GraphQL queries/mutations added for this slice (none needed — templates flow through the existing `OutgoingMessage` path)
- [ ] Unit test coverage: `chat-template-formatters.test.ts` covers every `ChatTemplate` variant for the Telegram renderer, including an exhaustiveness test that fails if a new variant is added without a case

## Files

**New:**
- `src/tools/chat-template-data.ts` — Zod schemas + types
- `src/tools/chat-template-formatters.ts` — per-channel renderers (or extend `channel-display-formatters.ts` if you prefer — just keep each channel's function grouped)
- `test/chat-template-formatters.test.ts`
- `src/sessions/chat-template-session-store.ts` — only if you're pulling Slice 4 into this story; otherwise defer

**Modified:**
- `src/plugins/types.ts` — add `templates?: ChatTemplate[]` to `OutgoingMessage`
- `channels/telegram/src/channel.ts` — consume templates, wire `callback_query` listener
- `channels/telegram/src/bot.ts` — may need an `InlineKeyboardMarkup` builder helper (already has `buildActionKeyboard` / `buildApprovalKeyboard` — follow the same pattern)
- `src/composition.ts` — (only if wiring the session store)
- `src/paths.ts` — (only if wiring the session store; add the data subdir)

## Dependencies

- **Blocks:** none
- **Blocked by:** none
- **Unblocks:**
  - Slack and WhatsApp template renderers (Slices 2 & 3)
  - Any future interactive flow the agent wants to emit (onboarding, skill creation, etc.)

## Follow-ups (separate stories)

- [ ] **Slice 2** — Slack Block Kit renderer for `query-builder` (`channels/slack/src/channel.ts`, add Bolt `action()` listener)
- [ ] **Slice 3** — WhatsApp interactive list/button renderer for `query-builder` (`channels/whatsapp/src/channel.ts`, handle `interactive.button_reply` webhook)
- [ ] **Slice 4** — Waterfall multi-step drill-down on all three channels (introduces `ChatTemplateSessionStore`)
- [ ] **Slice 5** — Manual Position Step flow on all three channels (reuses session store; each step emits the next template, final step calls `addManualPosition`)
- [ ] **Slice 6** — Briefing Hero on all three channels (wire into the existing morning cron emission path)
- [ ] **Parity audit** — walk through every component under `apps/web/src/components/chat/` and file a story for any template that still has no channel renderer

## Notes for the dev picking this up

- The existing `formatDisplayCardFor{Slack,Telegram,WhatsApp}` functions in `src/tools/channel-display-formatters.ts` are your reference — follow the same file layout, escaping rules, and switch-over-discriminator pattern.
- `channel-formatting.md` is strict on Telegram HTML escaping — every `&` must be `&amp;`, even in hardcoded strings. LLM text passed through must be escaped before concatenation.
- Telegram `callback_data` has a **64-byte** hard limit. Don't shove full queries in there — use compact IDs and look them up server-side via the session store (or via a tree definition file for stateless flows like Query Builder).
- For the pilot, the Query Builder is **stateless** — no session store needed. The button's `callback_data` can encode `qb:<id>` and the handler re-sends the suggestion's `query` as if the user typed it. Save the session store work for Slice 4 where you actually need it.
- Slack Block Kit `action_id` has a **255-char** limit, WhatsApp `list_reply.id` is **200 chars** — both are generous. Telegram is the tightest, so design the ID scheme around it.
- Don't mock the web card components into the channel layer — channels render natively. The shared surface is the `ChatTemplate` data, not the React tree.
