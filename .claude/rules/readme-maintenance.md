---
description: Keep README.md up to date when making structural changes
globs: ["**/*"]
---

# README Maintenance

Before every commit, check if any of these changed and update `README.md` accordingly:

- **New commands** added to `package.json` scripts → update Commands table
- **New channel** added to `channels/` → update Channels table
- **New top-level module** added to `src/` → update Project Structure
- **New dependency** that changes the tech stack → update Tech Stack
- **Quick start** steps changed (new env vars, different setup flow) → update Quick Start
- **Phase 1 scope** changed → update Phase 1 MVP section

Do NOT update the README for:
- Internal refactors that don't change the public structure
- New files within existing modules
- Test additions
- Bug fixes
