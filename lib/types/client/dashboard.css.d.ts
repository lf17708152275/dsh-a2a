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
export declare const DASHBOARD_CSS_ID = "@lf17708152275/dsh-a2a/dashboard.css";
/** Inject the dashboard stylesheet once; the returned disposer removes it. */
export declare function injectDashboardStyles(): () => void;
//# sourceMappingURL=dashboard.css.d.ts.map