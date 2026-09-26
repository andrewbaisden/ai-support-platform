// Bundled in the JavaScript entry and injected into this widget's ShadowRoot.
// Consumers do not need a CSS import or Tailwind configuration.
export const widgetStyles = `
:host { all: initial; position: fixed; z-index: 2147483000; bottom: max(20px, env(safe-area-inset-bottom)); right: max(20px, env(safe-area-inset-right)); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2937; }
:host([data-position="bottom-left"]) { right: auto; left: max(20px, env(safe-area-inset-left)); }
*, *::before, *::after { box-sizing: border-box; }
button, input, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: wait; opacity: .7; }
:focus-visible { outline: 3px solid #4f7dff; outline-offset: 3px; }
.root { --surface: #fff; --surface-alt: #f6f8fc; --text: #172033; --muted: #667085; --border: #dce3ed; --accent: #365be6; --accent-hover: #2747c5; --accent-text: #fff; --danger: #ae2d36; --shadow: 0 22px 70px rgba(17, 31, 60, .22), 0 2px 10px rgba(17, 31, 60, .08); color: var(--text); color-scheme: light; }
.root[data-theme="dark"] { --surface: #151c2b; --surface-alt: #202b3c; --text: #f2f5fb; --muted: #acb8cd; --border: #39465c; --accent: #90a8ff; --accent-hover: #b3c2ff; --accent-text: #10182a; --danger: #ff949b; --shadow: 0 24px 80px rgba(0, 0, 0, .5); color-scheme: dark; }
.launcher { display: inline-flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 20px; border: 1px solid rgba(255,255,255,.15); border-radius: 999px; background: #17284a; color: #fff; box-shadow: var(--shadow); font-weight: 650; letter-spacing: .01em; }
.launcher:hover { background: #233d70; }
.launcher svg { width: 20px; height: 20px; flex: none; }
.panel { width: min(380px, calc(100vw - 24px)); max-height: min(680px, calc(100dvh - 32px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow); }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 20px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
.eyebrow { margin: 0 0 4px; color: var(--accent); font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
h2, h3, p { margin: 0; }
h2 { font-size: 18px; line-height: 1.25; letter-spacing: -.02em; }
.icon-button { width: 36px; height: 36px; display: inline-grid; place-items: center; flex: none; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); color: var(--text); }
.icon-button svg { width: 18px; height: 18px; }
.content { min-height: 0; overflow-y: auto; padding: 20px; }
.lead { color: var(--muted); line-height: 1.5; }
.choices { display: grid; gap: 10px; margin-top: 20px; }
.choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 64px; padding: 13px 15px; text-align: left; border: 1px solid var(--border); border-radius: 13px; background: var(--surface); color: var(--text); }
.choice:hover, .choice:focus-visible { border-color: var(--accent); background: var(--surface-alt); }
.choice strong { display: block; font-size: 14px; }
.choice small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
.choice svg { width: 17px; height: 17px; flex: none; color: var(--accent); }
.back { margin: 0 0 14px; padding: 0; border: 0; background: none; color: var(--accent); font-size: 13px; font-weight: 650; }
.form-title { margin-bottom: 16px; font-size: 15px; }
.field { margin-bottom: 15px; }
.field label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 650; }
.field input, .field textarea { display: block; width: 100%; min-height: 42px; padding: 10px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); }
.field textarea { min-height: 118px; resize: vertical; }
.field input::placeholder, .field textarea::placeholder { color: var(--muted); opacity: .85; }
.field [aria-invalid="true"] { border-color: var(--danger); }
.hint { margin-top: 5px; color: var(--muted); font-size: 12px; }
.error { margin-top: 5px; color: var(--danger); font-size: 12px; }
.contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.privacy { margin: 3px 0 16px; color: var(--muted); font-size: 12px; line-height: 1.45; }
.submit { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 10px 16px; border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-text); font-weight: 700; }
.submit:hover:not(:disabled) { background: var(--accent-hover); }
.status-error { padding: 10px 12px; margin-bottom: 14px; border: 1px solid var(--danger); border-radius: 9px; color: var(--danger); font-size: 13px; }
.success-mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 18px; border-radius: 13px; background: var(--surface-alt); color: var(--accent); font-size: 24px; font-weight: 800; }
.success h3 { margin-bottom: 8px; font-size: 18px; }
.success .lead { margin-bottom: 16px; }
.reference { margin-bottom: 18px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-alt); font-size: 13px; }
.reference strong { display: block; margin-top: 2px; font-size: 15px; }
@media (max-width: 480px) { :host, :host([data-position="bottom-left"]) { bottom: max(12px, env(safe-area-inset-bottom)); left: 12px; right: 12px; } .panel { width: 100%; max-height: calc(100dvh - 24px - env(safe-area-inset-bottom)); } .launcher { float: right; } .contact-grid { grid-template-columns: 1fr; gap: 0; } }
@media (prefers-reduced-motion: no-preference) { .panel { animation: widget-in .16s ease-out; } @keyframes widget-in { from { transform: translateY(8px); opacity: .7; } } }
`;
