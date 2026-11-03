/**
 * A2A dashboard stylesheet — an idempotent `<style>` injector built entirely
 * on the product's `--dsw-alias-*` design tokens, so light/dark themes and
 * future token changes apply automatically, plus `@container` rules that
 * react to the settings drawer's own width (not the browser viewport).
 *
 * Class names are prefixed `dsh-a2a-` to avoid collisions with product or
 * third-party styles.
 * @module dsh-a2a/client/dashboard.css
 */

export const DASHBOARD_CSS_ID = '@hanphone/dsh-a2a/dashboard.css'

const css = String.raw`
/* ── layout ─────────────────────────────────────────────── */
.dsh-a2a-root { container-type: inline-size; container-name: a2a; }
.dsh-a2a-section { display: flex; flex-direction: column; gap: 20px; }
.dsh-a2a-stack { display: flex; flex-direction: column; gap: 16px; }
.dsh-a2a-crew { display: flex; flex-direction: column; gap: 10px; }
.dsh-a2a-card-list { display: flex; flex-direction: column; gap: 8px; }
.dsh-a2a-btn-row { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.dsh-a2a-intro { color: var(--dsw-alias-label-secondary, #61666b); font-size: 13px; line-height: 1.6; margin: 0; }
.dsh-a2a-footer { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; margin-top: 4px; }
.dsh-a2a-count { font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #81858c); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); border-radius: 10px; padding: 1px 8px; }
.dsh-a2a-mono { font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"); }

/* notice / error */
.dsh-a2a-notice { padding: 8px 12px; border-radius: 8px; font-size: 13px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #0f1115); }
.dsh-a2a-error { color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 9%, transparent); }

/* empty state / hint */
.dsh-a2a-empty { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 13px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06)); border-radius: 8px; padding: 12px 14px; }
.dsh-a2a-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); line-height: 1.6; }

/* section titles */
.dsh-a2a-h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); display: flex; align-items: center; gap: 8px; }

/* tabs */
.dsh-a2a-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3)); }
.dsh-a2a-tab { padding: 6px 12px; font-size: 13px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; }
.dsh-a2a-tab[data-active='true'] { color: var(--dsw-alias-label-primary, #0f1115); border-bottom-color: var(--dsw-alias-brand-primary, #4a7dff); }
.dsh-a2a-tab:hover:not([data-active='true']) { color: var(--dsw-alias-label-primary, #0f1115); }

/* state dot */
.dsh-a2a-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary, #81858c); flex: none; }
.dsh-a2a-dot[data-state='connected'] { background: var(--dsw-alias-state-success-primary, #12b76a); }
.dsh-a2a-dot[data-state='reconnecting'] { background: var(--dsw-alias-state-warn-primary, #f79009); }
.dsh-a2a-dot[data-state='disabled'] { background: var(--dsw-alias-state-warn-primary, #f79009); }
.dsh-a2a-dot[data-state='failed'] { background: var(--dsw-alias-state-error-primary, #d92d20); }

/* buttons */
.dsh-a2a-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  margin-right: 6px; padding: 4px 12px; font-size: 12px; line-height: 18px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: transparent; color: var(--dsw-alias-label-primary, #0f1115);
  cursor: pointer; transition: background .15s, border-color .15s, color .15s, opacity .15s;
}
.dsh-a2a-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.45)); }
.dsh-a2a-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4a7dff); outline-offset: 1px; }
.dsh-a2a-btn:disabled { opacity: .5; cursor: default; }
.dsh-a2a-btn:last-child { margin-right: 0; }
.dsh-a2a-btn-primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4a7dff)); border-color: transparent; color: #fff; }
/* hover/focus 不能把主按钮刷成白底白字（浅色主题下会像"按钮变白/文字消失"） */
.dsh-a2a-btn-primary:hover:not(:disabled), .dsh-a2a-btn-primary:focus:not(:disabled) { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4a7dff)); border-color: transparent; color: #fff; filter: brightness(.94); }
.dsh-a2a-btn-primary:disabled { opacity: .5; }
.dsh-a2a-btn-danger { background: var(--dsw-alias-state-error-primary, #d92d20); border-color: transparent; color: #fff; }
.dsh-a2a-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary, #d92d20); border-color: transparent; color: #fff; filter: brightness(.94); }
/* 卡片内展开的 Card / 测试面板：和卡片正文用虚线分隔，避免看起来像另一个卡片 */
.dsh-a2a-inline-panel { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.3)); }

/* forms */
.dsh-a2a-form { display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap; align-items: center; }
.dsh-a2a-input, .dsh-a2a-select {
  padding: 5px 10px; font-size: 13px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: transparent; color: var(--dsw-alias-label-primary, #0f1115);
  transition: border-color .15s;
}
.dsh-a2a-input:focus, .dsh-a2a-select:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4a7dff); }
.dsh-a2a-input:disabled, .dsh-a2a-select:disabled { opacity: .5; }

/* cards */
.dsh-a2a-card { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3)); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.dsh-a2a-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-a2a-card-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.dsh-a2a-card-sub { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); word-break: break-all; }
.dsh-a2a-badge { font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); color: var(--dsw-alias-label-secondary, #61666b); }
.dsh-a2a-skill { display: inline-block; margin: 1px 4px 1px 0; padding: 0 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.12)); color: var(--dsw-alias-label-secondary, #61666b); font-size: 12px; }

/* preview (two-phase add) */
.dsh-a2a-preview { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3)); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.dsh-a2a-preview-head { display: flex; align-items: center; gap: 8px; }
.dsh-a2a-preview-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.dsh-a2a-preview-desc { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); line-height: 1.6; }
.dsh-a2a-preview-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-a2a-skill-list { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.dsh-a2a-skill-list-title { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-a2a-skill-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.dsh-a2a-metrics { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.dsh-a2a-detail { max-height: 320px; overflow: auto; margin: 8px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #0f1115); font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.dsh-a2a-link { background: none; border: none; padding: 0; color: var(--dsw-alias-brand-primary, #4a7dff); cursor: pointer; font-size: 12px; text-align: left; }
.dsh-a2a-link:hover { text-decoration: underline; }

/* tables */
.dsh-a2a-table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3)); }
.dsh-a2a-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dsh-a2a-table th { text-align: left; padding: 8px 10px; color: var(--dsw-alias-label-tertiary, #81858c); font-weight: 500; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3)); white-space: nowrap; }
.dsh-a2a-table td { padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.12)); vertical-align: top; }
.dsh-a2a-table tr:last-child td { border-bottom: none; }

/* auth state */
.dsh-a2a-auth { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }

/* version / update strip */
.dsh-a2a-verbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.07)); border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16)); }
.dsh-a2a-verbar-main { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dsh-a2a-verbar-side { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-a2a-verbar-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #0f1115); }
.dsh-a2a-verbar-version { font-size: 12px; color: var(--dsw-alias-label-secondary, #61666b); }
.dsh-a2a-verbar-status { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-a2a-verbar-status[data-tone='ok'] { color: var(--dsw-alias-state-success-primary, #12b76a); }
.dsh-a2a-verbar-status[data-tone='update'] { color: var(--dsw-alias-brand-primary, #4a7dff); font-weight: 600; }
.dsh-a2a-verbar-status[data-tone='unknown'] { color: var(--dsw-alias-state-warn-primary, #f79009); }
.dsh-a2a-verbar-runtime { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dsh-a2a-update-detail { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4a7dff) 7%, transparent); border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4a7dff) 28%, transparent); }
.dsh-a2a-command { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.1)); color: var(--dsw-alias-label-primary, #0f1115); font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }

/* narrow drawer */
@container a2a (max-width: 460px) {
  .dsh-a2a-form { flex-direction: column; align-items: stretch; }
  .dsh-a2a-card-head { flex-direction: column; align-items: flex-start; }
  .dsh-a2a-verbar { align-items: flex-start; }
  .dsh-a2a-verbar-side { width: 100%; }
}
`

/** Inject the dashboard stylesheet once; the returned disposer removes it. */
export function injectDashboardStyles(): () => void {
  let tag = document.getElementById(DASHBOARD_CSS_ID) as HTMLStyleElement | null
  if (tag === null) {
    tag = document.createElement('style')
    tag.id = DASHBOARD_CSS_ID
    tag.dataset.plugin = 'a2a'
    tag.dataset.pluginCss = `${'a2a'}/dashboard`
    tag.textContent = css
    document.head.appendChild(tag)
  }
  let removed = false
  return () => {
    if (removed) return
    removed = true
    tag?.remove()
  }
}