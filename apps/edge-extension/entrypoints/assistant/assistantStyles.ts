export const assistantStyles = String.raw`
.yanyi-theme {
  --yanyi-bg: var(--color-bg, #f7f9fc);
  --yanyi-surface: var(--color-surface, #fff);
  --yanyi-subtle: var(--color-surface-subtle, #f1f5f9);
  --yanyi-border: var(--color-border, #e2e8f0);
  --yanyi-border-strong: var(--color-border-strong, #cbd5e1);
  --yanyi-text: var(--color-text, #0f172a);
  --yanyi-text-secondary: var(--color-text-secondary, #475569);
  --yanyi-muted: var(--color-text-muted, #64748b);
  --yanyi-primary: var(--color-primary, #2563eb);
  --yanyi-primary-hover: var(--color-primary-hover, #1d4ed8);
  --yanyi-primary-soft: var(--color-primary-soft, #eff6ff);
  --yanyi-danger: var(--color-danger, #dc2626);
  --yanyi-warning: var(--color-warning, #d97706);
  --yanyi-success: var(--color-success, #16a34a);
  --yanyi-focus: var(--focus-ring, 0 0 0 3px rgb(37 99 235 / 25%));
  --yanyi-font: var(--font-sans, system-ui, 'Segoe UI', 'Microsoft YaHei UI', sans-serif);
  --yanyi-mono: var(--font-mono, 'Cascadia Code', Consolas, monospace);
  color: var(--yanyi-text);
  font-family: var(--yanyi-font);
  font-size: 13px;
  line-height: 1.55;
}

.yanyi-theme *,
.yanyi-theme *::before,
.yanyi-theme *::after {
  box-sizing: border-box;
}

.yanyi-theme button,
.yanyi-theme input,
.yanyi-theme select,
.yanyi-theme textarea {
  color: inherit;
  font: inherit;
}

.yanyi-theme button {
  cursor: pointer;
  touch-action: manipulation;
}

.yanyi-theme button:disabled,
.yanyi-theme input:disabled,
.yanyi-theme select:disabled,
.yanyi-theme textarea:disabled {
  cursor: not-allowed;
  opacity: .52;
}

.yanyi-theme :is(button, input, select, textarea, a):focus-visible {
  border-color: var(--yanyi-primary);
  outline: none;
  box-shadow: var(--yanyi-focus);
}

.yanyi-visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

.yanyi-conversation {
  display: grid;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--yanyi-bg);
}

.yanyi-context {
  position: relative;
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr);
  margin: 12px;
  overflow: hidden;
  border: 1px solid var(--yanyi-border);
  border-radius: 10px;
  background: var(--yanyi-surface);
}

.yanyi-context__rail {
  background: var(--yanyi-primary);
}

.yanyi-context__body {
  min-width: 0;
  padding: 11px 12px 10px;
}

.yanyi-context__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.yanyi-context__heading > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.yanyi-context__heading strong {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanyi-eyebrow {
  color: var(--yanyi-primary);
  font-family: var(--yanyi-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.yanyi-link-button {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 3px 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--yanyi-primary);
  font-size: 10px;
}

.yanyi-link-button:hover {
  background: var(--yanyi-primary-soft);
}

.yanyi-context__selection {
  display: -webkit-box;
  margin: 8px 0 0;
  overflow: hidden;
  color: var(--yanyi-text-secondary);
  font-size: 11px;
  line-height: 17px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.yanyi-context__sources {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.yanyi-context__sources span {
  display: inline-flex;
  min-height: 23px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  padding: 2px 7px;
  overflow: hidden;
  border: 1px solid var(--yanyi-border);
  border-radius: 6px;
  background: var(--yanyi-subtle);
  color: var(--yanyi-text-secondary);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanyi-context__details {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--yanyi-border);
}

.yanyi-context__details p {
  max-height: 98px;
  margin: 0 0 8px;
  overflow: auto;
  color: var(--yanyi-muted);
  font-size: 10px;
}

.yanyi-secondary-action {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid var(--yanyi-border);
  border-radius: 7px;
  background: var(--yanyi-surface);
  color: var(--yanyi-primary);
  font-size: 10px;
}

.yanyi-timeline {
  padding: 2px 12px 18px;
}

.yanyi-conversation__stream {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.yanyi-conversation-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 210px;
  padding: 30px 32px;
  color: var(--yanyi-muted);
  text-align: center;
}

.yanyi-conversation-empty svg {
  margin-bottom: 10px;
  color: var(--yanyi-primary);
}

.yanyi-conversation-empty strong {
  color: var(--yanyi-text);
  font-size: 13px;
}

.yanyi-conversation-empty p {
  max-width: 290px;
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 18px;
}

.yanyi-message {
  width: min(100%, 680px);
  margin: 0 auto 14px;
}

.yanyi-message > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
  color: var(--yanyi-muted);
  font-size: 9px;
}

.yanyi-message > header strong {
  color: var(--yanyi-text-secondary);
  font-size: 10px;
}

.yanyi-message > header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanyi-message__content {
  overflow-wrap: anywhere;
  color: var(--yanyi-text);
  font-size: 12px;
  line-height: 1.7;
}

.yanyi-message--user .yanyi-message__content {
  width: fit-content;
  max-width: 88%;
  margin-left: auto;
  padding: 8px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 9px 9px 2px;
  background: var(--yanyi-primary-soft);
}

.yanyi-message--user > header {
  justify-content: flex-end;
}

.yanyi-message__content > p,
.yanyi-markdown > :first-child {
  margin-top: 0;
}

.yanyi-message__content > p,
.yanyi-markdown > :last-child {
  margin-bottom: 0;
}

.yanyi-generating {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--yanyi-muted);
}

.yanyi-generating svg {
  animation: yanyi-spin 900ms linear infinite;
}

.yanyi-inline-error {
  margin: 7px 0 0;
  padding: 7px 9px;
  border-left: 2px solid var(--yanyi-danger);
  background: #fef2f2;
  color: #991b1b;
  font-size: 10px;
}

.yanyi-message__actions {
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  opacity: .72;
}

.yanyi-message--user .yanyi-message__actions {
  justify-content: flex-end;
}

.yanyi-message:hover .yanyi-message__actions,
.yanyi-message:focus-within .yanyi-message__actions {
  opacity: 1;
}

.yanyi-message__actions button {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--yanyi-muted);
  font-size: 9px;
}

.yanyi-message__actions button:hover {
  background: var(--yanyi-subtle);
  color: var(--yanyi-text-secondary);
}

.yanyi-message__actions span {
  margin-left: 4px;
  color: var(--yanyi-danger);
  font-size: 9px;
}

.yanyi-markdown p {
  margin: 0 0 8px;
}

.yanyi-markdown h2,
.yanyi-markdown h3,
.yanyi-markdown h4 {
  margin: 14px 0 5px;
  color: var(--yanyi-text);
  line-height: 1.45;
}

.yanyi-markdown h2 { font-size: 14px; }
.yanyi-markdown h3 { font-size: 13px; }
.yanyi-markdown h4 { font-size: 12px; }

.yanyi-markdown :is(ul, ol) {
  margin: 6px 0 9px;
  padding-left: 20px;
}

.yanyi-markdown li + li {
  margin-top: 3px;
}

.yanyi-markdown a {
  color: var(--yanyi-primary);
  text-underline-offset: 2px;
}

.yanyi-markdown :not(pre) > code {
  padding: 1px 4px;
  border: 1px solid var(--yanyi-border);
  border-radius: 4px;
  background: var(--yanyi-subtle);
  font-family: var(--yanyi-mono);
  font-size: .92em;
}

.yanyi-markdown pre {
  position: relative;
  max-width: 100%;
  margin: 8px 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--yanyi-border);
  border-radius: 7px;
  background: #0f172a;
  color: #e2e8f0;
  font: 10px/1.6 var(--yanyi-mono);
}

.yanyi-markdown blockquote {
  margin: 8px 0;
  padding-left: 10px;
  border-left: 2px solid var(--yanyi-primary);
  color: var(--yanyi-text-secondary);
}

.yanyi-citations {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}

.yanyi-citations > strong {
  font-size: 10px;
}

.yanyi-citations button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1px 6px;
  min-height: 44px;
  padding: 7px 8px;
  border: 1px solid var(--yanyi-border);
  border-radius: 7px;
  background: var(--yanyi-surface);
  text-align: left;
}

.yanyi-citations button > span {
  grid-row: 1 / 3;
  align-self: start;
  margin-top: 1px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--yanyi-primary-soft);
  color: var(--yanyi-primary);
  font-size: 8px;
}

.yanyi-citations button > strong,
.yanyi-citations button > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.yanyi-citations button > strong { font-size: 9px; }
.yanyi-citations button > small { color: var(--yanyi-muted); font-size: 8px; }

.yanyi-term-editor {
  display: grid;
  gap: 7px;
  margin-top: 7px;
  padding: 9px;
  border: 1px solid var(--yanyi-border);
  border-radius: 8px;
  background: var(--yanyi-subtle);
}

.yanyi-term-editor label { font-size: 10px; font-weight: 600; }
.yanyi-term-editor input {
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid var(--yanyi-border-strong);
  border-radius: 7px;
  background: var(--yanyi-surface);
  font-size: 11px;
}
.yanyi-term-editor > div { display: flex; justify-content: flex-end; gap: 6px; }
.yanyi-term-editor button {
  min-height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--yanyi-border);
  border-radius: 6px;
  background: var(--yanyi-surface);
  font-size: 10px;
}
.yanyi-term-editor button:last-child { border-color: var(--yanyi-primary); background: var(--yanyi-primary); color: #fff; }
.yanyi-term-editor p { margin: 0; color: var(--yanyi-muted); font-size: 9px; }

.yanyi-composer {
  position: sticky;
  z-index: 2;
  bottom: 0;
  display: grid;
  gap: 6px;
  padding: 9px 12px 11px;
  border-top: 1px solid var(--yanyi-border);
  background: var(--yanyi-surface);
}

.yanyi-model-controls {
  display: grid;
  grid-template-columns: 94px minmax(110px, 1fr) 66px 66px;
  gap: 5px;
  align-items: end;
}

.yanyi-model-controls label {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.yanyi-model-controls label > span {
  color: var(--yanyi-muted);
  font-family: var(--yanyi-mono);
  font-size: 8px;
}

.yanyi-model-controls select {
  width: 100%;
  min-width: 0;
  min-height: 27px;
  padding: 3px 20px 3px 5px;
  overflow: hidden;
  border: 1px solid var(--yanyi-border);
  border-radius: 6px;
  background: var(--yanyi-surface);
  color: var(--yanyi-text-secondary);
  font-size: 9px;
  text-overflow: ellipsis;
}

.yanyi-model-controls__error {
  grid-column: 1 / -1;
  padding: 4px 6px;
  border-left: 2px solid var(--yanyi-warning);
  background: #fffbeb;
  color: #92400e;
  font-size: 9px;
  line-height: 14px;
}

.yanyi-model-controls.is-compact {
  grid-template-columns: 88px minmax(108px, 1fr) 62px;
}

.yanyi-model-controls.is-compact label:nth-of-type(4) {
  grid-column: 2 / 4;
}

.yanyi-composer__controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.yanyi-composer__controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--yanyi-muted);
  font-size: 9px;
}

.yanyi-composer__controls select {
  min-height: 28px;
  padding: 3px 24px 3px 7px;
  border: 1px solid var(--yanyi-border);
  border-radius: 6px;
  background: var(--yanyi-surface);
  font-size: 10px;
}

.yanyi-composer__controls > button {
  min-height: 28px;
  padding: 3px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--yanyi-primary);
  font-size: 10px;
}

/* Shortcut intents: "解释这段" and friends send an ordinary message through the
   same chat pipeline rather than starting a separate explanation flow. */
.yanyi-quick-intents {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 10px 6px;
}

.yanyi-quick-intents button {
  min-height: 26px;
  padding: 3px 9px;
  border: 1px solid var(--yanyi-border);
  border-radius: 999px;
  background: var(--yanyi-surface);
  color: var(--yanyi-text-secondary);
  cursor: pointer;
  font-size: 10px;
}

.yanyi-quick-intents button:hover:not(:disabled) {
  border-color: var(--yanyi-primary);
  color: var(--yanyi-primary);
}

.yanyi-quick-intents button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.yanyi-model-controls__verify {
  min-height: 26px;
  padding: 3px 8px;
  border: 1px solid var(--yanyi-primary);
  border-radius: 6px;
  background: transparent;
  color: var(--yanyi-primary);
  cursor: pointer;
  font-size: 10px;
}

.yanyi-model-controls__verify:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.yanyi-model-controls__status {
  color: var(--yanyi-muted);
  font-size: 9px;
}

.yanyi-composer__input {
  position: relative;
}

.yanyi-composer textarea {
  display: block;
  width: 100%;
  min-height: 68px;
  max-height: 180px;
  resize: vertical;
  padding: 9px 43px 9px 10px;
  border: 1px solid var(--yanyi-border-strong);
  border-radius: 9px;
  background: var(--yanyi-surface);
  color: var(--yanyi-text);
  font-size: 12px;
  line-height: 18px;
}

.yanyi-composer textarea::placeholder { color: var(--yanyi-muted); }

.yanyi-send {
  position: absolute;
  right: 7px;
  bottom: 7px;
  display: grid;
  width: 31px;
  height: 31px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: var(--yanyi-primary);
  color: #fff !important;
}

.yanyi-send:hover:not(:disabled) { background: var(--yanyi-primary-hover); }
.yanyi-send--stop { background: var(--yanyi-text); }

.yanyi-composer__footnote {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.yanyi-composer__footnote small {
  color: var(--yanyi-muted);
  font-size: 8px;
}

.yanyi-composer__footnote small:last-child {
  text-align: right;
}

.yanyi-conversation--compact {
  height: 100%;
  grid-template-rows: minmax(84px, auto) minmax(72px, 1fr) auto;
}

.yanyi-conversation--compact .yanyi-context {
  min-height: 84px;
  margin: 7px 9px 5px;
}
.yanyi-conversation--compact .yanyi-context__body { padding: 6px 8px; }
.yanyi-conversation--compact .yanyi-context__selection {
  margin-top: 4px;
  -webkit-line-clamp: 1;
}
.yanyi-conversation--compact .yanyi-context__sources { margin-top: 5px; }
.yanyi-conversation--compact .yanyi-timeline { padding: 4px 9px 9px; }
.yanyi-conversation--compact .yanyi-message { margin-bottom: 10px; }
.yanyi-conversation--compact .yanyi-conversation-empty {
  min-height: 100px;
  padding: 10px 20px;
}
.yanyi-conversation--compact .yanyi-conversation-empty svg { margin-bottom: 4px; }
.yanyi-conversation--compact .yanyi-conversation-empty p { margin-top: 3px; line-height: 15px; }
.yanyi-conversation--compact .yanyi-composer { gap: 4px; padding: 6px 9px 7px; }
.yanyi-conversation--compact .yanyi-model-controls label > span { display: none; }
.yanyi-conversation--compact .yanyi-composer textarea { min-height: 50px; resize: none; }
.yanyi-conversation--compact .yanyi-composer__footnote small:last-child { display: none; }

@media (max-width: 350px) {
  .yanyi-model-controls {
    grid-template-columns: 88px minmax(108px, 1fr) 62px;
  }
  .yanyi-model-controls label:nth-of-type(4) { grid-column: 2 / 4; }
}

@keyframes yanyi-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .yanyi-theme *,
  .yanyi-theme *::before,
  .yanyi-theme *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`;
