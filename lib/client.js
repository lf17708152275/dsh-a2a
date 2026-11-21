window.__ModuleLoader__.load({
	id: "@lf17708152275/dsh-a2a",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/dashboard.css.ts
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
		const DASHBOARD_CSS_ID = "@lf17708152275/dsh-a2a/dashboard.css";
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
		`;
		/** Inject the dashboard stylesheet once; the returned disposer removes it. */
		function injectDashboardStyles() {
			let tag = document.getElementById(DASHBOARD_CSS_ID);
			if (tag === null) {
				tag = document.createElement("style");
				tag.id = DASHBOARD_CSS_ID;
				tag.dataset.plugin = "a2a";
				tag.dataset.pluginCss = `a2a/dashboard`;
				tag.textContent = css;
				document.head.appendChild(tag);
			}
			let removed = false;
			return () => {
				if (removed) return;
				removed = true;
				tag?.remove();
			};
		}
		//#endregion
		//#region src/client/task-row.ts
		/** Project a `TaskRecord` onto the task table's columns. */
		function taskRowOf(record) {
			return {
				id: record.taskId,
				skill: record.skill ?? "-",
				serverId: record.serverId ?? "-",
				state: record.state ?? "-"
			};
		}
		//#endregion
		//#region src/client/update-status.ts
		/**
		* Where the plugin installs from: this fork's repository.
		*
		* Upstream publishes to npm as `@hanphone/dsh-a2a`; this fork carries its own
		* package name, so an install that names the npm package can never be mistaken
		* for the fork.
		*/
		const INSTALL_SPEC = "github:lf17708152275/dsh-a2a";
		/** Human-readable status; a failed lookup never reads as "up to date". */
		function updateStatusText(update, error) {
			if (error !== void 0) return `检查更新失败：${error}`;
			if (update === void 0) return "正在检查更新…";
			if (update.hasUpdate) return `有新版本 v${update.latest ?? ""}`;
			if (!update.ok) return `暂时查不到最新版本（${update.error ?? "网络"}）—— 这不代表没有问题`;
			if (update.ahead) return `本地版本比已发布版本新（${update.latest ?? ""}）`;
			return `已是最新版（v${update.latest ?? ""}）`;
		}
		/** Tone paired with {@link updateStatusText}. */
		function updateToneOf(update, error) {
			if (error !== void 0) return "unknown";
			if (update === void 0) return "pending";
			if (update.hasUpdate) return "update";
			return update.ok ? "ok" : "unknown";
		}
		/**
		* Two-step update command for the given profile (`remove`, then `add`).
		* A missing or malformed profile falls back to `web`; the value is only
		* displayed and copied, never executed.
		*
		* The install source is this fork's repository, not the npm package: the npm
		* name resolves to the upstream release, so copying a command that names only
		* `@hanphone/dsh-a2a` would quietly replace the fork with upstream code.
		*/
		function updateCommandFor(profile) {
			const candidate = profile ?? "";
			const name = /^[A-Za-z0-9._-]+$/.test(candidate) ? candidate : "web";
			return [`dsh plugin --profile ${name} remove @lf17708152275/dsh-a2a`, `dsh plugin --profile ${name} add ${INSTALL_SPEC}`].join("\n");
		}
		//#endregion
		//#region src/client/index.ts
		/** Services this plugin needs from the client runtime. */
		const inject = ["slots"];
		const NS = "a2a";
		function apply(ctx) {
			ctx.effect(() => injectDashboardStyles(), `${NS}: dashboard styles`);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "a2a",
				order: 90,
				label: () => "A2A 连接",
				inject: () => ({})
			}, A2aSection));
		}
		async function fetchSnapshot(query = {}) {
			const params = new URLSearchParams();
			if (query.taskLimit !== void 0) params.set("taskLimit", String(query.taskLimit));
			if (query.taskOffset !== void 0) params.set("taskOffset", String(query.taskOffset));
			if (query.taskState !== void 0 && query.taskState.length > 0) params.set("taskState", query.taskState);
			const suffix = params.size > 0 ? `?${params.toString()}` : "";
			const res = await fetch(`/a2a/api${suffix}`, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
			return await res.json();
		}
		async function fetchJson(path) {
			const res = await fetch(path, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.json();
		}
		async function fetchPresets() {
			const res = await fetch("/a2a/api/presets", { headers: { accept: "application/json" } });
			if (!res.ok) return [];
			return await res.json();
		}
		async function fetchModels() {
			try {
				const res = await fetch("/a2a/api/models", { headers: { accept: "application/json" } });
				if (!res.ok) return [];
				const rows = await res.json();
				if (!Array.isArray(rows)) return [];
				return rows.filter((r) => {
					const row = r;
					return typeof row.provider === "string" && typeof row.id === "string";
				});
			} catch {
				return [];
			}
		}
		async function fetchTools() {
			try {
				const res = await fetch("/a2a/api/tools", { headers: { accept: "application/json" } });
				if (!res.ok) return [];
				const rows = await res.json();
				if (!Array.isArray(rows)) return [];
				return rows.filter((r) => {
					const row = r;
					return typeof row.name === "string" && row.name.length > 0;
				});
			} catch {
				return [];
			}
		}
		/** Dropdown value for "provider/id", or '' when the instance inherits the default. */
		function modelKey(provider, model) {
			if (provider === void 0 || provider === "") return "";
			if (model === void 0 || model === "") return "";
			return `${provider}/${model}`;
		}
		function splitModelKey(key) {
			const at = key.indexOf("/");
			if (at <= 0) return {
				provider: "",
				model: ""
			};
			return {
				provider: key.slice(0, at),
				model: key.slice(at + 1)
			};
		}
		async function fetchUpdate(force = false) {
			const res = await fetch(`/a2a/api/update${force ? "?refresh=1" : ""}`, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.json();
		}
		async function postControl(payload) {
			const res = await fetch("/a2a/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			return await res.json().catch(() => ({
				ok: false,
				message: `HTTP ${res.status}`
			}));
		}
		function dotState(state) {
			if (state === "connected") return "connected";
			if (state === "reconnecting" || state === "disabled") return "disabled";
			if (state === "failed") return "failed";
			return "connected";
		}
		function presetLabel(presets, id) {
			if (id === void 0) return "—";
			return presets.find((p) => p.id === id)?.name ?? id;
		}
		/** How many plugins a session started from this preset mounts. */
		function mountedPluginCount(preset) {
			if (preset === void 0) return 0;
			return (preset.plugins ?? []).filter((plugin) => plugin.enabled !== false).length;
		}
		/** Human label for one plugin row. */
		function pluginLabel(plugin) {
			const name = plugin.label ?? plugin.module.replace(/^@[^/]+\//, "");
			if (plugin.enabled === false) return `${name}（已关闭）`;
			if (plugin.enabled === "conditional") return `${name}（条件：${plugin.condition ?? "?"}）`;
			return name;
		}
		/** Hover text for one plugin chip: friendly hint, module, condition. */
		function pluginTitle(plugin) {
			const parts = [plugin.hint ?? plugin.module];
			parts.push(`模块：${plugin.module}`);
			if (plugin.entryId !== null) parts.push(`行 id：${plugin.entryId}`);
			if (plugin.enabled === "conditional") parts.push(`条件：${plugin.condition ?? "?"}`);
			if (plugin.enabled === false) parts.push("状态：已关闭");
			return parts.join("\n");
		}
		function A2aSection(_props) {
			const [snap, setSnap] = (0, react.useState)(void 0);
			const [presets, setPresets] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(void 0);
			const [busy, setBusy] = (0, react.useState)(false);
			const [update, setUpdate] = (0, react.useState)(void 0);
			const [updateBusy, setUpdateBusy] = (0, react.useState)(false);
			const [updateError, setUpdateError] = (0, react.useState)(void 0);
			const [tab, setTab] = (0, react.useState)("inbound");
			const [taskFilter, setTaskFilter] = (0, react.useState)("");
			const [taskLimit, setTaskLimit] = (0, react.useState)(50);
			const [selectedTask, setSelectedTask] = (0, react.useState)(void 0);
			const [cardView, setCardView] = (0, react.useState)(void 0);
			const [conversation, setConversation] = (0, react.useState)(void 0);
			const [conversationKey, setConversationKey] = (0, react.useState)("");
			const [testInbound, setTestInbound] = (0, react.useState)("");
			const [testContext, setTestContext] = (0, react.useState)("");
			const [testSkill, setTestSkill] = (0, react.useState)("chat");
			const [testText, setTestText] = (0, react.useState)("");
			const [testResult, setTestResult] = (0, react.useState)(void 0);
			const [inlinePanel, setInlinePanel] = (0, react.useState)(null);
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(null);
			const [editingIn, setEditingIn] = (0, react.useState)(null);
			const [inName, setInName] = (0, react.useState)("");
			const [inDesc, setInDesc] = (0, react.useState)("");
			const [inVersion, setInVersion] = (0, react.useState)("1.0.0");
			const [inPreset, setInPreset] = (0, react.useState)("");
			const [presetFilter, setPresetFilter] = (0, react.useState)("");
			const [inToken, setInToken] = (0, react.useState)("");
			const [inClearAuth, setInClearAuth] = (0, react.useState)(false);
			const [inTrace, setInTrace] = (0, react.useState)(false);
			const [inWorkspace, setInWorkspace] = (0, react.useState)("");
			const [models, setModels] = (0, react.useState)([]);
			const [inModelKey, setInModelKey] = (0, react.useState)("");
			const [tools, setTools] = (0, react.useState)([]);
			const [inToolAllow, setInToolAllow] = (0, react.useState)([]);
			const [toolFilter, setToolFilter] = (0, react.useState)("");
			const [baseMode, setBaseMode] = (0, react.useState)("inherit");
			const [baseDraft, setBaseDraft] = (0, react.useState)("");
			const [baseCandidates, setBaseCandidates] = (0, react.useState)([]);
			const baseInit = (0, react.useRef)(false);
			const [editingOut, setEditingOut] = (0, react.useState)(null);
			const [outName, setOutName] = (0, react.useState)("");
			const [outUrl, setOutUrl] = (0, react.useState)("");
			const [outPreset, setOutPreset] = (0, react.useState)("");
			const [outTimeout, setOutTimeout] = (0, react.useState)("60000");
			const [outToken, setOutToken] = (0, react.useState)("");
			const [discovered, setDiscovered] = (0, react.useState)(null);
			const [discovering, setDiscovering] = (0, react.useState)(false);
			const [outDisabledSkills, setOutDisabledSkills] = (0, react.useState)([]);
			const [outSkillOverrides, setOutSkillOverrides] = (0, react.useState)("{}");
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = async () => {
					try {
						const [next, presetRows, modelRows, toolRows] = await Promise.all([
							fetchSnapshot({
								taskLimit,
								...taskFilter !== "" ? { taskState: taskFilter } : {}
							}),
							fetchPresets(),
							fetchModels(),
							fetchTools()
						]);
						if (alive) {
							setSnap(next);
							setPresets(presetRows);
							setModels(modelRows);
							setTools(toolRows);
							const def = presetRows.find((p) => p.isDefault)?.id;
							setOutPreset((current) => current === "" && def !== void 0 ? def : current);
							setTestInbound((current) => current === "" ? next.inbounds[0]?.id ?? "" : current);
							setTestSkill((current) => current === "" ? next.inbounds[0]?.skills[0]?.id ?? "chat" : current);
							const settings = next.settings;
							if (!baseInit.current && settings !== void 0) {
								baseInit.current = true;
								setBaseMode(settings.mode);
								setBaseDraft(settings.mode === "custom" ? settings.baseUrl ?? "" : "");
								setBaseCandidates(settings.candidates ?? []);
							}
							setError(void 0);
						}
					} catch (err) {
						if (alive) setError(err.message);
					}
				};
				tick();
				const timer = setInterval(() => void tick(), 3e3);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [taskFilter, taskLimit]);
			(0, react.useEffect)(() => {
				let alive = true;
				fetchUpdate().then((info) => {
					if (alive) setUpdate(info);
				}).catch((err) => {
					if (alive) setUpdateError(err.message);
				});
				return () => {
					alive = false;
				};
			}, []);
			const checkUpdate = async () => {
				if (updateBusy) return;
				setUpdateBusy(true);
				setUpdateError(void 0);
				try {
					setUpdate(await fetchUpdate(true));
				} catch (err) {
					setUpdateError(err.message);
				} finally {
					setUpdateBusy(false);
				}
			};
			/** Persist the deployment advertised-base-URL mode; blank inherits config. */
			const saveBaseSettings = async () => {
				const value = baseMode === "inherit" ? "" : baseMode === "auto" ? "auto" : baseDraft.trim();
				if (baseMode === "custom" && value === "") {
					setError("自定义模式需要一个绝对 URL（如 http://192.168.1.100）");
					return;
				}
				if ((await control({
					action: "settings.update",
					baseUrl: value
				})).ok) {
					setBaseDraft(baseMode === "custom" ? value : "");
					baseInit.current = false;
				}
			};
			const control = async (payload) => {
				setBusy(true);
				try {
					const result = await postControl(payload);
					if (!result.ok) setError(result.message);
					else setNotice(result.message);
					setSnap(await fetchSnapshot({
						taskLimit,
						...taskFilter !== "" ? { taskState: taskFilter } : {}
					}));
					return result;
				} catch (err) {
					setError(err.message);
					return {
						ok: false,
						message: err.message
					};
				} finally {
					setBusy(false);
				}
			};
			const openTask = async (id) => {
				try {
					setSelectedTask(await fetchJson(`/a2a/api/task?id=${encodeURIComponent(id)}`));
				} catch (err) {
					setError(err.message);
				}
			};
			const openCard = async (id) => {
				try {
					setCardView(await fetchJson(`/a2a/api/card?id=${encodeURIComponent(id)}`));
				} catch (err) {
					setError(err.message);
				}
			};
			const openConversation = async (contextId, serverId) => {
				try {
					const query = new URLSearchParams({ contextId });
					if (serverId !== void 0) query.set("serverId", serverId);
					setConversation(await fetchJson(`/a2a/api/session?${query.toString()}`));
					setConversationKey(`${serverId ?? ""}/${contextId}`);
				} catch (err) {
					setError(err.message);
				}
			};
			const submitTest = async () => {
				if (testInbound === "" || testText.trim() === "") return;
				const result = await control({
					action: "inbound.sendTest",
					id: testInbound,
					text: testText.trim(),
					...testContext.trim() !== "" ? { contextId: testContext.trim() } : {},
					...testSkill.trim() !== "" ? { skill: testSkill.trim() } : {}
				});
				if (result.ok) setTestResult(result.task);
			};
			const closeInlinePanel = () => {
				setInlinePanel(null);
			};
			const openInlineCard = async (v) => {
				if (editingIn !== null) beginCreateInbound();
				setConfirmDelete(null);
				setInlinePanel({
					id: v.id,
					mode: "card"
				});
				setCardView(void 0);
				await openCard(v.id);
			};
			const openInlineTest = (v) => {
				if (editingIn !== null) beginCreateInbound();
				setConfirmDelete(null);
				setInlinePanel({
					id: v.id,
					mode: "test"
				});
				setTestInbound(v.id);
				setTestSkill(v.skills[0]?.id ?? "chat");
				setTestResult(void 0);
			};
			const toggleOutboundSkill = (id) => {
				setOutDisabledSkills((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
			};
			const beginCreateInbound = () => {
				setEditingIn(null);
				setInName("");
				setInDesc("");
				setInVersion("1.0.0");
				setInPreset("");
				setPresetFilter("");
				setInToken("");
				setInClearAuth(false);
				setInTrace(false);
				setInWorkspace("");
				setInModelKey("");
				setInToolAllow([]);
				setToolFilter("");
			};
			const beginEditInbound = (v) => {
				setEditingIn(v.id);
				setInName(v.name);
				setInDesc(v.description);
				setInVersion(v.version);
				setInPreset(v.presetOverride ?? "");
				setInToken("");
				setInClearAuth(false);
				setInTrace(v.trace);
				setInWorkspace(v.workspace ?? "");
				setInModelKey(modelKey(v.provider, v.model));
				setInToolAllow(v.toolAllow ?? []);
			};
			const submitInbound = async () => {
				if (!inName.trim() || busy) return;
				const base = {
					name: inName.trim(),
					description: inDesc.trim() || "An A2A inbound server",
					version: inVersion.trim() || "1.0.0",
					preset: inPreset.trim(),
					trace: inTrace,
					workspace: inWorkspace.trim(),
					provider: splitModelKey(inModelKey).provider,
					model: splitModelKey(inModelKey).model,
					toolAllow: [...inToolAllow]
				};
				if (!(editingIn === null ? await control({
					action: "inbound.create",
					...base
				}) : await control({
					action: "inbound.update",
					id: editingIn,
					...base
				})).ok) return;
				let targetId = editingIn;
				if (targetId === null) targetId = (await fetchSnapshot()).inbounds[0]?.id ?? null;
				if (targetId === null) return;
				if (inToken.trim().length > 0) await control({
					action: "inbound.setAuth",
					id: targetId,
					token: inToken.trim()
				});
				else if (inClearAuth) await control({
					action: "inbound.setAuth",
					id: targetId
				});
				beginCreateInbound();
			};
			const doDiscover = async () => {
				if (!outUrl.trim() || discovering) return;
				setDiscovering(true);
				setDiscovered(null);
				try {
					const result = await postControl({
						action: "outbound.discover",
						agentCardUrl: outUrl.trim(),
						...outToken.trim() !== "" ? { token: outToken.trim() } : {}
					});
					if (result.ok && result.preview !== void 0) {
						const preview = result.preview;
						setDiscovered(preview);
						setOutName((v) => v || preview.name);
						setError(void 0);
					} else setError(result.message);
				} finally {
					setDiscovering(false);
				}
			};
			const submitOutbound = async () => {
				if (!outName.trim() || !outUrl.trim() || busy) return;
				const timeout = Number.parseInt(outTimeout, 10);
				const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : void 0;
				let skillOverrides = {};
				try {
					if (outSkillOverrides.trim() !== "") skillOverrides = JSON.parse(outSkillOverrides);
				} catch {
					setError("skillOverrides must be valid JSON");
					return;
				}
				if (editingOut !== null) {
					if (!(await control({
						action: "outbound.update",
						id: editingOut,
						...outName.trim() !== "" ? { name: outName.trim() } : {},
						...outPreset !== "" ? { preset: outPreset } : {},
						...timeoutMs !== void 0 ? { timeoutMs } : {},
						disabledSkills: outDisabledSkills,
						...Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}
					})).ok) return;
					if (outToken.trim().length > 0) await control({
						action: "outbound.setAuth",
						id: editingOut,
						token: outToken.trim()
					});
					resetOutboundForm();
					return;
				}
				if (!(await control({
					action: "outbound.create",
					name: outName.trim(),
					agentCardUrl: outUrl.trim(),
					...outPreset !== "" ? { preset: outPreset } : {},
					...timeoutMs !== void 0 ? { timeoutMs } : {},
					disabledSkills: outDisabledSkills,
					...Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {}
				})).ok) return;
				const newest = (await fetchSnapshot()).outbounds[0];
				if (newest !== void 0 && outToken.trim().length > 0) await control({
					action: "outbound.setAuth",
					id: newest.id,
					token: outToken.trim()
				});
				resetOutboundForm();
			};
			const beginEditOutbound = (v) => {
				setEditingOut(v.id);
				setOutName(v.name);
				setOutUrl(v.agentCardUrl);
				setOutPreset(v.preset ?? presets.find((p) => p.isDefault)?.id ?? "");
				setOutTimeout(String(v.timeoutMs));
				setOutToken("");
				setDiscovered(null);
				setOutDisabledSkills(v.skills.filter((skill) => !skill.enabled).map((skill) => skill.id));
				setOutSkillOverrides("{}");
			};
			const resetOutboundForm = () => {
				setEditingOut(null);
				setOutName("");
				setOutUrl("");
				setOutPreset(presets.find((p) => p.isDefault)?.id ?? "");
				setOutTimeout("60000");
				setOutToken("");
				setDiscovered(null);
				setOutDisabledSkills([]);
				setOutSkillOverrides("{}");
			};
			const inbounds = snap?.inbounds ?? [];
			const outbounds = snap?.outbounds ?? [];
			const peers = snap?.peers ?? [];
			const tasks = snap?.tasks ?? [];
			const sessions = snap?.sessions ?? [];
			const metrics = snap?.metrics;
			const editingOutbound = outbounds.find((v) => v.id === editingOut);
			const h = (text, count) => (0, react.createElement)("div", { className: "dsh-a2a-h3" }, text, count !== void 0 ? (0, react.createElement)("span", { className: "dsh-a2a-count" }, String(count)) : null);
			const empty = (text) => (0, react.createElement)("div", { className: "dsh-a2a-empty" }, text);
			const pluginVersion = update?.current || snap?.version || "";
			const updateStatus = updateStatusText(update, updateError);
			const updateTone = updateToneOf(update, updateError);
			const runtime = update?.runtime;
			const profile = runtime?.profile ?? "web";
			const updateCommand = updateCommandFor(profile);
			const copyUpdateCommand = () => {
				if (navigator.clipboard === void 0) {
					setNotice("复制不了，请手动选中命令");
					return;
				}
				navigator.clipboard.writeText(updateCommand).then(() => setNotice("更新命令已复制")).catch(() => setNotice("复制不了，请手动选中命令"));
			};
			/**
			* Complete a displayed address with the port this dashboard is served on.
			*
			* A per-instance `baseUrl` is often typed as `http://10.10.10.2` while the A2A
			* routes still answer on the web server's own port, so an unqualified address
			* would point at port 80 where nothing listens. The host also fills the port
			* into the agent card; this keeps the card on screen honest when the panel and
			* the host half are not the same build.
			*/
			const withDisplayPort = (url) => {
				if (typeof location === "undefined" || location.port === "") return url;
				try {
					const parsed = new URL(url);
					if (parsed.port !== "" || parsed.protocol !== "http:") return url;
					parsed.port = location.port;
					return parsed.toString().replace(/\/$/, "");
				} catch {
					return url;
				}
			};
			/** 卡片内展开的 AgentCard JSON 面板。 */
			const renderInlineCardPanel = (v) => {
				const origin = typeof location !== "undefined" ? location.origin : "";
				const cardUrl = `${withDisplayPort(v.cardUrl ?? `${origin}${v.endpointPath}`)}/agent-card.json`;
				return (0, react.createElement)("div", { className: "dsh-a2a-inline-panel" }, h("AgentCard JSON"), (0, react.createElement)("pre", { className: "dsh-a2a-detail" }, cardView !== void 0 ? JSON.stringify(cardView, null, 2) : "读取中…"), (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					type: "button",
					onClick: () => {
						if (typeof navigator !== "undefined" && navigator.clipboard !== void 0) navigator.clipboard.writeText(cardUrl).then(() => setNotice(`已复制 ${cardUrl}`)).catch(() => setNotice(cardUrl));
						else setNotice(cardUrl);
					}
				}, "复制地址"), (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					type: "button",
					onClick: () => {
						window.open(cardUrl, "_blank", "noopener");
					}
				}, "新窗口打开"), (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					type: "button",
					onClick: closeInlinePanel
				}, "关闭")));
			};
			/** 卡片内展开的测试面板：只测当前这个入站实例。 */
			const renderInlineTestPanel = (v) => (0, react.createElement)("div", { className: "dsh-a2a-inline-panel" }, h(`测试「${v.name}」`), (0, react.createElement)("div", { className: "dsh-a2a-form" }, (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: testSkill,
				placeholder: "skill",
				style: { width: "120px" },
				onChange: (e) => setTestSkill(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: testContext,
				placeholder: "contextId（可选）",
				style: { width: "180px" },
				onChange: (e) => setTestContext(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: testText,
				placeholder: "发送一条测试消息",
				style: {
					flex: 1,
					minWidth: "220px"
				},
				onChange: (e) => setTestText(e.target.value)
			}), (0, react.createElement)("button", {
				className: "dsh-a2a-btn dsh-a2a-btn-primary",
				type: "button",
				disabled: busy || testText.trim() === "",
				onClick: () => {
					submitTest();
				}
			}, "发送")), testResult !== void 0 ? (0, react.createElement)("pre", { className: "dsh-a2a-detail" }, JSON.stringify(testResult, null, 2)) : null, (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "button",
				onClick: closeInlinePanel
			}, "关闭")));
			/**
			* 创建 / 编辑入站 Server 的表单主体（标题 + 表单 + 鉴权 / 描述 / 提示）。
			* 新建时渲染在列表底部；编辑时直接展开在对应的入站卡片内部，保存或取消后 editingIn 复位即自动收起。
			*/
			const renderInboundFormBody = (title) => [
				h(title),
				(0, react.createElement)("form", {
					className: "dsh-a2a-form",
					onSubmit: (ev) => {
						ev.preventDefault();
						submitInbound();
					}
				}, (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					value: inName,
					placeholder: "名称",
					onChange: (e) => setInName(e.target.value)
				}), (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					value: inVersion,
					placeholder: "版本",
					style: { width: "76px" },
					onChange: (e) => setInVersion(e.target.value)
				}), (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					value: presetFilter,
					placeholder: "按能力筛选预设（如 终端 / 表情 / 子代理）",
					title: "按插件中文名或模块名过滤上面的预设清单，方便按能力挑预设",
					style: { width: "240px" },
					onChange: (e) => setPresetFilter(e.target.value)
				}), (() => {
					const keyword = presetFilter.trim().toLowerCase();
					const matches = (preset) => {
						if (keyword === "") return true;
						return [
							preset.id,
							preset.name ?? "",
							preset.description ?? "",
							...(preset.plugins ?? []).flatMap((plugin) => [plugin.label ?? "", plugin.module])
						].join(" ").toLowerCase().includes(keyword);
					};
					const visible = presets.filter(matches);
					const current = presets.find((preset) => preset.id === inPreset);
					const candidates = current !== void 0 && !visible.includes(current) ? [...visible, current] : visible;
					return (0, react.createElement)("select", {
						className: "dsh-a2a-select",
						value: inPreset,
						onChange: (e) => setInPreset(e.target.value),
						title: "绑定这个端点使用的 Agent 预设；选「默认」= 跟随部署默认预设"
					}, (0, react.createElement)("option", {
						value: "",
						key: "__default__"
					}, "（默认：跟随部署）"), ...candidates.map((p) => (0, react.createElement)("option", {
						value: p.id,
						key: p.id,
						title: p.description ?? p.id
					}, `${p.name ?? p.id}（${mountedPluginCount(p)} 项能力）`)));
				})(), (() => {
					const activePreset = presets.find((p) => p.id === inPreset) ?? presets.find((p) => p.isDefault === true);
					if (activePreset === void 0) return null;
					const plugins = activePreset.plugins ?? [];
					return (0, react.createElement)("details", {
						className: "dsh-a2a-hint",
						style: {
							flexBasis: "100%",
							margin: "2px 0 4px"
						}
					}, (0, react.createElement)("summary", { style: { cursor: "pointer" } }, `该预设的 A2A 会话会携带 ${mountedPluginCount(activePreset)} 个插件${plugins.length > mountedPluginCount(activePreset) ? `（声明 ${plugins.length} 行）` : ""} · ${activePreset.name ?? activePreset.id}`), (0, react.createElement)("div", {
						className: "dsh-a2a-hint",
						style: { marginTop: "4px" }
					}, "这里是预设自己声明挂载的插件；实际会话还会叠加部署级插件（例如贴纸、团队工具），完整运行时清单以 DSH 会话页的插件视图为准。"), plugins.length === 0 ? (0, react.createElement)("div", { className: "dsh-a2a-hint" }, "宿主没有提供这个预设的插件清单（预设仍可用，只是不能在这里预读）。") : (0, react.createElement)("div", { style: {
						marginTop: "4px",
						display: "flex",
						flexWrap: "wrap",
						gap: "4px"
					} }, ...plugins.map((plugin, i) => (0, react.createElement)("span", {
						className: "dsh-a2a-skill",
						key: `${plugin.module}:${plugin.entryId ?? i}`,
						title: pluginTitle(plugin)
					}, pluginLabel(plugin)))));
				})(), (() => {
					const keyword = toolFilter.trim().toLowerCase();
					const visible = tools.filter((tool) => keyword === "" || tool.name.toLowerCase().includes(keyword) || (tool.description ?? "").toLowerCase().includes(keyword));
					const selected = new Set(inToolAllow);
					const toggle = (name) => {
						setInToolAllow((current) => current.includes(name) ? current.filter((value) => value !== name) : [...current, name]);
					};
					return (0, react.createElement)("details", {
						className: "dsh-a2a-hint",
						style: {
							flexBasis: "100%",
							margin: "2px 0 4px"
						}
					}, (0, react.createElement)("summary", { style: { cursor: "pointer" } }, inToolAllow.length === 0 ? `工具白名单：未限制（会话可见全部 ${tools.length} 个全局工具）` : `工具白名单：只保留 ${inToolAllow.length} 个工具（其余工具连同 schema 移出上下文）${tools.length > 0 ? `，共 ${tools.length} 个可选` : ""}`), (0, react.createElement)("div", {
						className: "dsh-a2a-hint",
						style: { marginTop: "4px" }
					}, "纯对话端点一般只需要贴纸等少数工具；勾选后其余工具不再进入每轮上下文的工具区，能省 token。清空全部勾选 = 恢复全量。改动对新会话生效（老会话沿用创建时的工具集，需要的话用「换新会话」）。"), (0, react.createElement)("input", {
						className: "dsh-a2a-input",
						value: toolFilter,
						placeholder: "搜索工具名或说明（如 sticker / web / bash）",
						style: {
							width: "100%",
							margin: "4px 0"
						},
						onChange: (e) => setToolFilter(e.target.value)
					}), (0, react.createElement)("div", { style: {
						maxHeight: "170px",
						overflow: "auto",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
						paddingRight: "4px"
					} }, ...visible.length === 0 ? [(0, react.createElement)("div", {
						className: "dsh-a2a-hint",
						key: "__none"
					}, tools.length === 0 ? "宿主没有提供工具清单（tools 服务未挂载）。" : "没有匹配的工具。")] : visible.map((tool) => (0, react.createElement)("label", {
						key: tool.name,
						title: tool.description ?? tool.name,
						style: {
							display: "flex",
							alignItems: "center",
							gap: "6px",
							fontSize: "12px"
						}
					}, (0, react.createElement)("input", {
						type: "checkbox",
						checked: selected.has(tool.name),
						onChange: () => toggle(tool.name)
					}), (0, react.createElement)("span", { style: { fontFamily: "monospace" } }, tool.name), tool.description !== void 0 ? (0, react.createElement)("span", { className: "dsh-a2a-hint" }, `· ${tool.description}`) : null))));
				})(), (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					value: inWorkspace,
					placeholder: editingIn !== null ? "工作空间绝对路径（留空 = 恢复默认 ~/.dsh/a2a-sessions）" : "工作空间绝对路径（可选，留空 = 默认 ~/.dsh/a2a-sessions）",
					style: {
						flex: 1,
						minWidth: "280px"
					},
					onChange: (e) => setInWorkspace(e.target.value)
				}), (0, react.createElement)("select", {
					className: "dsh-a2a-select",
					value: inModelKey,
					title: "该入站实例使用的模型（留空 = 继承部署默认）",
					style: { width: "260px" },
					onChange: (e) => setInModelKey(e.target.value)
				}, (0, react.createElement)("option", {
					value: "",
					key: ""
				}, "模型：继承部署默认"), ...models.map((m) => (0, react.createElement)("option", {
					value: modelKey(m.provider, m.id),
					key: modelKey(m.provider, m.id),
					title: `${m.provider} / ${m.id}`
				}, `${m.name}（${m.provider}/${m.id}）`)), ...inModelKey !== "" && !models.some((m) => modelKey(m.provider, m.id) === inModelKey) ? [(0, react.createElement)("option", {
					value: inModelKey,
					key: `custom:${inModelKey}`
				}, `已配置：${inModelKey}`)] : []), (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					type: "password",
					value: inToken,
					placeholder: editingIn !== null ? "Bearer Token（留空不改，填写则更新）" : "Bearer Token（可选）",
					onChange: (e) => setInToken(e.target.value)
				}), (0, react.createElement)("input", {
					className: "dsh-a2a-input",
					value: inDesc,
					placeholder: "描述（可选，用来标记这个端点的用途）",
					style: {
						flex: 1,
						minWidth: "260px"
					},
					onChange: (e) => setInDesc(e.target.value)
				}), (0, react.createElement)("label", { className: "dsh-a2a-hint" }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: inTrace,
					onChange: (e) => setInTrace(e.target.checked)
				}), " 允许 trace 扩展（工具名/脱敏摘要，默认关闭）"), (0, react.createElement)("button", {
					className: "dsh-a2a-btn dsh-a2a-btn-primary",
					type: "submit",
					disabled: busy || !inName.trim()
				}, editingIn !== null ? "保存修改" : "创建 Server"), editingIn !== null ? (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					type: "button",
					disabled: busy,
					onClick: () => beginCreateInbound()
				}, "取消") : null),
				editingIn !== null && snap?.inbounds.find((x) => x.id === editingIn)?.authTokenEnv !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-form" }, (0, react.createElement)("label", { className: "dsh-a2a-hint" }, "已配置鉴权。"), (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					type: "button",
					disabled: busy,
					onClick: () => {
						setInClearAuth(true);
						submitInbound();
					}
				}, "清除鉴权")) : null,
				(0, react.createElement)("div", { className: "dsh-a2a-hint" }, "技能由所绑 preset 自动派生（一切皆插件）；Bearer Token 可留空（匿名）。")
			];
			return (0, react.createElement)("div", { className: "dsh-a2a-root" }, (0, react.createElement)("div", { className: "dsh-a2a-section" }, (0, react.createElement)("p", { className: "dsh-a2a-intro" }, "管理本 DSH 的 A2A 连接：入站 server 把 DSH 作为 Agent 发布（每个绑定一个 agent preset，技能自动派生）；出站 server 连接并调用远程 A2A Agent。"), (0, react.createElement)("div", { className: "dsh-a2a-verbar" }, (0, react.createElement)("div", { className: "dsh-a2a-verbar-main" }, (0, react.createElement)("span", { className: "dsh-a2a-verbar-name" }, "dsh-a2a"), (0, react.createElement)("span", { className: "dsh-a2a-verbar-version dsh-a2a-mono" }, pluginVersion !== "" ? `v${pluginVersion}` : "v—"), (0, react.createElement)("span", {
				className: "dsh-a2a-verbar-status",
				"data-tone": updateTone
			}, updateStatus)), (0, react.createElement)("div", { className: "dsh-a2a-verbar-side" }, runtime !== void 0 ? (0, react.createElement)("span", { className: "dsh-a2a-verbar-runtime" }, `Node ${runtime.node} · ${runtime.platform}/${runtime.arch}`) : null, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "button",
				disabled: updateBusy,
				onClick: () => {
					checkUpdate();
				}
			}, updateBusy ? "检查中…" : "检查更新"))), update !== void 0 && update.hasUpdate ? (0, react.createElement)("div", { className: "dsh-a2a-update-detail" }, (0, react.createElement)("div", { className: "dsh-a2a-hint" }, `发现新版本 v${update.latest ?? ""}（当前 v${update.current}，来源 ${update.source ?? "未知"}）。先卸旧版再装新版；直接安装可能拿到缓存里的旧副本。命令使用当前 profile（${profile}），装完重启一次 DSH。`), (0, react.createElement)("pre", { className: "dsh-a2a-command dsh-a2a-mono" }, updateCommand), (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "button",
				onClick: copyUpdateCommand
			}, "复制命令"), update.repoUrl !== null ? (0, react.createElement)("a", {
				className: "dsh-a2a-link",
				href: update.repoUrl,
				target: "_blank",
				rel: "noreferrer"
			}, "打开仓库") : null)) : null, error !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-notice dsh-a2a-error" }, `加载失败：${error}`) : null, notice !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-notice" }, notice) : null, (0, react.createElement)("div", { className: "dsh-a2a-tabs" }, (0, react.createElement)("button", {
				className: "dsh-a2a-tab",
				"data-active": String(tab === "inbound"),
				onClick: () => setTab("inbound")
			}, `入站 Servers（${inbounds.length}）`), (0, react.createElement)("button", {
				className: "dsh-a2a-tab",
				"data-active": String(tab === "outbound"),
				onClick: () => setTab("outbound")
			}, `出站 Servers（${outbounds.length}）`), (0, react.createElement)("button", {
				className: "dsh-a2a-tab",
				"data-active": String(tab === "activity"),
				onClick: () => setTab("activity")
			}, `连接与任务（${peers.length} 连接 · ${sessions.length} 会话）`)), tab === "inbound" ? (0, react.createElement)("div", { className: "dsh-a2a-stack" }, (0, react.createElement)("div", { className: "dsh-a2a-card" }, h("部署设置 · 广告地址"), (0, react.createElement)("div", { className: "dsh-a2a-card-sub" }, `当前生效：${snap?.settings?.effectiveBaseUrl ?? "—"}`, snap?.settings?.configBaseUrl !== void 0 ? ` · 插件配置：${snap.settings.configBaseUrl}` : ""), (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("select", {
				className: "dsh-a2a-input",
				value: baseMode === "custom" ? baseCandidates.some((c) => c.value === baseDraft) ? `pick:${baseDraft}` : "custom" : baseMode,
				onChange: (e) => {
					const next = e.target.value;
					if (next.startsWith("pick:")) {
						setBaseMode("custom");
						setBaseDraft(next.slice(5));
						return;
					}
					setBaseMode(next);
					if (next !== "custom") setBaseDraft("");
				}
			}, (0, react.createElement)("option", {
				value: "inherit",
				key: "inherit"
			}, "跟随插件配置"), (0, react.createElement)("option", {
				value: "auto",
				key: "auto"
			}, "auto（按请求 Host 推导）"), ...baseCandidates.map((c) => (0, react.createElement)("option", {
				value: `pick:${c.value}`,
				key: c.value
			}, c.label)), (0, react.createElement)("option", {
				value: "custom",
				key: "custom"
			}, "自定义 URL…")), baseMode === "custom" ? (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: baseDraft,
				placeholder: "http://192.168.1.100",
				onChange: (e) => setBaseDraft(e.target.value)
			}) : null, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					saveBaseSettings();
				}
			}, "保存")), (0, react.createElement)("div", { className: "dsh-a2a-card-sub" }, "广告地址写进 Agent Card，外部 A2A 客户端靠它回连（不含路径）。下拉可选本机网卡地址、auto（按请求 Host 推导）或自定义；auto 在会改写 Host 的反向代理后面会失准，此时直接选网卡地址。")), (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("入站 Servers", inbounds.length), inbounds.length === 0 ? empty("还没有入站 server。创建一个即可对外发布 A2A 端点。") : (0, react.createElement)("div", { className: "dsh-a2a-card-list" }, ...inbounds.map((v) => (0, react.createElement)("div", {
				className: "dsh-a2a-card",
				key: v.id
			}, (0, react.createElement)("div", { className: "dsh-a2a-card-head" }, (0, react.createElement)("span", {
				"data-state": v.enabled ? "connected" : "disabled",
				className: "dsh-a2a-dot"
			}), (0, react.createElement)("span", { className: "dsh-a2a-card-name" }, v.name), (0, react.createElement)("span", {
				className: "dsh-a2a-badge",
				title: v.presetOverride === void 0 ? "跟随部署默认预设" : `预设 ${v.presetOverride}`
			}, v.presetOverride === void 0 ? `默认·${presetLabel(presets, v.preset)}` : presetLabel(presets, v.preset)), (() => {
				const count = mountedPluginCount(presets.find((p) => p.id === v.preset));
				return count === 0 ? null : (0, react.createElement)("span", {
					className: "dsh-a2a-badge dsh-a2a-mono",
					key: "caps",
					title: "该预设会话携带的插件数量"
				}, `${count} 项能力`);
			})(), (0, react.createElement)("span", { className: "dsh-a2a-badge dsh-a2a-mono" }, `v${v.version}`), ...v.trace ? [(0, react.createElement)("span", {
				className: "dsh-a2a-badge",
				key: "trace"
			}, "trace")] : [], ...v.model !== void 0 || v.provider !== void 0 ? (() => {
				const label = [v.provider, v.model].filter((x) => x !== void 0 && x.length > 0).join("/");
				const missing = models.length > 0 && !models.some((m) => m.provider === v.provider && m.id === v.model);
				return [(0, react.createElement)("span", {
					className: "dsh-a2a-badge dsh-a2a-mono",
					key: "model",
					title: missing ? "这个模型已不在宿主的模型清单里，请求会失败；请清空或改选模型" : "该实例钉住的模型",
					style: missing ? {
						color: "#e5484d",
						borderColor: "#e5484d"
					} : void 0
				}, missing ? `⚠ ${label}（已失效）` : label)];
			})() : [], ...v.toolAllow !== void 0 && v.toolAllow.length > 0 ? [(0, react.createElement)("span", {
				className: "dsh-a2a-badge dsh-a2a-mono",
				key: "tools",
				title: `只保留这些工具：${v.toolAllow.join(", ")}`
			}, `工具 ${v.toolAllow.length}`)] : [], ...v.workspace !== void 0 ? [(0, react.createElement)("span", {
				className: "dsh-a2a-badge dsh-a2a-mono",
				key: "ws",
				title: v.workspace
			}, "cwd")] : [], (0, react.createElement)("span", { className: "dsh-a2a-auth" }, v.authTokenEnv !== void 0 ? "· 已配置鉴权" : "· 匿名")), (() => {
				const origin = typeof location !== "undefined" ? location.origin : "";
				const endpointUrl = withDisplayPort(v.cardUrl ?? `${origin}${v.endpointPath}`);
				const cardUrl = `${endpointUrl}/agent-card.json`;
				const loopback = /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(endpointUrl);
				const copy = (text) => () => {
					navigator.clipboard?.writeText(text).catch(() => void 0);
				};
				return (0, react.createElement)("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: "2px",
					marginTop: "2px"
				} }, (0, react.createElement)("div", {
					className: "dsh-a2a-card-sub dsh-a2a-mono",
					title: "A2A JSON-RPC 端点，任务 POST 到这里"
				}, `端点 ${endpointUrl}`, (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					style: {
						marginLeft: "6px",
						fontSize: "11px"
					},
					onClick: copy(endpointUrl)
				}, "复制")), (0, react.createElement)("div", {
					className: "dsh-a2a-card-sub dsh-a2a-mono",
					title: "把这个 AgentCard 地址交给外部 agent 导入"
				}, `卡片 ${cardUrl}`, (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					style: {
						marginLeft: "6px",
						fontSize: "11px"
					},
					onClick: copy(cardUrl)
				}, "复制")), loopback ? (0, react.createElement)("div", {
					className: "dsh-a2a-card-sub",
					style: { color: "#e5484d" }
				}, "仅本机可达：外部 agent 访问不到这个回环地址，需反代/隧道或让 web 服务监听局域网地址") : null);
			})(), v.workspace !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-card-sub dsh-a2a-mono" }, `cwd: ${v.workspace}`) : null, (() => {
				const plugins = (presets.find((p) => p.id === v.preset)?.plugins ?? []).filter((plugin) => plugin.enabled !== false);
				if (plugins.length === 0) return null;
				const shown = plugins.slice(0, 6);
				return (0, react.createElement)("div", { style: { marginTop: "2px" } }, ...shown.map((plugin, i) => (0, react.createElement)("span", {
					className: "dsh-a2a-skill",
					key: `${plugin.module}:${plugin.entryId ?? i}`,
					title: pluginTitle(plugin)
				}, plugin.label ?? plugin.module)), plugins.length > shown.length ? (0, react.createElement)("span", {
					className: "dsh-a2a-skill",
					key: "__more",
					title: plugins.slice(shown.length).map((p) => p.label ?? p.module).join("、")
				}, `+${plugins.length - shown.length}`) : null);
			})(), v.skills.length > 0 ? (0, react.createElement)("div", null, ...v.skills.map((s) => (0, react.createElement)("span", {
				className: "dsh-a2a-skill",
				key: s.id,
				title: s.description ?? ""
			}, s.name))) : null, confirmDelete === v.id ? (0, react.createElement)("div", {
				className: "dsh-a2a-btn-row",
				key: "delete-confirm"
			}, (0, react.createElement)("span", {
				className: "dsh-a2a-hint",
				style: { alignSelf: "center" }
			}, `确定删除「${v.name}」？这个端点会立即下线，配置不可恢复。`), (0, react.createElement)("button", {
				className: "dsh-a2a-btn dsh-a2a-btn-danger",
				disabled: busy,
				onClick: () => {
					setConfirmDelete(null);
					control({
						action: "inbound.remove",
						id: v.id
					});
					if (editingIn === v.id) beginCreateInbound();
					if (inlinePanel?.id === v.id) setInlinePanel(null);
				}
			}, "确认删除"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => setConfirmDelete(null)
			}, "取消")) : editingIn === v.id || inlinePanel?.id === v.id ? null : (0, react.createElement)("div", {
				className: "dsh-a2a-btn-row",
				key: "actions"
			}, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: v.enabled ? "inbound.disable" : "inbound.enable",
						id: v.id
					});
				}
			}, v.enabled ? "停用" : "启用"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					openInlineCard(v);
				}
			}, "Card"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					openInlineTest(v);
				}
			}, "测试"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					setConfirmDelete(null);
					setInlinePanel(null);
					beginEditInbound(v);
				}
			}, "编辑"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					setConfirmDelete(v.id);
				}
			}, "删除")), ...editingIn === v.id ? renderInboundFormBody("编辑入站 Server") : [], ...inlinePanel?.id === v.id && inlinePanel.mode === "card" ? [renderInlineCardPanel(v)] : [], ...inlinePanel?.id === v.id && inlinePanel.mode === "test" ? [renderInlineTestPanel(v)] : [])))), editingIn === null ? (0, react.createElement)("div", { className: "dsh-a2a-card" }, ...renderInboundFormBody("新建入站 Server")) : null) : null, tab === "outbound" ? (0, react.createElement)("div", { className: "dsh-a2a-stack" }, (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("出站 Servers", outbounds.length), outbounds.length === 0 ? empty("还没有出站 server。添加一个远端 A2A 连接即可把其技能注册为模型工具。") : (0, react.createElement)("div", { className: "dsh-a2a-card-list" }, ...outbounds.map((v) => (0, react.createElement)("div", {
				className: "dsh-a2a-card",
				key: v.id
			}, (0, react.createElement)("div", { className: "dsh-a2a-card-head" }, (0, react.createElement)("span", {
				"data-state": dotState(v.state),
				className: "dsh-a2a-dot"
			}), (0, react.createElement)("span", { className: "dsh-a2a-card-name" }, v.name), (0, react.createElement)("span", { className: "dsh-a2a-badge" }, presetLabel(presets, v.preset)), v.agentVersion !== void 0 ? (0, react.createElement)("span", { className: "dsh-a2a-badge dsh-a2a-mono" }, `v${v.agentVersion}`) : null, (0, react.createElement)("span", { className: "dsh-a2a-auth" }, `· ${v.state} · 工具 ${v.toolCount}/${v.skillCount}`)), (0, react.createElement)("div", { className: "dsh-a2a-card-sub dsh-a2a-mono" }, v.agentCardUrl), v.lastError !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-notice dsh-a2a-error" }, v.lastError) : null, (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: v.enabled ? "outbound.disable" : "outbound.enable",
						id: v.id
					});
				}
			}, v.enabled ? "停用" : "启用"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: "outbound.refresh",
						id: v.id
					});
				}
			}, "刷新"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => beginEditOutbound(v)
			}, "编辑"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: "outbound.remove",
						id: v.id
					});
					if (editingOut === v.id) resetOutboundForm();
				}
			}, "删除")))))), (0, react.createElement)("div", { className: "dsh-a2a-card" }, h(editingOut !== null ? "编辑出站 Server" : "添加出站 Server"), (0, react.createElement)("form", {
				className: "dsh-a2a-form",
				onSubmit: (ev) => {
					ev.preventDefault();
					doDiscover();
				}
			}, (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: outName,
				placeholder: "名称",
				onChange: (e) => setOutName(e.target.value)
			}), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: outUrl,
				placeholder: "远端 AgentCard URL",
				style: {
					flex: 1,
					minWidth: "220px"
				},
				onChange: (e) => {
					setOutUrl(e.target.value);
					setDiscovered(null);
				}
			}), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				type: "password",
				value: outToken,
				placeholder: "Bearer Token（可选）",
				onChange: (e) => setOutToken(e.target.value)
			}), (0, react.createElement)("select", {
				className: "dsh-a2a-select",
				value: outPreset,
				onChange: (e) => setOutPreset(e.target.value)
			}, ...presets.map((p) => (0, react.createElement)("option", {
				value: p.id,
				key: p.id,
				title: p.description ?? p.id
			}, p.name ?? p.id))), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: outTimeout,
				placeholder: "超时 ms",
				style: { width: "90px" },
				onChange: (e) => setOutTimeout(e.target.value)
			}), editingOutbound !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-skill-list" }, (0, react.createElement)("div", { className: "dsh-a2a-skill-list-title" }, "技能（勾选启用）"), ...editingOutbound.skills.map((skill) => (0, react.createElement)("label", {
				key: skill.id,
				className: "dsh-a2a-skill-toggle"
			}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: !outDisabledSkills.includes(skill.id),
				onChange: () => toggleOutboundSkill(skill.id)
			}), ` ${skill.name}${skill.description !== void 0 ? ` — ${skill.description}` : ""}`)), (0, react.createElement)("input", {
				className: "dsh-a2a-input",
				value: outSkillOverrides,
				placeholder: "per-skill 覆盖 JSON，如 {\"chat\":{\"description\":\"...\"}}",
				onChange: (e) => setOutSkillOverrides(e.target.value)
			})) : null, editingOut === null ? (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "submit",
				disabled: busy || discovering || !outUrl.trim()
			}, discovering ? "读取中…" : "导入") : null, (0, react.createElement)("button", {
				className: "dsh-a2a-btn dsh-a2a-btn-primary",
				type: "button",
				disabled: busy || editingOut === null && discovered === null || !outName.trim() || !outUrl.trim(),
				onClick: () => {
					submitOutbound();
				}
			}, editingOut !== null ? "保存修改" : "连接"), editingOut !== null ? (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "button",
				disabled: busy,
				onClick: () => resetOutboundForm()
			}, "取消") : null), discovered !== null ? (0, react.createElement)("div", { className: "dsh-a2a-preview" }, (0, react.createElement)("div", { className: "dsh-a2a-preview-head" }, (0, react.createElement)("span", {
				"data-state": "connected",
				className: "dsh-a2a-dot"
			}), (0, react.createElement)("span", { className: "dsh-a2a-preview-name" }, discovered.name), discovered.version !== void 0 ? (0, react.createElement)("span", { className: "dsh-a2a-preview-meta dsh-a2a-mono" }, `v${discovered.version}`) : null), discovered.description !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-preview-desc" }, discovered.description) : null, discovered.skills.length > 0 ? (0, react.createElement)("div", { className: "dsh-a2a-skill-list" }, (0, react.createElement)("div", { className: "dsh-a2a-skill-list-title" }, `Skills（${discovered.skills.length}）`), ...discovered.skills.map((s) => (0, react.createElement)("div", { key: s.id }, `• ${s.name}${s.description !== void 0 ? ` — ${s.description}` : ""}`))) : null, (0, react.createElement)("div", { className: "dsh-a2a-preview-meta dsh-a2a-mono" }, `端点 ${discovered.endpoint}`), (0, react.createElement)("div", { className: "dsh-a2a-btn-row" }, (0, react.createElement)("button", {
				className: "dsh-a2a-btn dsh-a2a-btn-primary",
				disabled: busy || !outName.trim(),
				onClick: () => {
					submitOutbound();
				}
			}, "连接"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					setDiscovered(null);
					setOutUrl("");
				}
			}, "取消"))) : (0, react.createElement)("div", { className: "dsh-a2a-hint" }, editingOut === null ? "输入远端 AgentCard URL 并点击「导入」，将读取其名称、描述、技能与端点；确认后建立连接。" : "保存将应用名称/Preset/超时与 Token 修改，并重建连接。"))) : null, tab === "activity" ? (0, react.createElement)("div", { className: "dsh-a2a-stack" }, (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("指标"), metrics !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-metrics" }, (0, react.createElement)("span", null, `请求 ${metrics.requests} · 鉴权失败 ${metrics.authFailures}`), (0, react.createElement)("span", null, `任务 ${metrics.tasks.created}（完成 ${metrics.tasks.completed} / 失败 ${metrics.tasks.failed} / 取消 ${metrics.tasks.canceled} / 中断 ${metrics.tasks.interrupted}）`), (0, react.createElement)("span", null, `平均 ${metrics.tasks.avgDurationMs}ms · 最长 ${metrics.tasks.maxDurationMs}ms`), (0, react.createElement)("span", null, `出站 ${metrics.outbound.calls}（错误 ${metrics.outbound.errors}，平均 ${metrics.outbound.avgDurationMs}ms）`)) : empty("暂无指标。"), metrics !== void 0 && metrics.audit.length > 0 ? (0, react.createElement)("div", { className: "dsh-a2a-table-wrap" }, (0, react.createElement)("table", { className: "dsh-a2a-table" }, (0, react.createElement)("thead", null, (0, react.createElement)("tr", null, (0, react.createElement)("th", null, "时间"), (0, react.createElement)("th", null, "事件"), (0, react.createElement)("th", null, "实例 / 任务"), (0, react.createElement)("th", null, "详情"))), (0, react.createElement)("tbody", null, ...metrics.audit.slice(-20).reverse().map((event, index) => (0, react.createElement)("tr", { key: `${event.at}-${index}` }, (0, react.createElement)("td", null, event.at), (0, react.createElement)("td", null, event.kind), (0, react.createElement)("td", null, event.serverId ?? event.taskId ?? "-"), (0, react.createElement)("td", null, event.detail ?? event.method ?? event.source ?? "-")))))) : null), (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("入站连接（谁在调用本服务）", peers.length), peers.length === 0 ? empty("暂无入站连接。其他 A2A 客户端调用本 DSH 的端点后会显示在这里。") : (0, react.createElement)("div", { className: "dsh-a2a-table-wrap" }, (0, react.createElement)("table", { className: "dsh-a2a-table" }, (0, react.createElement)("thead", null, (0, react.createElement)("tr", null, (0, react.createElement)("th", null, "来源"), (0, react.createElement)("th", null, "任务"), (0, react.createElement)("th", null, "流式"), (0, react.createElement)("th", null, "首次 / 最近"), (0, react.createElement)("th", null, "操作"))), (0, react.createElement)("tbody", null, ...peers.map((p) => (0, react.createElement)("tr", { key: p.id }, (0, react.createElement)("td", null, p.source ?? p.label), (0, react.createElement)("td", null, `${p.taskCount}（活跃 ${p.activeTaskIds.length}）`), (0, react.createElement)("td", null, p.streaming ? "●" : "—"), (0, react.createElement)("td", null, (0, react.createElement)("span", { className: "dsh-a2a-card-sub" }, `${p.firstSeen ?? ""} / ${p.lastSeen ?? ""}`)), (0, react.createElement)("td", null, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: "inbound.close",
						id: p.id
					});
				}
			}, "关闭")))))))), (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("入站会话（按 contextId）", sessions.length), sessions.length === 0 ? empty("暂无会话。其他 A2A 客户端带 contextId 调用本服务后，这里会出现一条会话记录。") : (0, react.createElement)("div", { className: "dsh-a2a-table-wrap" }, (0, react.createElement)("table", { className: "dsh-a2a-table" }, (0, react.createElement)("thead", null, (0, react.createElement)("tr", null, (0, react.createElement)("th", null, "会话"), (0, react.createElement)("th", null, "实例"), (0, react.createElement)("th", null, "Preset"), (0, react.createElement)("th", null, "状态"), (0, react.createElement)("th", null, "任务"), (0, react.createElement)("th", null, "流式"), (0, react.createElement)("th", null, "首次 / 最近"), (0, react.createElement)("th", null, "操作"))), (0, react.createElement)("tbody", null, ...sessions.map((s) => (0, react.createElement)("tr", { key: `${s.serverId ?? ""}/${s.contextId}` }, (0, react.createElement)("td", null, (0, react.createElement)("span", { className: "dsh-a2a-card-sub dsh-a2a-mono" }, s.contextId)), (0, react.createElement)("td", null, s.serverName ?? s.serverId ?? "-"), (0, react.createElement)("td", null, s.preset ?? "-"), (0, react.createElement)("td", null, (0, react.createElement)("span", {
				"data-state": s.status === "running" ? "connected" : void 0,
				className: "dsh-a2a-dot"
			}), ` ${s.status === "running" ? "运行中" : "空闲"}`), (0, react.createElement)("td", null, `${s.taskCount}（活跃 ${s.activeCount}）`), (0, react.createElement)("td", null, s.streaming ? "●" : "—"), (0, react.createElement)("td", null, (0, react.createElement)("span", { className: "dsh-a2a-card-sub" }, `${s.firstSeen} / ${s.lastSeen}`)), (0, react.createElement)("td", null, (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy || s.activeCount === 0,
				onClick: () => {
					control({
						action: "session.cancel",
						id: s.contextId,
						...s.serverId !== void 0 ? { serverId: s.serverId } : {}
					});
				}
			}, "取消活跃"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					openConversation(s.contextId, s.serverId);
				}
			}, "对话"), (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				disabled: busy,
				onClick: () => {
					control({
						action: "session.close",
						id: s.contextId,
						...s.serverId !== void 0 ? { serverId: s.serverId } : {}
					});
				}
			}, "关闭")))))))), conversation !== void 0 ? (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h(`会话对话（${conversationKey}）`), (0, react.createElement)("pre", { className: "dsh-a2a-detail" }, JSON.stringify(conversation, null, 2))) : null, (0, react.createElement)("div", { className: "dsh-a2a-crew" }, h("任务", tasks.length), (0, react.createElement)("div", { className: "dsh-a2a-form" }, (0, react.createElement)("select", {
				className: "dsh-a2a-select",
				value: taskFilter,
				onChange: (e) => {
					setTaskFilter(e.target.value);
					setTaskLimit(50);
				}
			}, (0, react.createElement)("option", { value: "" }, "全部状态"), (0, react.createElement)("option", { value: "TASK_STATE_WORKING" }, "WORKING"), (0, react.createElement)("option", { value: "TASK_STATE_COMPLETED" }, "COMPLETED"), (0, react.createElement)("option", { value: "TASK_STATE_FAILED" }, "FAILED"), (0, react.createElement)("option", { value: "TASK_STATE_CANCELED" }, "CANCELED"), (0, react.createElement)("option", { value: "TASK_STATE_INPUT_REQUIRED" }, "INPUT_REQUIRED"), (0, react.createElement)("option", { value: "TASK_STATE_AUTH_REQUIRED" }, "AUTH_REQUIRED")), (0, react.createElement)("span", { className: "dsh-a2a-hint" }, `共 ${snap?.taskTotal ?? tasks.length} 条，显示 ${tasks.length}`), snap?.taskNextOffset !== null && snap?.taskNextOffset !== void 0 ? (0, react.createElement)("button", {
				className: "dsh-a2a-btn",
				type: "button",
				onClick: () => setTaskLimit((current) => current + 50)
			}, "加载更多") : null), tasks.length === 0 ? empty("暂无任务。") : (0, react.createElement)("div", { className: "dsh-a2a-table-wrap" }, (0, react.createElement)("table", { className: "dsh-a2a-table" }, (0, react.createElement)("thead", null, (0, react.createElement)("tr", null, (0, react.createElement)("th", null, "ID"), (0, react.createElement)("th", null, "技能"), (0, react.createElement)("th", null, "来源"), (0, react.createElement)("th", null, "状态"), (0, react.createElement)("th", null, "操作"))), (0, react.createElement)("tbody", null, ...tasks.map((record) => {
				const t = taskRowOf(record);
				return (0, react.createElement)("tr", { key: t.id }, (0, react.createElement)("td", null, (0, react.createElement)("button", {
					className: "dsh-a2a-link dsh-a2a-mono",
					type: "button",
					onClick: () => {
						openTask(t.id);
					}
				}, t.id)), (0, react.createElement)("td", null, t.skill), (0, react.createElement)("td", null, t.serverId), (0, react.createElement)("td", null, t.state), (0, react.createElement)("td", null, (0, react.createElement)("button", {
					className: "dsh-a2a-btn",
					disabled: busy,
					onClick: () => {
						control({
							action: "task.cancel",
							id: t.id
						});
					}
				}, "取消")));
			})))), selectedTask !== void 0 ? (0, react.createElement)("pre", { className: "dsh-a2a-detail" }, JSON.stringify(selectedTask, null, 2)) : null)) : null, (0, react.createElement)("div", { className: "dsh-a2a-footer" }, "每 3 秒自动刷新。")));
		}
		//#endregion
		exports.A2aSection = A2aSection;
		exports.apply = apply;
		exports.inject = inject;
		exports.mountedPluginCount = mountedPluginCount;
		exports.pluginLabel = pluginLabel;
		exports.pluginTitle = pluginTitle;

		return module.exports;
	}
});
