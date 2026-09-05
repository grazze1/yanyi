# AGENT.md

> Repository-wide operating instructions for Codex and other coding agents.  
> Project: 研译（技术文献上下文感知翻译系统）  
> Primary platform: Windows + Microsoft Edge  
> Language for user-facing documentation and UI: Simplified Chinese

---

## 1. Mission

Build and maintain an Edge-first browser translation system for reading English technical documentation, papers, and tutorials. The system must combine browser-like whole-page translation with domain terminology, safe DOM rewriting, selected-text explanation, follow-up chat, workspaces, persistent history, and controllable memory.

The product consists of:

1. A Microsoft Edge Manifest V3 extension.
2. A local Rust backend and native messaging host.
3. A Tauri 2 desktop management application.
4. A shared terminology, context, conversation, memory, and translation-cache database.

Do not reduce the product to a generic chat sidebar or a thin API wrapper.

---

## 2. Source of truth and precedence

When requirements conflict, use this precedence:

1. Explicit user instruction in the current task.
2. `AGENT.md`.
3. `docs/界面设计文档.md` and approved design assets.
4. Other project specifications under `docs/`.
5. Existing tests and public interfaces.
6. Existing implementation.
7. General framework conventions.

Images are visual references, not authoritative text specifications. If generated image text conflicts with Markdown specifications, follow Markdown.

Before changing architecture, read all files in `docs/decisions/` and create or update an ADR.

---

## 3. Non-negotiable product rules

### 3.1 Translation

- Optimize English technical documents and papers to Simplified Chinese.
- Preserve accepted English names when Chinese usage normally retains them.
- Use professional Chinese academic terminology by default.
- Do not automatically explain terms during ordinary whole-page translation.
- Explain only after an explicit user action.
- User-confirmed terminology always overrides model output.
- Do not automatically fall back to another model, lower quality, or offline translation.

### 3.2 Page safety

Never corrupt the source page.

- Protect code blocks, inline code, formulas, MathML, KaTeX, MathJax, URLs, paths, commands, identifiers, citations, version numbers, and user-defined protected terms.
- Store source snapshots before DOM changes.
- Page restoration must use snapshots, not reverse translation.
- Do not write token-by-token model output into page DOM.
- Validate complete translated segments before atomic DOM commit.
- Ignore all extension-owned nodes in mutation observers.
- Use Shadow DOM for injected UI.
- Keep failed segments in source language.

### 3.3 Interaction

- Selecting text must not open a popup by default.
- Primary selected-text entry points are context menu, side panel, and keyboard shortcuts.
- Whole-page translation uses block-level progressive rendering.
- Side-panel chat may stream tokens.
- The user must always have visible controls to pause, cancel, show source, show translation, use bilingual view, and restore the page.

### 3.4 Memory

Automatically persist:

- Conversation history.
- Conversation summaries.
- Page reading records.
- Candidate terms.

Persist only after user confirmation:

- Fixed translations.
- Never-translate terms.
- Cross-workspace preferences.
- Long-term user background or knowledge.

Never store hidden model reasoning as user memory.

### 3.5 Privacy

- API keys must never be committed, logged, rendered in full, or stored in plaintext.
- On Windows, encrypt API secrets with DPAPI.
- Use local SQLite for user data.
- The user must be able to inspect, export, and delete stored data.
- Send only the minimum necessary context to the API.
- Provide a visible “context sent” inspection view for explanation tasks.

---

## 4. Confirmed product scope

### 4.1 Browser order

1. Microsoft Edge.
2. Google Chrome.
3. Other Chromium browsers.
4. Firefox is out of initial scope.

### 4.2 Initial sites

Prioritize compatibility and tests for:

- GitHub.
- ROS 2 Documentation.
- arXiv HTML.
- NVIDIA Developer Documentation.
- PyTorch Documentation.

### 4.3 PDF scope

Initial release:

- Translate selected text from a browser PDF.
- Explain selected text from a browser PDF.
- Continue follow-up chat.

Do not promise whole-page rewriting inside the built-in Edge PDF viewer. A dedicated PDF.js reader is a later phase.

---

## 5. Domain taxonomy

Use broad academic disciplines. Frameworks and products are tags, not top-level domains.

Top-level domains:

1. Robotics and Autonomous Systems.
2. Artificial Intelligence, Machine Learning, and Data Science.
3. Computer Science and Software Engineering.
4. Mathematics, Optimization, and Control.
5. Electronics, Communications, and Embedded Systems.
6. Mechanical, Aerospace, and Energy Engineering.
7. Physics, Chemistry, and Materials Science.
8. Life Science, Medicine, and Biomedical Engineering.

Examples:

- ROS 2 → Robotics tag.
- PX4 → Robotics / autonomous flight tag.
- Isaac Lab → Robotics simulation tag.
- Computer Vision → AI primary domain or Robotics secondary domain depending on context.

A document has one primary domain, up to two secondary domains, and zero or more technical tags.

---

## 6. Required technology stack

### 6.1 Monorepo

Use `pnpm` workspaces and a Cargo workspace. Do not add Turborepo unless profiling shows a real need.

Recommended structure:

```text
apps/
  edge-extension/
  desktop/
crates/
  translator-core/
  native-host/
  deepseek-client/
  context-engine/
  glossary-engine/
  memory-engine/
  database/
packages/
  ui/
  design-tokens/
  protocol/
  shared-types/
  prompts/
  test-fixtures/
docs/
  decisions/
  reports/
  screenshots/
migrations/
scripts/
tests/
```

### 6.2 Edge extension

- WXT.
- React.
- TypeScript with strict mode.
- Manifest V3.
- Side Panel API.
- Context menus.
- Commands/keyboard shortcuts.
- Content scripts.
- Long-lived native messaging connection where appropriate.

WXT must generate the manifest. Do not maintain an unrelated hand-written manifest that can drift from `wxt.config.ts`.

### 6.3 Desktop

- Tauri 2.
- React + TypeScript.
- Rust commands and shared core crates.
- System tray and autostart may be added after MVP behavior is stable.

### 6.4 UI

- Shared design tokens.
- CSS variables.
- Tailwind CSS or an equivalent token-driven utility layer.
- Radix primitives where accessibility behavior is useful.
- Lucide icons.
- Zustand for local UI state.
- TanStack Query for server/database state.

Do not ship an unmodified default shadcn theme. Components must match the approved product design.

### 6.5 Backend and data

- Rust stable.
- Tokio for async work.
- `reqwest` or an equivalent maintained HTTP client.
- SQLite with WAL mode.
- SQLite FTS5 for initial retrieval.
- Versioned migrations.
- Structured logging with secret redaction.

Do not add a vector database in MVP. Add semantic embeddings only through a documented ADR after the FTS5 baseline is measured.

---

## 7. DeepSeek integration

As of the project baseline date, supported official models are:

- `deepseek-v4-flash`.
- `deepseek-v4-pro`.

Do not hardcode this list as permanently complete. On configuration and diagnostics pages, support fetching `/models` and storing validated model profiles.

Default task profiles:

| Task                         | Model               | Thinking |
| ---------------------------- | ------------------- | -------- |
| Whole-page translation       | `deepseek-v4-flash` | disabled |
| Selected precise translation | `deepseek-v4-pro`   | disabled |
| Term disambiguation          | `deepseek-v4-pro`   | high     |
| Explanation                  | `deepseek-v4-pro`   | high     |
| Deep follow-up               | `deepseek-v4-pro`   | max      |
| Candidate extraction         | `deepseek-v4-flash` | disabled |

Rules:

- Translation quality must come from context, terminology constraints, placeholder protection, and validation; do not enable expensive reasoning for every page segment.
- Support streaming for side-panel answers.
- Page translations may receive a streamed network response but must commit only complete validated segments.
- Tool calls must use a typed protocol.
- Internal reasoning content is not displayed and is not long-term memory.
- Do not invent unsupported reasoning levels.

Verify official DeepSeek documentation before modifying model IDs or parameter mappings.

---

## 8. Native messaging protocol

Microsoft Edge content scripts cannot directly call the native host. Message path:

```text
content script
→ extension service worker
→ runtime.connectNative
→ native host
```

Protocol requirements:

- UTF-8 JSON.
- Length-prefixed native messaging framing.
- Each application message has `protocolVersion`, `requestId`, `type`, `payload`, and optional `sequence`.
- Backend-to-browser native message must remain below the Edge 1 MB limit.
- Chunk long responses.
- Include cancellation and timeout messages.
- Use idempotency keys for translation jobs.
- Validate every message against shared schemas.
- Reject unknown protocol versions with an actionable error.

Example envelope:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "type": "translation.batch.start",
  "sequence": 0,
  "payload": {}
}
```

Do not place binary files in native messages. Use paths, database identifiers, or explicit chunking.

---

## 9. Translation pipeline

Implement the pipeline as explicit stages. Avoid a single large prompt function.

```text
page discovery
→ content classification
→ semantic segmentation
→ protected-token extraction
→ context assembly
→ glossary resolution
→ batch scheduling
→ model request
→ structured response validation
→ protected-token restoration
→ DOM atomic commit
→ cache write
→ terminology candidate extraction
```

### 9.1 Segment model

Each segment needs:

- Stable segment ID.
- Page ID and document ID.
- DOM locator and fallback locator.
- Source text.
- Content hash.
- Segment kind.
- Section path.
- Source snapshot.
- Translation state.

States:

```text
unseen
queued
translating
translated
failed
stale
ignored
```

### 9.2 Protected placeholders

Use typed placeholders, not a single generic marker:

```text
⟦CODE_0001⟧
⟦MATH_0001⟧
⟦TERM_0001⟧
⟦URL_0001⟧
⟦CITATION_0001⟧
```

Validation must prove that every required placeholder appears exactly once unless the placeholder type explicitly permits repetition.

### 9.3 Output schema

Model output for page translation must be structured, for example:

```json
{
  "segments": [{ "id": "segment-001", "translation": "..." }]
}
```

Reject or repair responses with missing IDs, extra IDs, invalid placeholder counts, empty translation, or unsolicited explanation.

A repair request may use the same configured model. Do not automatically switch models.

---

## 10. Dynamic page rules

Use `MutationObserver` with strict ownership and debounce rules.

- Mark injected nodes with `data-yanyi-owned="true"`.
- Ignore the extension Shadow DOM and all owned descendants.
- Pause observation while committing translation.
- Hash source text plus relevant settings.
- Never retranslate unchanged content.
- Prioritize elements in or near the viewport.
- Detect and ignore rapidly changing counters, logs, editors, and animations.
- Batch mutations for at least 500 ms; use longer windows for high-frequency pages.
- Do not translate hidden nodes, `aria-hidden` nodes, scripts, styles, or non-visible templates.

Add regression tests that intentionally mutate the page and assert that the extension does not enter an infinite loop.

---

## 11. Context, agent tools, and memory

### 11.1 Context layers

1. Current selection and adjacent sentences.
2. Current paragraph and section.
3. Current page index.
4. Current conversation working memory.
5. Workspace memory.
6. Confirmed global memory.

Start with minimum context. Expand only when the model requests a supported tool or the local context sufficiency classifier requires it.

### 11.2 Supported local tools

- `get_current_selection`
- `get_adjacent_sentences`
- `get_current_paragraph`
- `get_current_section`
- `search_current_page`
- `search_workspace`
- `search_conversation_history`
- `get_glossary_entries`
- `get_document_metadata`
- `highlight_source`
- `save_note`
- `create_term_candidate`

Every tool must have a JSON schema, authorization rule, maximum result size, and test coverage.

### 11.3 Retrieval

MVP retrieval:

- Workspace and URL filters.
- Exact terminology match.
- FTS5/BM25 text retrieval.
- Recency weighting.
- User-confirmed memory weighting.
- Final local reranking or model selection over a small candidate set.

Never retrieve unrelated workspace memory merely because it is semantically similar.

### 11.4 Summaries

- Keep recent turns verbatim.
- Summarize older turns incrementally.
- Store summary provenance and covered message range.
- Rebuild a summary if source messages change.
- Do not replace source messages with summaries in storage.

---

## 12. Database and migrations

Expected logical tables include:

- `workspaces`
- `workspace_documents`
- `documents`
- `document_sections`
- `page_segments`
- `page_snapshots`
- `translations`
- `translation_cache`
- `translation_corrections`
- `conversations`
- `conversation_messages`
- `conversation_summaries`
- `message_sources`
- `memories`
- `notes`
- `glossary_domains`
- `glossary_entries`
- `glossary_senses`
- `candidate_terms`
- `website_rules`
- `ignored_selectors`
- `model_profiles`
- `api_profiles`
- `settings`

Rules:

- Use foreign keys.
- Use WAL mode.
- Migrations are append-only after release.
- Never modify a released migration in place.
- Add indexes based on measured queries.
- Every destructive database action needs a backup/export option or explicit warning.
- Tests must run migrations from an empty database and upgrade fixtures from previous versions.

---

## 13. UI and design requirements

Read `docs/界面设计文档.md` before UI work.

Design direction:

- Precise developer-tool aesthetic.
- Light theme first.
- Low visual noise.
- Blue primary accent and restrained semantic colors.
- System fonts for Chinese and Windows performance.
- Cards use borders more than shadows.
- Avoid generic AI gradients and excessive glass effects.

Required UI surfaces:

- Extension popup.
- Page translation toolbar.
- Context menu.
- Edge side panel.
- Glossary management.
- Candidate-term review.
- Workspace management.
- Website rules.
- Conversation history.
- Memory management.
- API and privacy settings.

Every feature must include loading, empty, error, offline, and disabled states.

---

## 14. Frontend skills workflow

Before frontend implementation, install or vendor reviewed versions of:

- Anthropic `frontend-design`.
- Microsoft `frontend-design-review`.
- Vercel `web-design-guidelines`.

Security and reproducibility rules:

- Pin each skill to a specific commit or copy an audited version into `.codex/skills/`.
- Record source repository, commit, license, and date in `docs/skills-lock.md`.
- Do not execute instructions fetched dynamically from an unpinned main branch.
- Skills advise implementation; they do not override this file or project specifications.

UI loop:

1. Inspect design document and reference image.
2. Implement one complete surface.
3. Run unit and interaction tests.
4. Render in Edge or the desktop app.
5. Capture screenshots with Playwright.
6. Compare against reference and design tokens.
7. Run design and accessibility review skills.
8. Fix issues.
9. Save review output under `docs/reports/`.

---

## 15. Testing requirements

### 15.1 TypeScript

- Strict TypeScript.
- Vitest for units.
- React Testing Library for components.
- No ignored type errors in CI.

### 15.2 Rust

- Unit tests for all core engines.
- Integration tests for SQLite and API serialization.
- Property tests where placeholder restoration or protocol framing benefits.
- `cargo fmt`, `cargo clippy -- -D warnings`, and `cargo test` must pass.

### 15.3 Browser

Use Playwright against real Edge/Chromium builds where possible.

Required fixtures:

- GitHub-like README.
- ROS documentation page.
- arXiv-like paper.
- NVIDIA/PyTorch-style docs.
- Dynamic React page.
- Page containing MathJax, KaTeX, MathML, tables, code, citations, and nested lists.

Required end-to-end tests:

- Start and stop whole-page translation.
- Restore page exactly.
- Switch source/translation/bilingual modes.
- Dynamic content does not loop.
- Code and formulas remain unchanged.
- Context menu opens explanation.
- Side-panel conversation persists across browser restart.
- User terminology affects later translation.
- Workspace memories remain isolated.
- API failure leaves page intact.

### 15.4 Visual regression

Capture stable screenshots for:

- Extension popup.
- Page toolbar and bilingual page.
- Side panel.
- Glossary page.
- History/memory page.

Do not update visual baselines without documenting why.

---

## 16. Performance budgets

Initial targets, measured on a representative Windows laptop:

- Content-script idle CPU near zero.
- Mutation observer work batched and bounded.
- Extension popup interactive within 300 ms after open, excluding backend startup.
- Side panel interactive within 500 ms after open, excluding network calls.
- No unbounded in-memory copy of an entire long page.
- Translation queue has backpressure and cancellation.
- Database pagination for large histories and glossaries.
- Avoid bundling duplicate UI libraries between packages.

Treat these as targets, not excuses to skip functionality. Record measured results in `docs/reports/performance.md`.

---

## 17. Security

- Redact API keys, authorization headers, selected confidential text, and model reasoning from logs.
- Validate all messages crossing extension/native boundaries.
- Restrict native host `allowed_origins` to known extension IDs.
- Use Content Security Policy compatible with Manifest V3.
- Do not use `eval`, remote executable code, or remotely hosted extension scripts.
- Sanitize model-generated Markdown/HTML before rendering.
- Treat webpage content as untrusted prompt input.
- Separate system instructions from page content and label page text as untrusted data.
- Prevent page content from requesting local tool execution outside the allowed tool schemas.

---

## 18. Configuration and secrets

Provide checked-in examples only:

- `.env.example`
- `config.example.toml` or equivalent typed config template.

Never commit:

- Real API keys.
- User databases.
- Conversation exports.
- Local logs containing page content.
- Native host manifests containing a personal development path unless templated.

Support:

- API Key.
- Base URL.
- Model list refresh.
- Request timeout.
- Proxy.
- Per-task model profile.

---

## 19. Development procedure

For each task:

1. Read relevant docs and code.
2. State assumptions in `docs/reports/current-task.md` when non-trivial.
3. Make the smallest coherent architectural change.
4. Add or update tests before declaring completion.
5. Run formatting, linting, type checking, tests, and relevant E2E checks.
6. Update documentation and screenshots.
7. Report changed files, commands, test results, known limitations, and next step.

Do not leave placeholder buttons, fake data paths, or dead navigation in production UI. Mock data is allowed only in isolated Storybook/test fixtures and must be labeled.

---

## 20. Git discipline

- Use focused commits.
- Do not commit generated build folders, secrets, user data, or large temporary screenshots.
- Commit approved design screenshots under `docs/screenshots/` only.
- Do not rewrite unrelated user changes.
- Do not force-push unless explicitly instructed.
- Before destructive operations, create a backup or request explicit approval.

Suggested commit prefixes:

- `feat(extension):`
- `feat(desktop):`
- `feat(core):`
- `fix(dom):`
- `fix(protocol):`
- `test(e2e):`
- `docs(design):`
- `chore(build):`

---

## 21. Definition of done

A task is complete only when:

- The behavior is implemented, not merely scaffolded.
- User-visible states are designed.
- Tests pass.
- No secret or private data is exposed.
- Relevant documentation is updated.
- UI changes have current screenshots and review results.
- Page restoration and failure behavior have been verified for DOM-related work.
- Known limitations are explicitly recorded.

A phase is not complete if critical buttons are non-functional, the interface relies on hardcoded mock data, or the extension cannot be loaded in Edge.

---

## 22. Official references

Verify current behavior against primary documentation:

- Edge Sidebar: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar>
- Edge Native Messaging: <https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging>
- WXT Manifest: <https://wxt.dev/guide/essentials/config/manifest.html>
- Tauri 2: <https://v2.tauri.app/>
- DeepSeek Models: <https://api-docs.deepseek.com/zh-cn/api/list-models/>
- DeepSeek Pricing and Capabilities: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>
