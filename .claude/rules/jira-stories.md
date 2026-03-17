---
description: Rules for creating Jira stories
globs: ["**/*"]
---

# Jira Story Format

Every story must be vertical and fully self-contained — a dev can pick it up without reading other stories.

## Structure

### Title
Short, action-oriented. `Build encrypted credential vault` not `Implement Layer 1 of Trust Stack`.

### Description

```
## Why
[1-2 sentences. What problem does this solve? What breaks or is missing without it?]

## How
[Talk to the dev. Walk them through the approach — what to build, where it lives, what patterns to follow.]

## Acceptance Criteria
- [ ] Concrete, testable checkboxes
- [ ] Include the test expectation ("unit test covers X")
- [ ] Include the integration point ("registers with ToolRegistry via adapter.ts")

## Files
[List the files/directories this story touches. Helps avoid merge conflicts.]

## Dependencies
[What must be done before this? What does this unblock?]
```

## Rules

- **Vertical slices** — each story delivers working functionality, not a layer. "Build PII redactor with tests" not "Write PII interfaces".
- **Self-contained** — include enough context that a dev doesn't need to read the architecture plan. Copy relevant interface definitions into the story if needed.
- **Speak like a dev** — no PM jargon. "You'll need to..." not "The system shall...". Reference actual file paths, function names, types.
- **Why before How** — always start with why this matters, then explain how to build it.
- **Story points** — use the team's scale. Include estimate in the story.
- **Labels** — tag with owner and domain (data-pipeline/runtime/security/api).
