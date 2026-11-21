import z from "@deepseek-ai/schemastery";
import { homedir, networkInterfaces } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { z as z$1 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { Service } from "@deepseek-ai/cordis";
import { createHash, timingSafeEqual } from "node:crypto";
//#region lib/types/protocol.js
/**
* Agent2Agent (A2A) Protocol v1.0.1 — types, JSON-RPC methods, task states,
* error codes and JSON serialization, transcribed from the official
* `a2aproject/A2A` specification (Apache-2.0), cross-checked against
* `specification/a2a.proto` and `docs/specification.md` (JSON-RPC binding,
* ADR-001 ProtoJSON). This file is the plugin's single source of protocol
* truth for the JSON-RPC over HTTP binding. Other bindings (gRPC, REST) are
* not provided.
* @module dsh-a2a/protocol
*/
/** Task lifecycle states (spec `TaskState`; JSON = SCREAMING_SNAKE_CASE per ADR-001). */
var TaskState;
(function(TaskState) {
	TaskState["SUBMITTED"] = "TASK_STATE_SUBMITTED";
	TaskState["WORKING"] = "TASK_STATE_WORKING";
	TaskState["INPUT_REQUIRED"] = "TASK_STATE_INPUT_REQUIRED";
	TaskState["AUTH_REQUIRED"] = "TASK_STATE_AUTH_REQUIRED";
	TaskState["COMPLETED"] = "TASK_STATE_COMPLETED";
	TaskState["FAILED"] = "TASK_STATE_FAILED";
	TaskState["CANCELED"] = "TASK_STATE_CANCELED";
	TaskState["REJECTED"] = "TASK_STATE_REJECTED";
})(TaskState || (TaskState = {}));
/** States that settle a task; a settled task no longer transitions. */
const TERMINAL_STATES = /* @__PURE__ */ new Set([
	TaskState.COMPLETED,
	TaskState.FAILED,
	TaskState.CANCELED,
	TaskState.REJECTED
]);
/** Interrupted (non-terminal, still owed) states. */
const INTERRUPTED_STATES = /* @__PURE__ */ new Set([TaskState.INPUT_REQUIRED, TaskState.AUTH_REQUIRED]);
/** @returns whether the state settles the task. */
function isTerminal(state) {
	return TERMINAL_STATES.has(state);
}
/** Message sender role (spec `Role`; JSON = `ROLE_*` per ADR-001). */
var Role;
(function(Role) {
	Role["USER"] = "ROLE_USER";
	Role["AGENT"] = "ROLE_AGENT";
})(Role || (Role = {}));
/** JSON-RPC + A2A error codes. */
const A2A_ERROR_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	TASK_NOT_FOUND: -32001,
	TASK_CANCEL_NOT_ALLOWED: -32002,
	PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
	UNSUPPORTED_OPERATION: -32004,
	CONTENT_TYPE_NOT_SUPPORTED: -32005,
	STREAMING_NOT_SUPPORTED: -32006,
	VERSION_NOT_SUPPORTED: -32007,
	INVALID_AGENT_RESPONSE: -32008
};
/** A2A v1.0 JSON-RPC method names (spec §5.3 Method Mapping Reference). */
const A2A_METHODS = {
	sendMessage: "SendMessage",
	sendStreamingMessage: "SendStreamingMessage",
	getTask: "GetTask",
	listTasks: "ListTasks",
	cancelTask: "CancelTask",
	subscribeToTask: "SubscribeToTask",
	createTaskPushNotificationConfig: "CreateTaskPushNotificationConfig",
	getTaskPushNotificationConfig: "GetTaskPushNotificationConfig",
	listTaskPushNotificationConfigs: "ListTaskPushNotificationConfigs",
	deleteTaskPushNotificationConfig: "DeleteTaskPushNotificationConfig",
	getExtendedAgentCard: "GetExtendedAgentCard"
};
/** HTTP header used to request and acknowledge A2A extensions. */
const A2A_EXTENSIONS_HEADER = "A2A-Extensions";
/**
* Read a message's text parts as a single string (model-facing convenience).
* File parts render as their URL/name; data parts as JSON.
*/
function partsToText$1(parts) {
	if (!parts) return "";
	return parts.map((p) => {
		if ("text" in p && p.text) return p.text;
		if ("data" in p && p.data !== void 0) return JSON.stringify(p.data);
		if ("raw" in p || "url" in p || "filename" in p) {
			const f = p;
			return f.url ?? `[file ${f.filename ?? f.mediaType ?? "binary"}]`;
		}
		return "";
	}).filter(Boolean).join("\n");
}
//#endregion
//#region lib/types/server/trace.js
/**
* Optional inbound trace extension: discoverable through AgentCard
* `capabilities.extensions` and activated per request with `A2A-Extensions`.
* Trace data is metadata only — never an artifact, never history, never the
* model-facing result. This module owns the URI, schema types, redaction and
* size bounds.
* @module dsh-a2a/server/trace
*/
/** Stable extension URI; a breaking schema change needs a new URI. */
const TRACE_EXTENSION_URI = "https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md";
/** AgentCard declaration for this extension. */
function traceExtension() {
	return {
		uri: TRACE_EXTENSION_URI,
		description: "Optional tool-call trace metadata. Disabled unless the client activates this extension.",
		required: false,
		params: {
			carrier: "metadata",
			default: "off",
			args: "redacted-preview",
			maxCalls: 64
		}
	};
}
/** Append one call to a bounded summary. */
function appendTrace(summary, call) {
	const calls = [...summary?.calls ?? [], call];
	const truncated = summary?.truncated === true || calls.length > 64;
	return {
		calls: truncated ? calls.slice(-64) : calls,
		...truncated ? { truncated: true } : {}
	};
}
const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|authorization|cookie|credential|private[-_]?key/i;
/**
* Redact and truncate a raw tool-argument JSON string for presentation.
* Unparseable arguments are replaced wholesale so a malformed secret cannot
* leak through a best-effort text slice.
*/
function previewArguments(raw, limit = 200) {
	if (typeof raw !== "string" || raw.length === 0) return void 0;
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		return "[unparseable arguments]";
	}
	let text;
	try {
		text = JSON.stringify(redact(value, 0));
	} catch {
		return "[unrenderable arguments]";
	}
	return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}
function redact(value, depth) {
	if (depth > 6) return "[depth-limit]";
	if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
		return out;
	}
	if (typeof value === "string" && value.length > 120) return `${value.slice(0, 119)}…`;
	return value;
}
//#endregion
//#region lib/types/server/store.js
/**
* Durable task storage for the inbound half: one `a2a` domain over the routed
* storage backend (the deployment picks the medium, normally SQLite). Records
* are serialized JSON so the domain tables stay plain kv rows; the domain
* SCHEMA_VERSION guards format evolution. A memory store keeps unit tests and
* minimal embeddings free of a backend.
* @module dsh-a2a/server/store
*/
/** JSON-encoded record schema shared by every `a2a` table. */
const json$1 = z$1.string();
/** The `a2a` storage domain: JSON-encoded records, one table per record kind. */
const a2aDomainSpec = defineDomain({
	name: "a2a",
	version: 1,
	tables: {
		tasks: domainTable(json$1),
		contexts: domainTable(json$1),
		agents: domainTable(json$1),
		identity: domainTable(json$1),
		inbound_servers: domainTable(json$1),
		outbound_servers: domainTable(json$1)
	}
});
/**
* Serialize/deserialize helpers for the domain tables. Plain JSON round-trip
* with shape assertions; `decodeRecord` returns undefined on any mismatch.
*/
function encodeRecord(value) {
	return JSON.stringify(value);
}
function decodeRecord(raw) {
	try {
		return JSON.parse(raw);
	} catch {
		return;
	}
}
/**
* Open the `a2a` domain on the mounted storage-domain facility and expose
* its tables. The caller owns the returned handle and closes it on teardown.
*/
async function openDomain(domain) {
	return new A2aDomain(await domain.open(a2aDomainSpec));
}
/** A2a domain facade: typed JSON tables over the routed backend. */
var A2aDomain = class {
	handle;
	constructor(handle) {
		this.handle = handle;
	}
	get tasks() {
		return this.handle.table("tasks");
	}
	get contexts() {
		return this.handle.table("contexts");
	}
	get agents() {
		return this.handle.table("agents");
	}
	get identity() {
		return this.handle.table("identity");
	}
	get inbound_servers() {
		return this.handle.table("inbound_servers");
	}
	get outbound_servers() {
		return this.handle.table("outbound_servers");
	}
	async close() {
		await this.handle.close();
	}
};
function now() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function recordKey(taskId) {
	return `task:${taskId}`;
}
function contextKey(contextId) {
	return `ctx:${contextId}`;
}
function appendArtifactRecord(artifacts, artifact) {
	if (artifacts.find((a) => a.artifactId === artifact.artifactId)) return artifacts.map((a) => a.artifactId === artifact.artifactId ? {
		...a,
		parts: artifact.append === false ? artifact.parts : [...a.parts, ...artifact.parts]
	} : a);
	return [...artifacts, {
		artifactId: artifact.artifactId,
		...artifact.name !== void 0 ? { name: artifact.name } : {},
		parts: artifact.parts
	}];
}
/** Domain-backed TaskStore (persistent; the composition path). */
var DomainTaskStore = class {
	domain;
	records = /* @__PURE__ */ new Map();
	bindings = /* @__PURE__ */ new Map();
	constructor(domain) {
		this.domain = domain;
		for (const [key, raw] of domain.tasks.entries()) {
			if (!key.startsWith("task:")) continue;
			const record = decodeRecord(raw);
			if (record !== void 0) this.records.set(record.taskId, record);
		}
		for (const [key, raw] of domain.contexts.entries()) {
			if (!key.startsWith("ctx:")) continue;
			const binding = decodeRecord(raw);
			if (binding !== void 0) this.bindings.set(key.slice(4), binding.sessionId);
		}
	}
	create(input) {
		const taskId = `a2a-${crypto.randomUUID()}`;
		const record = {
			taskId,
			contextId: input.contextId,
			skill: input.skill,
			state: TaskState.SUBMITTED,
			createdAt: now(),
			updatedAt: now(),
			sessionId: null,
			remotePeerId: input.remotePeerId,
			parts: input.parts,
			artifacts: [],
			executor: "session",
			summary: null,
			...input.serverId !== void 0 ? { serverId: input.serverId } : {},
			...input.messageId !== void 0 ? { messageIds: [input.messageId] } : {},
			...input.message !== void 0 ? { inputs: [asHistoryMessage(input.message, taskId, input.contextId)] } : {}
		};
		this.records.set(record.taskId, record);
		this.domain.tasks.put(recordKey(record.taskId), encodeRecord(record)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return record;
	}
	get(taskId) {
		return this.records.get(taskId);
	}
	list() {
		return [...this.records.values()];
	}
	setState(taskId, state, message) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		const next = withState(current, state, message, now());
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	appendArtifact(taskId, artifact) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		const next = {
			...current,
			updatedAt: now(),
			artifacts: appendArtifactRecord(current.artifacts, artifact)
		};
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	async setContextSession(contextId, sessionId) {
		const binding = { sessionId };
		this.bindings.set(contextId, sessionId);
		await this.domain.contexts.put(contextKey(contextId), encodeRecord(binding));
	}
	async getContextSession(contextId) {
		return this.bindings.get(contextId);
	}
	async close() {}
	setParts(taskId, parts) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		const next = {
			...current,
			parts,
			updatedAt: now()
		};
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	appendMessageId(taskId, messageId) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		if (current.messageIds?.includes(messageId) === true) return current;
		const next = {
			...current,
			messageIds: [...current.messageIds ?? [], messageId],
			updatedAt: now()
		};
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	appendInput(taskId, message) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		if (message.messageId.length > 0 && current.inputs?.some((item) => item.messageId === message.messageId) === true) return current;
		const next = {
			...current,
			inputs: [...current.inputs ?? seedInputs(current), asHistoryMessage(message, taskId, current.contextId)],
			updatedAt: now()
		};
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	setStatusText(taskId, text) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		const next = {
			...current,
			updatedAt: now()
		};
		if (text === void 0 || text.length === 0) delete next.statusText;
		else next.statusText = text;
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
	appendTrace(taskId, call) {
		const current = this.records.get(taskId);
		if (current === void 0) throw new Error(`task ${taskId} not found`);
		const next = {
			...current,
			trace: appendTrace(current.trace, call),
			updatedAt: now()
		};
		this.records.set(taskId, next);
		this.domain.tasks.put(recordKey(taskId), encodeRecord(next)).catch((err) => {
			throw new Error(`a2a: task persistence failed: ${String(err)}`);
		});
		return next;
	}
};
/**
* One inbound instance's view of the shared task store. Every access is
* filtered by the instance's `serverId`; a task belonging to another instance is
* indistinguishable from a missing task (the A2A spec requires task-not-found,
* not a permission leak). Context bindings are namespaced too, so two instances
* can reuse the same client-chosen contextId without sharing a DSH session.
*/
var ScopedTaskStore = class {
	base;
	serverId;
	constructor(base, serverId) {
		this.base = base;
		this.serverId = serverId;
	}
	create(input) {
		return this.base.create({
			...input,
			serverId: this.serverId
		});
	}
	get(taskId) {
		const record = this.base.get(taskId);
		return record?.serverId === this.serverId ? record : void 0;
	}
	list() {
		return this.base.list().filter((record) => record.serverId === this.serverId);
	}
	setState(taskId, state, message) {
		this.require(taskId);
		return this.base.setState(taskId, state, message);
	}
	appendArtifact(taskId, artifact) {
		this.require(taskId);
		return this.base.appendArtifact(taskId, artifact);
	}
	setParts(taskId, parts) {
		this.require(taskId);
		return this.base.setParts(taskId, parts);
	}
	appendMessageId(taskId, messageId) {
		this.require(taskId);
		return this.base.appendMessageId(taskId, messageId);
	}
	appendInput(taskId, message) {
		this.require(taskId);
		return this.base.appendInput(taskId, message);
	}
	setStatusText(taskId, text) {
		this.require(taskId);
		return this.base.setStatusText(taskId, text);
	}
	appendTrace(taskId, call) {
		this.require(taskId);
		return this.base.appendTrace(taskId, call);
	}
	async setContextSession(contextId, sessionId) {
		await this.base.setContextSession(this.scopedContextId(contextId), sessionId);
	}
	async getContextSession(contextId) {
		return this.base.getContextSession(this.scopedContextId(contextId));
	}
	async close() {}
	scopedContextId(contextId) {
		return `${this.serverId}:${contextId}`;
	}
	require(taskId) {
		if (this.get(taskId) === void 0) throw new Error(`task ${taskId} not found`);
	}
};
function asHistoryMessage(message, taskId, contextId) {
	return {
		...message,
		contextId,
		taskId,
		role: message.role === Role.AGENT ? Role.AGENT : Role.USER
	};
}
/** Seed the visible input list for a record created before `inputs` existed. */
function seedInputs(record) {
	if (record.parts.length === 0) return [];
	return [{
		messageId: record.messageIds?.at(-1) ?? `a2a-input-${record.taskId}`,
		contextId: record.contextId,
		taskId: record.taskId,
		role: Role.USER,
		parts: record.parts
	}];
}
function withState(current, state, message, timestamp) {
	const next = {
		...current,
		state,
		updatedAt: timestamp
	};
	if (message !== void 0) next.error = {
		code: message.code,
		message: message.text
	};
	else if (state === TaskState.FAILED && current.error !== void 0) next.error = current.error;
	else delete next.error;
	return next;
}
//#endregion
//#region lib/types/server/exec/agent-runtime.js
/**
* Shared agent machinery for the inbound executors: one DSH agent session per
* A2A context (create, or resume a persisted one), serialized turns, and
* optional agent-preset composition so a spawned session actually carries
* tools. Adapted from the createDshAgentExecutor pattern pioneered by
* dsh-a2a (MIT).
* @module dsh-a2a/server/exec/agent-runtime
*/
/**
* Apply a tool mask to one agent scope. The host resolves `restrict` against the
* CALLING context, so the mask must be installed on the agent's own context.
* @param agentCtx - the context DSH hands to the create/resume `setup` hook.
* @param restriction - the allow/deny mask to install.
* @returns true when a tool registry accepted the mask.
*/
function applyToolRestriction(agentCtx, restriction) {
	const tools = agentCtx?.tools;
	if (tools?.restrict === void 0) return false;
	tools.restrict(restriction);
	return true;
}
/** An error raised when a turn is canceled by its caller. */
var AgentTurnCanceled = class extends Error {
	constructor() {
		super("a2a: turn canceled");
		this.name = "AgentTurnCanceled";
	}
};
/**
* Per-context session pool: one live DSH agent per A2A contextId, created or
* resumed through the registry, turns serialized per context, every session
* disposeable on teardown.
*/
var ContextSessionPool = class ContextSessionPool {
	agents;
	opts;
	handles = /* @__PURE__ */ new Map();
	openings = /* @__PURE__ */ new Map();
	/** Per-context promise chain: a turn waits for the previous turn to settle. */
	tails = /* @__PURE__ */ new Map();
	constructor(agents, opts) {
		this.agents = agents;
		this.opts = opts;
	}
	/** Session id derived from the A2A context id and instance namespace (stable across restarts). */
	static sessionIdFor(contextId, namespace) {
		return namespace !== void 0 && namespace.length > 0 ? `a2a-${namespace}-${contextId}` : `a2a-${contextId}`;
	}
	/** Get or open the live agent for a context; errors propagate. */
	async agentFor(contextId) {
		const justOpened = !this.handles.has(contextId) && !this.openings.has(contextId);
		return {
			agent: (await this.openHandle(contextId)).agent,
			sessionId: ContextSessionPool.sessionIdFor(contextId, this.opts.sessionNamespace),
			justOpened
		};
	}
	/** Open (or resume) the live handle with a per-context single-flight guard. */
	async openHandle(contextId) {
		const existing = this.handles.get(contextId);
		if (existing !== void 0) return existing;
		const opening = this.openings.get(contextId);
		if (opening !== void 0) return opening;
		const promise = this.openHandleUncached(contextId);
		this.openings.set(contextId, promise);
		try {
			const handle = await promise;
			this.handles.set(contextId, handle);
			return handle;
		} finally {
			if (this.openings.get(contextId) === promise) this.openings.delete(contextId);
		}
	}
	async openHandleUncached(contextId) {
		const sessionId = ContextSessionPool.sessionIdFor(contextId, this.opts.sessionNamespace);
		const agentOptions = this.opts.resolveAgentOptions?.();
		const withModel = agentOptions ? { agentOptions } : {};
		const presets = this.opts.agentPresets;
		const restriction = this.opts.toolRestriction?.();
		let presetId;
		let setup;
		if (presets !== void 0) {
			const wanted = this.opts.presetId?.() ?? void 0;
			presetId = (wanted !== void 0 ? await presets.resolve(wanted) : await presets.resolve()).id;
		}
		if (presets !== void 0 || restriction !== void 0) setup = async (agentCtx) => {
			if (presets !== void 0) await presets.mount(agentCtx, presetId);
			if (restriction !== void 0) try {
				applyToolRestriction(agentCtx, restriction);
			} catch (err) {
				console.warn(`[a2a] could not apply the tool mask: ${err.message}`);
			}
		};
		const createOptions = {
			sessionId,
			meta: presetId ? {
				cwd: this.opts.cwd,
				agentPreset: presetId
			} : { cwd: this.opts.cwd },
			...withModel,
			...setup ? { setup } : {}
		};
		let handle;
		try {
			handle = await this.agents.create(createOptions);
		} catch (err) {
			if (/already (has|owns|exists|owned)|persisted/i.test(err.message)) handle = await this.agents.resume({
				resumeSessionId: sessionId,
				...withModel,
				...setup ? { setup } : {}
			});
			else throw err;
		}
		try {
			await this.opts.reviveArchivedSession?.(sessionId);
		} catch {}
		return handle;
	}
	/** True while this pool holds a live handle for the context. */
	has(contextId) {
		return this.handles.has(contextId);
	}
	/** The live context's derived conversation, or an empty list when not open. */
	messages(contextId) {
		return this.handles.get(contextId)?.agent.session.deriveMessages() ?? [];
	}
	/**
	* Convert A2A parts into durable prompt content. Text and data parts become
	* text; raw image/file parts are admitted through the attachment store so the
	* DSH session receives real attachments rather than URL placeholders.
	*/
	async contentBlocks(parts) {
		if (parts.length === 0) return [];
		const attachments = this.opts.attachments;
		const admission = [];
		const imageTypes = /* @__PURE__ */ new Set([
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif"
		]);
		for (const part of parts) {
			if ("text" in part && typeof part.text === "string") {
				admission.push({
					type: "text",
					text: part.text
				});
				continue;
			}
			if ("data" in part && part.data !== void 0) {
				admission.push({
					type: "text",
					text: JSON.stringify(part.data)
				});
				continue;
			}
			if ("raw" in part && typeof part.raw === "string") {
				if (attachments !== void 0) {
					if (part.mediaType !== void 0 && imageTypes.has(part.mediaType)) {
						admission.push({
							type: "image",
							data: part.raw,
							mediaType: part.mediaType,
							...part.filename !== void 0 ? { name: part.filename } : {}
						});
						continue;
					}
					try {
						const ref = await attachments.admitEncodedFile({
							data: part.raw,
							...part.filename !== void 0 ? { name: part.filename } : {}
						});
						admission.push({
							type: "file",
							attachment: ref
						});
						continue;
					} catch {}
				}
				admission.push({
					type: "text",
					text: filePlaceholder(part)
				});
				continue;
			}
			if ("url" in part && typeof part.url === "string") {
				admission.push({
					type: "text",
					text: part.url
				});
				continue;
			}
			if ("filename" in part) admission.push({
				type: "text",
				text: filePlaceholder(part)
			});
		}
		if (attachments === void 0) return admission.map((part) => part.type === "text" ? {
			type: "text",
			text: part.text
		} : {
			type: "text",
			text: "[attachment unavailable]"
		});
		try {
			return [...await attachments.admitPromptContent(admission)];
		} catch {
			return admission.map((part) => part.type === "text" ? {
				type: "text",
				text: part.text
			} : {
				type: "text",
				text: part.type === "image" ? `[image ${part.name ?? part.mediaType} rejected]` : "[file attachment rejected]"
			});
		}
	}
	/**
	* Dispose ONE context's session (the caller aborts its active tasks first).
	* Removes the handle and its serialization tail, disposes the handle, and
	* lets a non-cooperative in-flight turn drain in the background. Returns
	* whether a handle was held.
	*
	* Close is an in-memory resource release, NOT a conversation tombstone: the
	* A2A protocol has no "closed context" notion, so the next task on the same
	* contextId simply re-opens a fresh handle through `agentFor` (and the host
	* agent runtime may or may not resume persisted history — host behavior).
	*/
	async disposeContext(contextId) {
		const handle = this.handles.get(contextId);
		if (handle === void 0) return false;
		this.handles.delete(contextId);
		const tail = this.tails.get(contextId);
		this.tails.delete(contextId);
		await Promise.allSettled([handle.dispose()]);
		if (tail !== void 0) tail.catch(() => {});
		return true;
	}
	/**
	* Run one turn on a context's session, serialized behind the previous turn.
	* The return value is this turn's assistant text, not the agent's global last
	* assistant message; errors and cancellations are surfaced to the caller.
	*/
	async runTurn(contextId, prompt, signal, options = {}) {
		const run = (this.tails.get(contextId) ?? Promise.resolve()).catch(() => {}).then(() => this.runTurnExclusive(contextId, prompt, signal, options));
		const tail = run.then(() => {}, () => {});
		this.tails.set(contextId, tail);
		try {
			return await run;
		} finally {
			if (this.tails.get(contextId) === tail) this.tails.delete(contextId);
		}
	}
	async runTurnExclusive(contextId, prompt, signal, options) {
		const { agent, sessionId, justOpened } = await this.agentFor(contextId);
		const promptText = typeof prompt === "string" ? prompt : partsToText(prompt);
		const content = typeof prompt === "string" ? [{
			type: "text",
			text: prompt
		}] : await this.contentBlocks(prompt);
		const onAbort = () => agent.cancel("a2a-canceled");
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		let failure;
		const disposers = [];
		const listen = (name, listener) => {
			try {
				const dispose = agent.ctx?.on(name, listener);
				if (typeof dispose === "function") disposers.push(dispose);
			} catch {}
		};
		listen("agent/error", (payload) => {
			const value = payload;
			if (value.agent !== void 0 && value.agent !== agent) return;
			failure = value.error;
		});
		listen("agent/assistant-stream", (payload) => {
			const value = payload;
			if (value.agent !== void 0 && value.agent !== agent) return;
			const frame = value.frame;
			if (frame?.type !== "chunk") return;
			const chunk = frame.chunk;
			if (chunk?.type === "text-delta" && typeof chunk.text === "string" && chunk.text.length > 0) options.onEvent?.({
				type: "text-delta",
				text: chunk.text
			});
		});
		const openCalls = /* @__PURE__ */ new Map();
		const emitTrace = (call) => options.onTrace?.(call);
		if (options.onTrace !== void 0) listen("session/event", (...args) => {
			const [session, event] = args;
			if (session?.id !== void 0 && session.id !== sessionId) return;
			if (event === void 0) return;
			const at = typeof event.time === "number" ? event.time : Date.now();
			if (event.type === "tool/call") {
				const data = event.data;
				const callId = typeof data?.callId === "string" ? data.callId : "";
				if (callId.length === 0) return;
				const tool = typeof data?.name === "string" && data.name.length > 0 ? data.name : "tool";
				const argsPreview = previewArguments(data?.arguments);
				openCalls.set(callId, {
					tool,
					startedAt: at
				});
				emitTrace({
					callId,
					tool,
					phase: "start",
					status: "running",
					...argsPreview !== void 0 ? { argsPreview } : {},
					timestamp: new Date(at).toISOString()
				});
				return;
			}
			if (event.type === "tool/result") {
				const data = event.data;
				const callId = typeof data?.message?.toolCallId === "string" ? data.message.toolCallId : "";
				if (callId.length === 0) return;
				const started = openCalls.get(callId);
				openCalls.delete(callId);
				const tool = started?.tool ?? "tool";
				const durationMs = started === void 0 ? void 0 : Math.max(0, at - started.startedAt);
				emitTrace({
					callId,
					tool,
					phase: "end",
					status: data?.message?.isError === true ? "error" : "ok",
					...durationMs !== void 0 ? { durationMs } : {},
					timestamp: new Date(at).toISOString()
				});
			}
		});
		const baseline = agent.session.deriveMessages().length;
		const userMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content,
			source: { kind: "a2a" }
		};
		try {
			agent.send(userMessage, "next-turn", true);
			if (justOpened) try {
				await this.opts.onSessionOpened?.({
					sessionId,
					contextId,
					firstPrompt: promptText
				});
			} catch {}
			await agent.whenIdle();
			if (failure !== void 0) throw toError(failure);
			const reply = lastAssistantText(agent.session.deriveMessages().slice(baseline));
			if (signal.aborted && reply.length === 0) throw new AgentTurnCanceled();
			return reply;
		} finally {
			for (const [callId, started] of openCalls) emitTrace({
				callId,
				tool: started.tool,
				phase: "end",
				status: "unknown",
				durationMs: Math.max(0, Date.now() - started.startedAt),
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			});
			openCalls.clear();
			for (const dispose of disposers.splice(0)) try {
				dispose();
			} catch {}
		}
	}
	/** Dispose every live per-context session (called on plugin unload). */
	async disposeAll() {
		const live = [...this.handles.values()];
		const openings = [...this.openings.values()];
		const pending = [...this.tails.values()];
		this.handles.clear();
		this.openings.clear();
		this.tails.clear();
		await Promise.allSettled(openings);
		await Promise.allSettled(live.map((h) => h.dispose()));
		for (const tail of pending) tail.catch(() => {});
	}
};
/** Read the last assistant message's text off a derived-history slice. */
function lastAssistantText(history) {
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (message === void 0) continue;
		if (message.role === "assistant") return message.content.filter((b) => b.type === "text").map((b) => typeof b.text === "string" ? b.text : "").filter(Boolean).join("\n").trim();
	}
	return "";
}
/** Text rendering of A2A parts for titles and text-only fallbacks. */
function partsToText(parts) {
	return parts.map((part) => {
		if ("text" in part && typeof part.text === "string") return part.text;
		if ("data" in part && part.data !== void 0) return JSON.stringify(part.data);
		if ("url" in part && typeof part.url === "string") return part.url;
		if ("filename" in part) return filePlaceholder(part);
		return "";
	}).filter(Boolean).join("\n");
}
function filePlaceholder(part) {
	return `[file ${part.filename ?? part.mediaType ?? "binary"}]`;
}
function toError(value) {
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Probe for a readable service method via the reflection layer WITHOUT taking
* an inject dependency (optional services). Returns undefined when the service
* is absent or the method missing.
*/
function probeService(ctx, name, method) {
	try {
		const svc = ctx.reflect?.get(name, true);
		if (svc !== void 0 && svc !== null && typeof svc[method] === "function") return svc;
	} catch {}
}
//#endregion
//#region lib/types/server/session-titles.js
/**
* Session titles for inbound A2A contexts.
*
* The dashboard lists DSH sessions by title, and a fresh inbound session has no
* title until the user renames it by hand. The bridge already knows the stable
* context id it bound the session to (`wx3-...`), so surfacing that id as the
* title makes the session list readable without any extra bookkeeping.
*
* Renaming is cosmetic: it never fails a task.
* @module dsh-a2a/server/session-titles
*/
/** Title shown for one inbound context before anyone renames it. */
function defaultSessionTitle(contextId, sessionId) {
	const context = contextId.trim();
	if (context.length > 0) return context;
	return sessionId.trim();
}
/**
* Name a freshly opened inbound session after the context it is bound to.
*
* @param controller - host session controller, if the deployment exposes one.
* @param sessionId - DSH session id created for the context.
* @param contextId - A2A context id (the value the bridge binds to a contact).
* @param options.onError - notified when the host rejects the rename.
* @returns true when the rename was applied.
*/
async function nameNewSession(controller, sessionId, contextId, options = {}) {
	if (controller === void 0) return false;
	const title = defaultSessionTitle(contextId, sessionId);
	if (title.length === 0) return false;
	try {
		await controller.rename({
			sessionId,
			title
		});
		return true;
	} catch (error) {
		options.onError?.(error);
		return false;
	}
}
//#endregion
//#region lib/types/server/session-registry.js
/**
* Inbound session observation and views: which A2A contexts have a live
* per-context DSH session, and where they are streaming. The LIVE half of the
* session layer is a per-instance registry fed by the A2A server's SSE
* lifecycle hooks (open subscriptions per task); everything else — task
* counts, timestamps, running/idle status — is DERIVED from the shared task
* store. That split is deliberate: a composition without an agent loop (no
* session pool) still renders the session table from task records — degraded,
* never crashing — while stream-open observations only exist where an A2A
* server is actually mounted.
*
* Views are aggregated by `(serverId, contextId)` (one row per inbound
* instance conversation), because the session id is a pure function of both
* (`ContextSessionPool.sessionIdFor`). Two instances may therefore reuse the
* same client-chosen contextId without sharing a session.
* @module dsh-a2a/server/session-registry
*/
/** Per-instance live observation: open SSE subscriptions, counted per task. */
var ContextSessionRegistry = class {
	streamCounts = /* @__PURE__ */ new Map();
	noteStreamOpen(taskId) {
		this.streamCounts.set(taskId, (this.streamCounts.get(taskId) ?? 0) + 1);
	}
	noteStreamClose(taskId) {
		const current = this.streamCounts.get(taskId);
		if (current === void 0) return;
		if (current <= 1) this.streamCounts.delete(taskId);
		else this.streamCounts.set(taskId, current - 1);
	}
	streamingOpenCount(taskId) {
		return this.streamCounts.get(taskId) ?? 0;
	}
	/** Drop all observations (instance teardown / swap). */
	clear() {
		this.streamCounts.clear();
	}
};
/**
* Build per-context session views from the shared task store and the live
* inbound instances. Rows exist whenever the context has task records, so the
* table survives restarts and agent-less compositions (degraded: no live
* handles, no stream observation); only in-memory state resets on restart.
*/
function aggregateSessionViews(tasks, instances) {
	const byContext = /* @__PURE__ */ new Map();
	for (const task of tasks) {
		const key = `${task.serverId ?? ""}\u0000${task.contextId}`;
		const list = byContext.get(key);
		if (list === void 0) byContext.set(key, [task]);
		else list.push(task);
	}
	const byId = new Map(instances.map((i) => [i.id, i]));
	const rows = [];
	for (const contextTasks of byContext.values()) {
		let latest = contextTasks[0];
		let firstSeen = latest.createdAt;
		let lastSeen = latest.updatedAt;
		let activeCount = 0;
		for (const task of contextTasks) {
			if (task.createdAt < firstSeen) firstSeen = task.createdAt;
			if (task.updatedAt > lastSeen) {
				lastSeen = task.updatedAt;
				latest = task;
			}
			if (!isTerminal(task.state)) activeCount += 1;
		}
		const instance = byId.get(latest.serverId ?? "");
		const streaming = contextTasks.some((task) => {
			const owner = byId.get(task.serverId ?? "");
			if (owner !== void 0) return owner.sessions.streamingOpenCount(task.taskId) > 0;
			return instances.some((candidate) => candidate.sessions.streamingOpenCount(task.taskId) > 0);
		});
		const live = instance?.sessionPool?.has(latest.contextId) === true || latest.serverId === void 0 && instances.some((candidate) => candidate.sessionPool?.has(latest.contextId) === true);
		const row = {
			contextId: latest.contextId,
			sessionId: ContextSessionPool.sessionIdFor(latest.contextId, latest.serverId),
			status: activeCount > 0 ? "running" : "idle",
			taskCount: contextTasks.length,
			activeCount,
			firstSeen,
			lastSeen,
			streaming,
			live,
			...latest.serverId !== void 0 ? { serverId: latest.serverId } : {},
			...instance !== void 0 ? { serverName: instance.name } : {},
			...instance?.preset !== void 0 ? { preset: instance.preset } : {}
		};
		rows.push(row);
	}
	return rows.sort((a, b) => a.lastSeen < b.lastSeen ? 1 : -1);
}
//#endregion
//#region lib/types/server/metrics.js
/**
* Structured observability for the A2A plugin: process-local counters plus a
* bounded audit ring. Metrics answer "how many / how long / how many failed";
* audit answers "who called what and what happened". Both are exposed through
* the dashboard API and `ctx.a2a`; they are intentionally not a metrics backend
* or a durable audit log.
* @module dsh-a2a/server/metrics
*/
function emptyServer() {
	return {
		requests: 0,
		authFailures: 0,
		tasksCreated: 0,
		tasksCompleted: 0,
		tasksFailed: 0,
		tasksCanceled: 0,
		tasksInterrupted: 0,
		taskDurationMs: 0,
		outboundCalls: 0,
		outboundErrors: 0,
		outboundDurationMs: 0
	};
}
/** Process-local metrics and audit collector. */
var A2aMetrics = class {
	startedAt = /* @__PURE__ */ new Date();
	servers = /* @__PURE__ */ new Map();
	auditRing = [];
	maxAudit;
	totalRequests = 0;
	totalAuthFailures = 0;
	totalTasks = 0;
	totalCompleted = 0;
	totalFailed = 0;
	totalCanceled = 0;
	totalInterrupted = 0;
	totalTaskDuration = 0;
	maxTaskDuration = 0;
	totalOutboundCalls = 0;
	totalOutboundErrors = 0;
	totalOutboundDuration = 0;
	constructor(maxAudit = 200) {
		this.maxAudit = maxAudit;
	}
	server(serverId) {
		if (serverId === void 0) return void 0;
		let metrics = this.servers.get(serverId);
		if (metrics === void 0) {
			metrics = emptyServer();
			this.servers.set(serverId, metrics);
		}
		return metrics;
	}
	recordRequest(serverId, method, source) {
		this.totalRequests += 1;
		const server = this.server(serverId);
		if (server !== void 0) server.requests += 1;
		this.recordAudit({
			kind: "inbound.request",
			...serverId !== void 0 ? { serverId } : {},
			method,
			...source !== void 0 ? { source } : {}
		});
	}
	recordAuthFailure(serverId, method, source) {
		this.totalAuthFailures += 1;
		const server = this.server(serverId);
		if (server !== void 0) server.authFailures += 1;
		this.recordAudit({
			kind: "inbound.auth.failure",
			...serverId !== void 0 ? { serverId } : {},
			method,
			...source !== void 0 ? { source } : {}
		});
	}
	recordTaskCreated(serverId, taskId) {
		this.totalTasks += 1;
		const server = this.server(serverId);
		if (server !== void 0) server.tasksCreated += 1;
		this.recordAudit({
			kind: "task.created",
			...serverId !== void 0 ? { serverId } : {},
			taskId
		});
	}
	recordTaskSettled(serverId, taskId, state, durationMs) {
		const server = this.server(serverId);
		if (server !== void 0) {
			if (state === TaskState.COMPLETED) server.tasksCompleted += 1;
			else if (state === TaskState.FAILED) server.tasksFailed += 1;
			else if (state === TaskState.CANCELED) server.tasksCanceled += 1;
			else if (state === TaskState.INPUT_REQUIRED || state === TaskState.AUTH_REQUIRED) server.tasksInterrupted += 1;
			server.taskDurationMs += durationMs;
		}
		if (state === TaskState.COMPLETED) this.totalCompleted += 1;
		else if (state === TaskState.FAILED) this.totalFailed += 1;
		else if (state === TaskState.CANCELED) this.totalCanceled += 1;
		else if (state === TaskState.INPUT_REQUIRED || state === TaskState.AUTH_REQUIRED) this.totalInterrupted += 1;
		this.totalTaskDuration += durationMs;
		this.maxTaskDuration = Math.max(this.maxTaskDuration, durationMs);
		this.recordAudit({
			kind: "task.settled",
			...serverId !== void 0 ? { serverId } : {},
			taskId,
			detail: `${state} in ${durationMs}ms`
		});
	}
	recordOutbound(serverId, skill, ok, durationMs, error) {
		this.totalOutboundCalls += 1;
		this.totalOutboundDuration += durationMs;
		if (!ok) this.totalOutboundErrors += 1;
		const server = this.server(serverId);
		if (server !== void 0) {
			server.outboundCalls += 1;
			server.outboundDurationMs += durationMs;
			if (!ok) server.outboundErrors += 1;
		}
		this.recordAudit({
			kind: ok ? "outbound.call" : "outbound.error",
			...serverId !== void 0 ? { serverId } : {},
			detail: `${skill} in ${durationMs}ms${error !== void 0 ? `: ${error}` : ""}`
		});
	}
	recordAudit(event) {
		this.auditRing.push({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			...event
		});
		if (this.auditRing.length > this.maxAudit) this.auditRing.splice(0, this.auditRing.length - this.maxAudit);
	}
	snapshot() {
		const settled = this.totalCompleted + this.totalFailed + this.totalCanceled + this.totalInterrupted;
		return {
			startedAt: this.startedAt.toISOString(),
			uptimeMs: Date.now() - this.startedAt.getTime(),
			requests: this.totalRequests,
			authFailures: this.totalAuthFailures,
			tasks: {
				created: this.totalTasks,
				completed: this.totalCompleted,
				failed: this.totalFailed,
				canceled: this.totalCanceled,
				interrupted: this.totalInterrupted,
				avgDurationMs: settled === 0 ? 0 : Math.round(this.totalTaskDuration / settled),
				maxDurationMs: this.maxTaskDuration
			},
			outbound: {
				calls: this.totalOutboundCalls,
				errors: this.totalOutboundErrors,
				avgDurationMs: this.totalOutboundCalls === 0 ? 0 : Math.round(this.totalOutboundDuration / this.totalOutboundCalls)
			},
			byServer: Object.fromEntries([...this.servers.entries()].map(([id, value]) => [id, { ...value }])),
			audit: [...this.auditRing]
		};
	}
};
//#endregion
//#region lib/types/api.js
/**
* GUI control API for the A2A settings dashboard: one `GET /a2a/api`
* snapshot plus `POST /a2a/api` control actions (inbound/outbound server
* CRUD + enable/disable, task view/cancel, test console, session conversation)
* and focused GET endpoints for an AgentCard, one task, one conversation, and
* metrics. The browser half talks only to this route; it carries no protocol
* knowledge. Loopback-only by default so the dashboard cannot be driven from
* the wire.
*
* The route body is bound to the same `A2AServiceImpl` facade the `/a2a`
* command surface uses, so GUI actions and commands cannot disagree.
* @module dsh-a2a/api
*/
const DEFAULT_MAX_BODY_BYTES = 1048576;
function readBody$1(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.byteLength;
			if (size > maxBytes) {
				const error = /* @__PURE__ */ new Error("request body too large");
				error.code = "BODY_TOO_LARGE";
				req.resume();
				reject(error);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.once("error", reject);
	});
}
/** The caller is the local machine (never a remote peer). */
function isLoopback(req) {
	const address = req.socket?.remoteAddress;
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-cache"
	});
	res.end(JSON.stringify(value));
}
/** Handle one dashboard API request against the service facade. */
async function handleApiRequest(req, res, impl, update) {
	if (!isLoopback(req)) {
		res.writeHead(403, { "content-type": "text/plain" });
		res.end("forbidden");
		return;
	}
	const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = parsed.pathname;
	if (req.method === "GET" && path === "/a2a/api/update") {
		if (update === void 0) {
			json(res, 200, {
				ok: false,
				error: "update checker is not mounted"
			});
			return;
		}
		try {
			json(res, 200, await update.check(parsed.searchParams.get("refresh") === "1"));
		} catch (err) {
			json(res, 200, {
				ok: false,
				current: update.current,
				latest: null,
				error: err.message
			});
		}
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/presets") {
		json(res, 200, await impl.presets());
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/tools") {
		json(res, 200, await impl.tools());
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/models") {
		if (parsed.searchParams.get("debug") === "1") json(res, 200, {
			models: await impl.models(),
			diagnostics: await impl.modelDiagnostics()
		});
		else json(res, 200, await impl.models());
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/card") {
		const id = parsed.searchParams.get("id") ?? "";
		const card = impl.agentCard(id);
		if (card === void 0) json(res, 404, {
			ok: false,
			message: `inbound server ${id} not found`
		});
		else json(res, 200, card);
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/task") {
		const id = parsed.searchParams.get("id") ?? "";
		const task = impl.getTask(id);
		if (task === void 0) json(res, 404, {
			ok: false,
			message: `task ${id} not found`
		});
		else json(res, 200, task);
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/session") {
		const contextId = parsed.searchParams.get("contextId") ?? "";
		const serverId = parsed.searchParams.get("serverId") ?? void 0;
		try {
			json(res, 200, impl.sessionMessages(contextId, serverId));
		} catch (err) {
			json(res, 409, {
				ok: false,
				message: err.message
			});
		}
		return;
	}
	if (req.method === "GET" && path === "/a2a/api/metrics") {
		json(res, 200, impl.metrics());
		return;
	}
	if (req.method === "GET") {
		json(res, 200, snapshotOf(impl, parsed.searchParams, update));
		return;
	}
	if (req.method === "POST") {
		let payload;
		try {
			payload = JSON.parse(await readBody$1(req));
		} catch (err) {
			const tooLarge = err.code === "BODY_TOO_LARGE";
			json(res, tooLarge ? 413 : 400, {
				ok: false,
				message: tooLarge ? "request body too large" : "invalid JSON body"
			});
			return;
		}
		let result;
		try {
			result = await dispatch(payload, impl);
		} catch (err) {
			result = {
				ok: false,
				message: err.message
			};
		}
		json(res, result.ok ? 200 : 409, result);
		return;
	}
	res.writeHead(405, { "content-type": "text/plain" });
	res.end("Method Not Allowed");
}
function snapshotOf(impl, params, update) {
	const status = impl.status();
	const limit = parsePositiveInt(params.get("taskLimit"), 50);
	const offset = parseNonNegativeInt(params.get("taskOffset"), 0);
	const state = params.get("taskState") ?? void 0;
	const contextId = params.get("taskContextId") ?? void 0;
	const serverId = params.get("taskServerId") ?? void 0;
	const result = impl.listTasks({
		limit,
		offset,
		...state !== void 0 && state.length > 0 ? { state } : {},
		...contextId !== void 0 && contextId.length > 0 ? { contextId } : {},
		...serverId !== void 0 && serverId.length > 0 ? { serverId } : {}
	});
	const page = Array.isArray(result) ? {
		tasks: result,
		total: result.length,
		nextOffset: null
	} : result;
	return {
		version: update?.current ?? "",
		inbounds: status.inbounds ?? [],
		outbounds: status.outbounds ?? [],
		tasks: page.tasks,
		taskTotal: page.total,
		taskNextOffset: page.nextOffset,
		peers: status.peers ?? impl.inbounds(),
		sessions: status.sessions ?? impl.listSessions(),
		metrics: impl.metrics?.() ?? {},
		settings: impl.settings()
	};
}
async function dispatch(payload, impl) {
	switch (payload.action) {
		case "inbound.create": return impl.createInboundServer({
			name: payload.name,
			description: payload.description,
			version: payload.version,
			...payload.endpointPath !== void 0 ? { endpointPath: payload.endpointPath } : {},
			...payload.preset !== void 0 ? { preset: payload.preset } : {},
			...payload.authTokenEnv !== void 0 ? { authTokenEnv: payload.authTokenEnv } : {},
			...payload.trace !== void 0 ? { trace: payload.trace } : {},
			...payload.enabled !== void 0 ? { enabled: payload.enabled } : {},
			...payload.workspace !== void 0 ? { workspace: payload.workspace } : {},
			...payload.provider !== void 0 ? { provider: payload.provider } : {},
			...payload.model !== void 0 ? { model: payload.model } : {},
			...payload.toolAllow !== void 0 ? { toolAllow: payload.toolAllow } : {},
			...payload.baseUrl !== void 0 ? { baseUrl: payload.baseUrl } : {}
		});
		case "inbound.remove": return impl.removeInboundServer(payload.id);
		case "inbound.enable": return impl.setInboundServerEnabled(payload.id, true);
		case "inbound.disable": return impl.setInboundServerEnabled(payload.id, false);
		case "inbound.update": return impl.updateInboundServer(payload.id, {
			...payload.name !== void 0 ? { name: payload.name } : {},
			...payload.description !== void 0 ? { description: payload.description } : {},
			...payload.version !== void 0 ? { version: payload.version } : {},
			...payload.endpointPath !== void 0 ? { endpointPath: payload.endpointPath } : {},
			...payload.preset !== void 0 ? { preset: payload.preset } : {},
			...payload.authTokenEnv !== void 0 ? { authTokenEnv: payload.authTokenEnv } : {},
			...payload.trace !== void 0 ? { trace: payload.trace } : {},
			...payload.workspace !== void 0 ? { workspace: payload.workspace } : {},
			...payload.provider !== void 0 ? { provider: payload.provider } : {},
			...payload.model !== void 0 ? { model: payload.model } : {},
			...payload.toolAllow !== void 0 ? { toolAllow: payload.toolAllow } : {},
			...payload.baseUrl !== void 0 ? { baseUrl: payload.baseUrl } : {}
		});
		case "inbound.setAuth": return impl.setInboundAuth(payload.id, payload.token !== void 0 && payload.token.length > 0 ? payload.token : void 0);
		case "inbound.sendTest": return {
			ok: true,
			message: "test message submitted",
			task: await impl.sendTestMessage(payload.id, {
				text: payload.text,
				...payload.contextId !== void 0 ? { contextId: payload.contextId } : {},
				...payload.skill !== void 0 ? { skill: payload.skill } : {}
			})
		};
		case "settings.update": return impl.updateSettings(payload.baseUrl !== void 0 ? { baseUrl: payload.baseUrl } : {});
		case "outbound.create": return impl.createOutboundServer({
			name: payload.name,
			agentCardUrl: payload.agentCardUrl,
			...payload.bearerTokenEnv !== void 0 ? { bearerTokenEnv: payload.bearerTokenEnv } : {},
			...payload.preset !== void 0 ? { preset: payload.preset } : {},
			...payload.enabled !== void 0 ? { enabled: payload.enabled } : {},
			...payload.timeoutMs !== void 0 ? { timeoutMs: payload.timeoutMs } : {},
			...payload.disabledSkills !== void 0 ? { disabledSkills: payload.disabledSkills } : {},
			...payload.skillOverrides !== void 0 ? { skillOverrides: payload.skillOverrides } : {}
		});
		case "outbound.remove": return impl.removeOutboundServer(payload.id);
		case "outbound.enable": return impl.setOutboundServerEnabled(payload.id, true);
		case "outbound.disable": return impl.setOutboundServerEnabled(payload.id, false);
		case "outbound.refresh": return impl.refreshOutboundServer(payload.id);
		case "outbound.setAuth": return impl.setOutboundAuth(payload.id, payload.token !== void 0 && payload.token.length > 0 ? payload.token : void 0);
		case "outbound.discover": return impl.discoverOutbound(payload.agentCardUrl, payload.token !== void 0 && payload.token.length > 0 ? payload.token : void 0);
		case "outbound.update": return impl.updateOutboundServer(payload.id, {
			...payload.name !== void 0 ? { name: payload.name } : {},
			...payload.preset !== void 0 ? { preset: payload.preset } : {},
			...payload.timeoutMs !== void 0 ? { timeoutMs: payload.timeoutMs } : {},
			...payload.disabledSkills !== void 0 ? { disabledSkills: payload.disabledSkills } : {},
			...payload.skillOverrides !== void 0 ? { skillOverrides: payload.skillOverrides } : {}
		});
		case "task.cancel": return impl.cancelTask(payload.id);
		case "inbound.close": return impl.closeInbound(payload.id);
		case "session.cancel": return payload.serverId !== void 0 ? impl.cancelSessionTasks(payload.id, payload.serverId) : impl.cancelSessionTasks(payload.id);
		case "session.close": return payload.serverId !== void 0 ? impl.closeSession(payload.id, payload.serverId) : impl.closeSession(payload.id);
		default: return {
			ok: false,
			message: `unknown action ${String(payload.action)}`
		};
	}
}
function parsePositiveInt(raw, fallback) {
	const value = raw === null ? NaN : Number.parseInt(raw, 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}
function parseNonNegativeInt(raw, fallback) {
	const value = raw === null ? NaN : Number.parseInt(raw, 10);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}
//#endregion
//#region lib/types/update.js
/**
* Plugin version and update check.
*
* The dashboard shows this plugin's version and offers a "check for updates"
* action. Checking is explicit and read-only: it never installs anything; it
* asks the npm registry and the GitHub repository from `package.json` for the
* latest published version, compares it with the installed one, and reports the
* update command for the user to run. The panel asks once when it opens, and
* the button forces a fresh lookup.
*
* Principles:
* - the repository/package identity comes from the plugin's own
*   `package.json`, never from a hard-coded URL;
* - "unknown" is reported as unknown — a failed lookup never renders as
*   "up to date";
* - the result is cached for six hours; an explicit refresh bypasses it;
* - the network is only touched by `check()`, never by snapshot traffic.
* @module dsh-a2a/update
*/
const DEFAULT_CACHE_TTL_MS = 216e5;
const DEFAULT_TIMEOUT_MS = 8e3;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const VERSION_PATTERN = /^\s*[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;
/** Parse a version such as `1.2.3`, `v1.2.3`, or `1.2.3-rc.1`. */
function parseVersion(value) {
	const match = VERSION_PATTERN.exec(value);
	if (match === null) return null;
	return {
		core: [
			Number(match[1] ?? 0),
			Number(match[2] ?? 0),
			Number(match[3] ?? 0)
		],
		prerelease: match[4] === void 0 ? [] : match[4].split(".").filter((part) => part !== "")
	};
}
/**
* Compare two semantic versions.
* @returns a negative number when `a < b`, zero when equal, positive when `a > b`.
* @throws when either side is not a parseable version.
*/
function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (left === null) throw new Error(`invalid version: ${JSON.stringify(a)}`);
	if (right === null) throw new Error(`invalid version: ${JSON.stringify(b)}`);
	for (let index = 0; index < 3; index += 1) {
		const x = left.core[index] ?? 0;
		const y = right.core[index] ?? 0;
		if (x !== y) return x > y ? 1 : -1;
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}
/** SemVer prerelease precedence; an absent prerelease outranks a present one. */
function comparePrerelease(left, right) {
	if (left.length === 0 && right.length === 0) return 0;
	if (left.length === 0) return 1;
	if (right.length === 0) return -1;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const x = left[index];
		const y = right[index];
		if (x === void 0) return -1;
		if (y === void 0) return 1;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) {
			const delta = Number(x) - Number(y);
			if (delta !== 0) return delta > 0 ? 1 : -1;
			continue;
		}
		if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
		if (x !== y) return x > y ? 1 : -1;
	}
	return 0;
}
function repositoryUrl(manifest) {
	const repository = manifest["repository"];
	const candidate = typeof repository === "object" && repository !== null ? repository.url : repository;
	const raw = typeof candidate === "string" && candidate.trim() !== "" ? candidate : typeof manifest["homepage"] === "string" ? manifest["homepage"] : "";
	if (raw.trim() === "") return null;
	return raw.trim().replace(/^git\+/, "").replace(/^git:/, "https:").replace(/\.git$/i, "").replace(/#readme$/i, "");
}
function readPackageMeta(packageRoot) {
	try {
		const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { repoUrl: null };
		const manifest = parsed;
		return {
			...typeof manifest["name"] === "string" ? { name: manifest["name"] } : {},
			...typeof manifest["version"] === "string" ? { version: manifest["version"] } : {},
			repoUrl: repositoryUrl(manifest)
		};
	} catch {
		return { repoUrl: null };
	}
}
/** npm registry's `latest` endpoint for one package. */
function npmLatestUrl(packageName, baseUrl) {
	const path = packageName.replace("/", "%2F");
	return `${baseUrl.replace(/\/+$/, "")}/${path}/latest`;
}
/** Candidate raw `package.json` URLs for a GitHub repository. */
function githubPackageUrls(repoUrl) {
	const match = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(repoUrl ?? "");
	if (match === null) return [];
	const owner = match[1];
	const name = (match[2] ?? "").replace(/\.git$/i, "");
	if (owner === void 0 || name === "") return [];
	return [`https://raw.githubusercontent.com/${owner}/${name}/HEAD/package.json`, `https://cdn.jsdelivr.net/gh/${owner}/${name}@main/package.json`];
}
async function fetchJson(url, fetchImpl, timeoutMs) {
	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(timeoutMs),
		headers: {
			accept: "application/json",
			"user-agent": "@lf17708152275/dsh-a2a update-check"
		}
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return await response.json();
}
function versionOf(payload) {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return void 0;
	const version = payload.version;
	return typeof version === "string" && version.trim() !== "" ? version : void 0;
}
function runtimeVersions() {
	const profile = process.env["DSH_PROFILE"];
	return {
		node: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		profile: typeof profile === "string" && profile !== "" ? profile : null
	};
}
/**
* Create a lazily-checking update checker for one package root.
* @param options - package location, cache/network overrides.
*/
function createUpdateChecker(options) {
	const meta = readPackageMeta(options.packageRoot);
	const current = meta.version ?? "";
	const packageName = meta.name ?? "@lf17708152275/dsh-a2a";
	const repoUrl = meta.repoUrl;
	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? fetch;
	const now = options.now ?? Date.now;
	const registryBaseUrl = options.registryBaseUrl ?? DEFAULT_REGISTRY;
	const runtime = runtimeVersions();
	let cache;
	let inflight;
	const unavailable = (error, checkedAt) => ({
		ok: false,
		current,
		latest: null,
		hasUpdate: false,
		ahead: false,
		error,
		source: null,
		repoUrl,
		packageName,
		checkedAt,
		cached: false,
		runtime
	});
	async function lookup() {
		if (current === "") return unavailable("读不到插件版本（package.json 缺少 version）", now());
		const errors = [];
		const candidates = [];
		const collect = async (source, url, parse) => {
			try {
				const version = parse(await fetchJson(url, fetchImpl, timeoutMs));
				if (version === void 0) throw new Error("响应里没有 version");
				if (parseVersion(version) === null) throw new Error(`版本号无法解析：${version}`);
				candidates.push({
					source,
					version
				});
			} catch (err) {
				errors.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
			}
		};
		const lookups = [collect("npm", npmLatestUrl(packageName, registryBaseUrl), versionOf)];
		for (const url of githubPackageUrls(repoUrl)) lookups.push(collect("github", url, versionOf));
		await Promise.all(lookups);
		let latest;
		for (const candidate of candidates) if (latest === void 0 || compareVersions(candidate.version, latest.version) > 0) latest = candidate;
		const checkedAt = now();
		if (latest === void 0) return unavailable(errors.length > 0 ? errors.join("; ") : "没有可用的更新源", checkedAt);
		const comparison = compareVersions(latest.version, current);
		return {
			ok: true,
			current,
			latest: latest.version,
			hasUpdate: comparison > 0,
			ahead: comparison < 0,
			error: null,
			source: latest.source,
			repoUrl,
			packageName,
			checkedAt,
			cached: false,
			runtime
		};
	}
	return {
		current,
		packageName,
		repoUrl,
		async check(force = false) {
			if (!force && cache !== void 0 && now() - cache.checkedAt < cacheTtlMs) return {
				...cache,
				cached: true
			};
			if (inflight !== void 0) return inflight;
			inflight = lookup().catch((err) => unavailable(err instanceof Error ? err.message : String(err), now())).then((info) => {
				cache = info;
				return info;
			}).finally(() => {
				inflight = void 0;
			});
			return inflight;
		}
	};
}
//#endregion
//#region lib/types/service.js
/**
* The `ctx.a2a` service facade: the thin read/control surface commands, the
* GUI API, and other plugins use. Registered as a Cordis Service so the key
* disappears with the plugin fiber.
* @module dsh-a2a/service
*/
/** The service other plugins read as `ctx.a2a`. */
var A2AService = class extends Service {
	impl;
	constructor(ctx, impl) {
		super(ctx, "a2a");
		this.impl = impl;
	}
	status() {
		return this.impl.status();
	}
	async models() {
		return this.impl.models();
	}
	async tools() {
		return this.impl.tools();
	}
	async modelDiagnostics() {
		return this.impl.modelDiagnostics();
	}
	settings() {
		return this.impl.settings();
	}
	async updateSettings(patch) {
		return this.impl.updateSettings(patch);
	}
	async presets() {
		return this.impl.presets();
	}
	listInboundServers() {
		return this.impl.listInboundServers();
	}
	async createInboundServer(input) {
		return this.impl.createInboundServer(input);
	}
	async removeInboundServer(id) {
		return this.impl.removeInboundServer(id);
	}
	async setInboundServerEnabled(id, enabled) {
		return this.impl.setInboundServerEnabled(id, enabled);
	}
	async updateInboundServer(id, patch) {
		return this.impl.updateInboundServer(id, patch);
	}
	async setInboundAuth(id, token) {
		return this.impl.setInboundAuth(id, token);
	}
	agentCard(id) {
		return this.impl.agentCard(id);
	}
	async sendTestMessage(id, input) {
		return this.impl.sendTestMessage(id, input);
	}
	listOutboundServers() {
		return this.impl.listOutboundServers();
	}
	async createOutboundServer(input) {
		return this.impl.createOutboundServer(input);
	}
	async removeOutboundServer(id) {
		return this.impl.removeOutboundServer(id);
	}
	async setOutboundServerEnabled(id, enabled) {
		return this.impl.setOutboundServerEnabled(id, enabled);
	}
	async refreshOutboundServer(id) {
		return this.impl.refreshOutboundServer(id);
	}
	async setOutboundAuth(id, token) {
		return this.impl.setOutboundAuth(id, token);
	}
	async discoverOutbound(url, bearerToken) {
		return this.impl.discoverOutbound(url, bearerToken);
	}
	async updateOutboundServer(id, patch) {
		return this.impl.updateOutboundServer(id, patch);
	}
	getTask(taskId) {
		return this.impl.getTask(taskId);
	}
	listTasks(query) {
		return this.impl.listTasks(query);
	}
	async cancelTask(taskId) {
		return this.impl.cancelTask(taskId);
	}
	listSessions() {
		return this.impl.listSessions();
	}
	async cancelSessionTasks(contextId, serverId) {
		return this.impl.cancelSessionTasks(contextId, serverId);
	}
	async closeSession(contextId, serverId) {
		return this.impl.closeSession(contextId, serverId);
	}
	sessionMessages(contextId, serverId) {
		return this.impl.sessionMessages(contextId, serverId);
	}
	metrics() {
		return this.impl.metrics();
	}
	inbounds() {
		return this.impl.inbounds();
	}
	async closeInbound(peerId) {
		return this.impl.closeInbound(peerId);
	}
};
//#endregion
//#region lib/types/commands.js
/**
* The `/a2a` command surface: status, inbound/outbound server CRUD +
* enable/disable, and task control — a text backup to the GUI (the settings
* panel is the primary surface). All operations delegate to the same
* `A2AServiceImpl` facade as the dashboard API.
* @module dsh-a2a/commands
*/
/** Build the `/a2a` command definition over the service facade. */
function buildA2aCommand(impl) {
	return {
		name: "a2a",
		description: "Manage the A2A plugin: status, inbound/outbound servers, tasks.",
		handler: async (invocation) => {
			const [verb, ...rest] = invocation.rawInput.trim().split(/\s+/);
			switch (verb ?? "") {
				case "":
				case "status": return success(JSON.stringify(impl.status(), null, 2));
				case "presets": return success(JSON.stringify(await impl.presets(), null, 2));
				case "inbound": {
					const [action, id, ...args] = rest;
					switch (action ?? "") {
						case "list": return success(JSON.stringify(impl.listInboundServers(), null, 2));
						case "create": {
							const name = id;
							if (!name) return error("usage: /a2a inbound create <name> [preset] [description]");
							const preset = args[0];
							return outcome(await impl.createInboundServer({
								name,
								description: args.slice(1).join(" ") || "An A2A inbound server",
								version: "1.0.0",
								...preset && preset !== "default" ? { preset } : {}
							}));
						}
						case "remove": return id ? outcome(await impl.removeInboundServer(id)) : error("usage: /a2a inbound remove <id>");
						case "enable": return id ? outcome(await impl.setInboundServerEnabled(id, true)) : error("usage: /a2a inbound enable <id>");
						case "disable": return id ? outcome(await impl.setInboundServerEnabled(id, false)) : error("usage: /a2a inbound disable <id>");
						default: return error("usage: /a2a inbound list|create|remove|enable|disable ...");
					}
				}
				case "outbound": {
					const [action, id, ...args] = rest;
					switch (action ?? "") {
						case "list": return success(JSON.stringify(impl.listOutboundServers(), null, 2));
						case "create": {
							const url = id;
							if (!url) return error("usage: /a2a outbound create <agentCardUrl> [name] [preset]");
							const name = args[0] ?? url;
							const preset = args[1];
							return outcome(await impl.createOutboundServer({
								name,
								agentCardUrl: url,
								...preset && preset !== "default" ? { preset } : {}
							}));
						}
						case "remove": return id ? outcome(await impl.removeOutboundServer(id)) : error("usage: /a2a outbound remove <id>");
						case "enable": return id ? outcome(await impl.setOutboundServerEnabled(id, true)) : error("usage: /a2a outbound enable <id>");
						case "disable": return id ? outcome(await impl.setOutboundServerEnabled(id, false)) : error("usage: /a2a outbound disable <id>");
						case "refresh": return id ? outcome(await impl.refreshOutboundServer(id)) : error("usage: /a2a outbound refresh <id>");
						default: return error("usage: /a2a outbound list|create|remove|enable|disable|refresh ...");
					}
				}
				case "tasks": return success(JSON.stringify(impl.listTasks({ limit: 50 }), null, 2));
				case "task": {
					const [action, id] = rest;
					if (action === "get" && id) return success(JSON.stringify(impl.getTask(id), null, 2));
					if (action === "cancel" && id) return outcome(await impl.cancelTask(id));
					return error("usage: /a2a task get|cancel <taskId>");
				}
				case "sessions": return success(JSON.stringify(impl.listSessions(), null, 2));
				case "session": {
					const [action, id] = rest;
					if (action === "cancel" && id) return outcome(await impl.cancelSessionTasks(id));
					if (action === "close" && id) return outcome(await impl.closeSession(id));
					return error("usage: /a2a session cancel|close <contextId>");
				}
				case "peers": return success(JSON.stringify(impl.inbounds(), null, 2));
				case "help": return success("a2a: status | presets | inbound list/create/remove/enable/disable | outbound list/create/remove/enable/disable/refresh | tasks | task get/cancel <id> | sessions | session cancel/close <contextId> | peers | help");
				default: return error(`unknown a2a verb "${verb}" (try /a2a help)`);
			}
		}
	};
}
function success(text) {
	return {
		kind: "success",
		text
	};
}
function error(text) {
	return {
		kind: "error",
		text
	};
}
function outcome(result) {
	return result.ok ? success(result.message) : error(result.message);
}
//#endregion
//#region lib/types/server/card.js
/**
* AgentCard assembly for the inbound half: identity and skill DECLARATION at
* the instance level. The skill list is exactly the creator-declared
* `AgentSkill[]` stored on the inbound server instance — no derivation from
* the live tool registry (the v0.2 white-list mechanism is removed). The
* advertised card is a pure function of the instance record plus its base URL
* and endpoint path.
* @module dsh-a2a/server/card
*/
/** Assemble the AgentCard advertised by this DSH. */
function buildCard(options) {
	const iface = {
		url: `${options.baseUrl.replace(/\/$/, "")}${options.endpointPath}`,
		protocolBinding: "JSONRPC",
		protocolVersion: "1.0"
	};
	const extensions = [...options.trace === true ? [traceExtension()] : [], ...options.extensions ?? []];
	return {
		name: options.name,
		description: options.description,
		version: options.version,
		provider: {
			url: "https://deepseek.com",
			organization: "DeepSeek"
		},
		capabilities: {
			streaming: true,
			pushNotifications: false,
			extendedAgentCard: true,
			stateTransitionHistory: false,
			...extensions.length > 0 ? { extensions } : {}
		},
		defaultInputModes: [...options.inputModes ?? ["text/plain"]],
		defaultOutputModes: [...options.outputModes ?? ["text/plain"]],
		skills: options.skills,
		supportedInterfaces: [iface],
		...options.authToken !== void 0 ? {
			securitySchemes: { bearer: { httpAuthSecurityScheme: {
				scheme: "bearer",
				description: "Shared bearer token"
			} } },
			securityRequirements: [{ schemes: { bearer: { list: ["bearer"] } } }]
		} : {}
	};
}
//#endregion
//#region lib/types/jsonrpc.js
/** Parse a request body into a JSON-RPC request, or undefined on malformed input. */
function parseRpc(body) {
	let value;
	try {
		value = JSON.parse(body);
	} catch {
		return;
	}
	if (typeof value !== "object" || value === null) return void 0;
	const rpc = value;
	if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return void 0;
	return rpc;
}
/** Build a JSON-RPC error response object. */
function rpcError(id, code, message, data) {
	return {
		jsonrpc: "2.0",
		id: id ?? null,
		error: {
			code,
			message,
			...data === void 0 ? {} : { data }
		}
	};
}
/** Build a JSON-RPC success response object. */
function rpcSuccess(id, result) {
	return {
		jsonrpc: "2.0",
		id: id ?? null,
		result
	};
}
//#endregion
//#region lib/types/server/rate-limit.js
/**
* Small in-memory rate limiter for one inbound A2A instance. Sliding-window
* counters keyed by request source (or a stable fallback) keep a public
* endpoint from being flooded and are intentionally process-local: this plugin
* has no distributed quota store.
* @module dsh-a2a/server/rate-limit
*/
/** Sliding-window request limiter. */
var SlidingWindowLimiter = class {
	limit;
	windowMs;
	hits = /* @__PURE__ */ new Map();
	constructor(limit, windowMs) {
		this.limit = limit;
		this.windowMs = windowMs;
	}
	allow(key, now = Date.now()) {
		if (this.limit <= 0) return {
			ok: true,
			retryAfterMs: 0
		};
		const cutoff = now - this.windowMs;
		const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
		if (recent.length >= this.limit) {
			const oldest = recent[0] ?? now;
			this.hits.set(key, recent);
			return {
				ok: false,
				retryAfterMs: Math.max(1, oldest + this.windowMs - now)
			};
		}
		recent.push(now);
		this.hits.set(key, recent);
		if (this.hits.size > 1024) {
			for (const [entry, times] of this.hits) if (times.every((at) => at <= cutoff)) this.hits.delete(entry);
		}
		return {
			ok: true,
			retryAfterMs: 0
		};
	}
};
//#endregion
//#region lib/types/server/a2a-server.js
/**
* The inbound A2A server: JSON-RPC dispatch, the task lifecycle, and SSE
* streaming. Transport-agnostic — `handle` / `handleStream` take a structural
* request and return bytes; the HTTP binding lives in routes.ts.
* @module dsh-a2a/server/a2a-server
*/
/** A2A JSON-RPC / SSE server over a structural request. */
var A2AServer = class {
	opts;
	card;
	listeners = /* @__PURE__ */ new Map();
	waiters = /* @__PURE__ */ new Map();
	running = /* @__PURE__ */ new Map();
	eventLogs = /* @__PURE__ */ new Map();
	limiter;
	maxEventLog;
	nextEventId = 1;
	constructor(opts) {
		this.opts = opts;
		this.card = opts.card;
		if (opts.serverId !== void 0 && !(opts.store instanceof ScopedTaskStore)) this.opts = {
			...opts,
			store: new ScopedTaskStore(opts.store, opts.serverId)
		};
		this.limiter = opts.requestsPerMinute !== void 0 && opts.requestsPerMinute > 0 ? new SlidingWindowLimiter(opts.requestsPerMinute, 6e4) : void 0;
		this.maxEventLog = opts.maxEventLog ?? 200;
	}
	/** Swap the served AgentCard (runtime identity edits). Routes re-read `server.card` on every request. */
	setCard(next) {
		this.card = next;
	}
	/** The AgentCard route path for this instance. */
	cardPath() {
		return this.opts.cardPath ?? "/.well-known/agent-card.json";
	}
	/** Extensions this request successfully activates (only optional trace today). */
	activatedExtensions(req) {
		if (this.opts.traceEnabled !== true) return [];
		const raw = headerValue(req, A2A_EXTENSIONS_HEADER);
		if (raw === void 0) return [];
		return raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0).includes("https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md") ? [TRACE_EXTENSION_URI] : [];
	}
	/** Response headers that acknowledge activated extensions. */
	responseHeaders(req) {
		const activated = this.activatedExtensions(req);
		return activated.length > 0 ? { [A2A_EXTENSIONS_HEADER]: activated.join(", ") } : {};
	}
	/**
	* Abort a running task by control path (facade /a2a task cancel): abort the
	* executor's signal, settle the task CANCELED, and wake stream waiters.
	* @returns false when the task is unknown or already terminal.
	*/
	abort(taskId) {
		const record = this.opts.store.get(taskId);
		if (record === void 0 || isTerminal(record.state)) return false;
		this.running.get(taskId)?.abort();
		this.opts.store.setState(taskId, TaskState.CANCELED, {
			code: "canceled",
			text: "Task canceled"
		});
		this.emit(taskId, { statusUpdate: {
			taskId,
			contextId: record.contextId,
			status: statusOf(this.opts.store.get(taskId))
		} });
		this.settle(taskId);
		return true;
	}
	/** True when the request carries the configured bearer token. */
	authorized(req) {
		const token = this.opts.authToken;
		if (!token) return true;
		const header = req.headers?.["authorization"] ?? "";
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		if (match === null || match[1] === void 0) return false;
		const expected = createHash("sha256").update(token).digest();
		const provided = createHash("sha256").update(match[1]).digest();
		return timingSafeEqual(expected, provided);
	}
	/**
	* Check request-rate and bearer auth before an HTTP binding commits a 200/SSE
	* status. Returns the rejection response, or undefined when the request may
	* proceed. `handle`/`handleStream` call this themselves; the route layer
	* calls it before it writes SSE headers and then marks the stream as
	* preflighted so counters are not charged twice.
	*/
	preflight(req) {
		const limited = this.limit(req);
		if (limited !== void 0) return limited;
		if (!this.authorized(req)) {
			this.opts.metrics?.recordAuthFailure(this.opts.serverId, "unknown", sourceOf(req));
			return {
				status: 401,
				contentType: "application/json",
				body: JSON.stringify(rpcError(null, -32040, "Unauthorized")),
				headers: { "WWW-Authenticate": "Bearer" }
			};
		}
	}
	/**
	* The AgentCard to advertise for one request: the static card unless a
	* `cardForRequest` hook is configured (used by the `auto` base URL mode).
	* Routes that serve the card directly must go through this, not `.card`.
	*/
	cardFor(req) {
		return this.opts.cardForRequest?.(req) ?? this.card;
	}
	/** Route one inbound HTTP request (GET card, POST JSON-RPC). */
	async handle(req, body) {
		const path = (req.url ?? "").split("?")[0] ?? "";
		const card = this.cardFor(req);
		if (req.method === "GET" && path === this.cardPath()) return {
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(card),
			headers: { "A2A-Version": "1.0" }
		};
		if (req.method !== "POST" || path !== endpointOf(card)) return {
			status: 404,
			contentType: "text/plain",
			body: "Not Found"
		};
		const rejected = this.preflight(req);
		if (rejected !== void 0) return rejected;
		const version = requestedVersion(req);
		if (version !== void 0 && !sameProtocol(version)) return {
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(rpcError(null, A2A_ERROR_CODES.VERSION_NOT_SUPPORTED, `Unsupported A2A-Version ${version}; this endpoint implements 1.0`)),
			headers: { "A2A-Version": "1.0" }
		};
		const rpc = parseRpc(body);
		if (rpc === void 0) return {
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(rpcError(null, A2A_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC request")),
			headers: { "A2A-Version": "1.0" }
		};
		this.opts.metrics?.recordRequest(this.opts.serverId, rpc.method, sourceOf(req));
		const activated = this.activatedExtensions(req);
		const responseHeaders = {
			...this.responseHeaders(req),
			"A2A-Version": "1.0"
		};
		try {
			const result = await this.dispatch(rpc, activated);
			const source = sourceOf(req);
			this.opts.onInbound?.({
				method: rpc.method,
				...source !== void 0 ? { source } : {},
				taskIds: extractTaskIds(result),
				streaming: false
			});
			return {
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(rpcSuccess(rpc.id, result)),
				headers: responseHeaders
			};
		} catch (err) {
			const e = err;
			return {
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(rpcError(rpc.id, typeof e.code === "number" ? e.code : A2A_ERROR_CODES.INTERNAL_ERROR, e.message ?? String(err), e.data)),
				headers: responseHeaders
			};
		}
	}
	/**
	* Route one SSE request (SendStreamingMessage / SubscribeToTask). Frames are
	* pushed to `onEvent` as they happen; the caller must have checked
	* `authorized()` before writing 200 headers.
	*/
	async handleStream(req, body, onEvent, options = {}) {
		if (req.method !== "POST") {
			onEvent(formatError(null, 404, "Not Found"));
			return { status: 200 };
		}
		if (options.preflighted !== true) {
			const rejected = this.preflight(req);
			if (rejected !== void 0) return {
				status: rejected.status,
				...rejected.headers !== void 0 ? { headers: rejected.headers } : {}
			};
		}
		const rpc = parseRpc(body);
		if (rpc === void 0) {
			onEvent(formatError(null, A2A_ERROR_CODES.INVALID_REQUEST, "Invalid JSON-RPC request"));
			return { status: 200 };
		}
		const rpcId = rpc.id ?? null;
		const version = requestedVersion(req);
		if (version !== void 0 && !sameProtocol(version)) {
			onEvent(formatError(rpcId, A2A_ERROR_CODES.VERSION_NOT_SUPPORTED, `Unsupported A2A-Version ${version}; this endpoint implements 1.0`));
			return {
				status: 200,
				headers: { "A2A-Version": "1.0" }
			};
		}
		if (rpc.method !== A2A_METHODS.sendStreamingMessage && rpc.method !== A2A_METHODS.subscribeToTask) {
			onEvent(formatError(rpcId, A2A_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method ${rpc.method ?? ""}`));
			return { status: 200 };
		}
		this.opts.metrics?.recordRequest(this.opts.serverId, rpc.method, sourceOf(req));
		const params = rpc.params ?? {};
		const historyLength = typeof params.configuration?.historyLength === "number" ? params.configuration.historyLength : void 0;
		const trace = this.activatedExtensions(req).includes(TRACE_EXTENSION_URI);
		let record;
		let shouldRun = false;
		if (rpc.method === A2A_METHODS.sendStreamingMessage) try {
			if (params.message === void 0) {
				onEvent(formatError(rpcId, A2A_ERROR_CODES.INVALID_PARAMS, "Missing message"));
				return { status: 200 };
			}
			const configuration = params.configuration;
			if (!acceptsText(configuration?.acceptedOutputModes)) {
				onEvent(formatError(rpcId, A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED, "This agent produces text/plain output"));
				return { status: 200 };
			}
			const gateOutcome = await this.opts.gate(this.gateInputFor(params.message, this.remotePeerOf(req)));
			if (!gateOutcome.ok) {
				onEvent(formatError(rpcId, -32e3, gateOutcome.reason));
				return { status: 200 };
			}
			const ensured = this.ensureTask(params.message, this.remotePeerOf(req));
			record = ensured.record;
			shouldRun = !ensured.replay;
			this.noteInbound(req, rpc.method, [record.taskId], true);
		} catch (err) {
			const error = err;
			onEvent(formatError(rpcId, typeof error.code === "number" ? error.code : A2A_ERROR_CODES.INTERNAL_ERROR, error.message ?? String(err)));
			return { status: 200 };
		}
		else {
			const id = params.id;
			if (id === void 0) {
				onEvent(formatError(rpcId, A2A_ERROR_CODES.INVALID_PARAMS, "Missing task id"));
				return { status: 200 };
			}
			record = this.opts.store.get(id);
			this.noteInbound(req, rpc.method, id ? [id] : [], true);
			if (record === void 0) {
				onEvent(formatError(rpcId, A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`));
				return { status: 200 };
			}
			if (isTerminal(record.state)) {
				onEvent(formatError(rpcId, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${id} is already in terminal state ${record.state}`));
				return { status: 200 };
			}
		}
		const sub = (frame, eventId) => onEvent(formatResult(rpcId, frame, eventId));
		let listeners = this.listeners.get(record.taskId);
		if (listeners === void 0) {
			listeners = /* @__PURE__ */ new Set();
			this.listeners.set(record.taskId, listeners);
		}
		const replayCeiling = this.nextEventId - 1;
		listeners.add(sub);
		try {
			this.opts.onStreamOpen?.({
				taskId: record.taskId,
				contextId: record.contextId
			});
			const current = this.opts.store.get(record.taskId);
			if (current !== void 0) sub({ task: toTask(current, true, historyLength, true) });
			if (shouldRun) this.runTask(record, trace, historyLength);
			const lastEventId = parseEventId(req.headers?.["last-event-id"]);
			if (lastEventId !== void 0) this.replay(record.taskId, lastEventId, replayCeiling, sub);
			await this.waitTerminal(record.taskId);
			const finalRecord = this.opts.store.get(record.taskId);
			if (finalRecord !== void 0) sub({ task: toTask(finalRecord, true, historyLength, true) });
		} finally {
			listeners.delete(sub);
			if (listeners.size === 0) this.listeners.delete(record.taskId);
			this.opts.onStreamClose?.(record.taskId);
		}
		return {
			status: 200,
			headers: {
				"A2A-Version": "1.0",
				...this.responseHeaders(req)
			}
		};
	}
	/**
	* Submit one message from the dashboard test console (loopback admin path).
	* This is the same gate + task lifecycle as the wire endpoint, minus HTTP
	* auth, and is intentionally not exposed over the A2A endpoint.
	*/
	async sendTest(message) {
		const gateOutcome = await this.opts.gate(this.gateInputFor(message, null));
		if (!gateOutcome.ok) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, gateOutcome.reason);
		const ensured = this.ensureTask(message, null);
		if (!ensured.replay) await this.runTask(ensured.record, false);
		else await this.waitTerminal(ensured.record.taskId);
		return toTask(this.opts.store.get(ensured.record.taskId) ?? ensured.record, true, void 0, true);
	}
	/** Dispatch one JSON-RPC request; throws {code, message} on errors. */
	async dispatch(rpc, activated) {
		const method = rpc.method;
		const params = rpc.params ?? {};
		switch (method) {
			case A2A_METHODS.sendMessage: {
				const message = params["message"];
				if (message === void 0) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, "Missing message");
				const configuration = params["configuration"];
				if (!acceptsText(configuration?.acceptedOutputModes)) throw rpcFault(A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED, "This agent produces text/plain output");
				const gateOutcome = await this.opts.gate(this.gateInputFor(message, null));
				if (!gateOutcome.ok) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, gateOutcome.reason);
				const ensured = this.ensureTask(message, null);
				const trace = activated.includes(TRACE_EXTENSION_URI);
				if (!ensured.replay) {
					if (configuration?.returnImmediately === true) {
						this.runTask(ensured.record, trace, configuration.historyLength);
						return { task: toTask(this.opts.store.get(ensured.record.taskId) ?? ensured.record, true, configuration.historyLength, true) };
					}
					await this.runTask(ensured.record, trace, configuration?.historyLength);
				} else if (configuration?.returnImmediately !== true) await this.waitTerminal(ensured.record.taskId);
				return { task: toTask(this.opts.store.get(ensured.record.taskId) ?? ensured.record, true, configuration?.historyLength, true) };
			}
			case A2A_METHODS.getTask: {
				const id = params["id"];
				if (id === void 0) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, "Missing task id");
				const record = this.opts.store.get(id);
				if (record === void 0) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`);
				return toTask(record, true, typeof params["historyLength"] === "number" ? params["historyLength"] : void 0, true);
			}
			case A2A_METHODS.listTasks: return this.listTasks(params);
			case A2A_METHODS.cancelTask: {
				const id = params["id"];
				if (id === void 0) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, "Missing task id");
				const record = this.opts.store.get(id);
				if (record === void 0) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`);
				if (isTerminal(record.state)) throw rpcFault(A2A_ERROR_CODES.TASK_CANCEL_NOT_ALLOWED, `Task ${id} already in terminal state ${record.state}`);
				this.running.get(id)?.abort();
				this.opts.store.setState(id, TaskState.CANCELED, {
					code: "canceled",
					text: "Task canceled by caller"
				});
				this.emit(id, { statusUpdate: {
					taskId: id,
					contextId: record.contextId,
					status: statusOf(this.opts.store.get(id))
				} });
				this.settle(id);
				return toTask(this.opts.store.get(id));
			}
			case A2A_METHODS.getExtendedAgentCard: return this.card;
			case A2A_METHODS.createTaskPushNotificationConfig:
			case A2A_METHODS.getTaskPushNotificationConfig:
			case A2A_METHODS.listTaskPushNotificationConfigs:
			case A2A_METHODS.deleteTaskPushNotificationConfig: throw rpcFault(A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED, "Push notifications are not supported by this agent");
			default: throw rpcFault(A2A_ERROR_CODES.METHOD_NOT_FOUND, `Unknown method ${method}`);
		}
	}
	/**
	* Gate input for a message, using the existing task's context/skill when the
	* message is a continuation or idempotent replay. This prevents a follow-up
	* without `metadata.skill` from being checked against the wrong skill.
	*/
	gateInputFor(message, remotePeerId) {
		const task = message.taskId !== void 0 ? this.opts.store.get(message.taskId) : void 0;
		const replay = task === void 0 && typeof message.messageId === "string" && message.messageId.length > 0 ? this.opts.store.list().find((record) => record.messageIds?.includes(message.messageId) === true) : void 0;
		const existing = task ?? replay;
		return {
			contextId: existing?.contextId ?? message.contextId ?? "new",
			skill: existing?.skill ?? message.metadata?.["skill"] ?? "chat",
			parts: message.parts,
			remotePeerId
		};
	}
	/**
	* Bind one message to a task. A message with a `taskId` continues that task
	* (or returns it for an idempotent `messageId` replay); a messageId seen
	* before returns its original task. A task id outside this instance's scope
	* is indistinguishable from a missing task because the store is scoped.
	*/
	ensureTask(message, remotePeerId) {
		const serverId = this.opts.serverId;
		const messageId = typeof message.messageId === "string" && message.messageId.length > 0 ? message.messageId : void 0;
		if (message.taskId !== void 0) {
			const existing = this.opts.store.get(message.taskId);
			if (existing === void 0) throw rpcFault(A2A_ERROR_CODES.TASK_NOT_FOUND, `Task ${message.taskId} not found`);
			if (message.contextId !== void 0 && message.contextId !== existing.contextId) throw rpcFault(A2A_ERROR_CODES.INVALID_PARAMS, `contextId ${message.contextId} does not match task ${existing.taskId}`);
			if (messageId !== void 0 && existing.messageIds?.includes(messageId) === true) return {
				record: existing,
				replay: true,
				created: false,
				continuation: false
			};
			if (isTerminal(existing.state)) throw rpcFault(A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${existing.taskId} is already in terminal state ${existing.state}`);
			if (this.running.has(existing.taskId)) throw rpcFault(A2A_ERROR_CODES.UNSUPPORTED_OPERATION, `Task ${existing.taskId} is still running; wait for it to settle or cancel it before continuing`);
			this.opts.store.appendInput(existing.taskId, message);
			const updated = this.opts.store.setParts(existing.taskId, message.parts);
			return {
				record: messageId !== void 0 ? this.opts.store.appendMessageId(existing.taskId, messageId) : updated,
				replay: false,
				created: false,
				continuation: true
			};
		}
		if (messageId !== void 0) {
			const replay = this.opts.store.list().find((record) => record.messageIds?.includes(messageId) === true);
			if (replay !== void 0) return {
				record: replay,
				replay: true,
				created: false,
				continuation: false
			};
		}
		const contextId = message.contextId ?? crypto.randomUUID();
		const skill = message.metadata?.["skill"] ?? "chat";
		const record = this.opts.store.create({
			contextId,
			skill,
			parts: message.parts,
			remotePeerId,
			...serverId !== void 0 ? { serverId } : {},
			...messageId !== void 0 ? { messageId } : {},
			message: {
				...message,
				contextId
			}
		});
		this.opts.metrics?.recordTaskCreated(serverId, record.taskId);
		this.opts.onTaskCreated?.(record.taskId);
		return {
			record,
			replay: false,
			created: true,
			continuation: false
		};
	}
	/** Run one task to a terminal or interrupted state, emitting status/artifact frames. */
	async runTask(record, trace = false, historyLength) {
		if (this.running.has(record.taskId)) return;
		if (this.opts.maxConcurrentTasks !== void 0 && this.opts.maxConcurrentTasks > 0 && this.running.size >= this.opts.maxConcurrentTasks) {
			this.opts.store.setState(record.taskId, TaskState.FAILED, {
				code: "quota",
				text: "Inbound task concurrency quota exceeded"
			});
			const failed = this.opts.store.get(record.taskId);
			if (failed !== void 0) this.emit(record.taskId, { task: toTask(failed, true, historyLength, true) });
			this.opts.metrics?.recordTaskSettled(this.opts.serverId, record.taskId, TaskState.FAILED, 0);
			this.settle(record.taskId);
			this.opts.onTaskSettled?.(record.taskId);
			return;
		}
		const controller = new AbortController();
		this.running.set(record.taskId, controller);
		const startedAt = Date.now();
		let timedOut = false;
		let timer;
		this.opts.store.setState(record.taskId, TaskState.WORKING);
		this.emit(record.taskId, { statusUpdate: {
			taskId: record.taskId,
			contextId: record.contextId,
			status: statusOf(this.opts.store.get(record.taskId))
		} });
		const onEvent = this.eventSink(record.taskId, record.contextId, trace);
		try {
			const races = [this.opts.executors.resolve(record.skill).execute({
				taskId: record.taskId,
				contextId: record.contextId,
				skill: record.skill,
				parts: record.parts,
				prompt: partsToText$1(record.parts),
				signal: controller.signal,
				...trace ? { trace: true } : {}
			}, { onEvent })];
			races.push(new Promise((_, reject) => {
				if (controller.signal.aborted) reject(new TaskAborted());
				else controller.signal.addEventListener("abort", () => reject(new TaskAborted()), { once: true });
			}));
			if (this.opts.taskTimeoutMs !== void 0 && this.opts.taskTimeoutMs > 0) {
				const timeout = this.opts.taskTimeoutMs;
				races.push(new Promise((_, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						controller.abort();
						reject(new TaskTimeout(timeout));
					}, timeout);
					timer.unref?.();
				}));
			}
			const output = await Promise.race(races);
			const settled = this.opts.store.get(record.taskId);
			if (settled === void 0 || settled.state === TaskState.CANCELED) return;
			if (output.parts.length > 0 && output.appendResult !== false) onEvent({
				type: "artifact",
				artifactId: "result",
				parts: output.parts,
				append: false,
				lastChunk: true
			});
			const current = this.opts.store.get(record.taskId);
			if (current === void 0) return;
			if (output.state !== void 0) this.opts.store.setState(record.taskId, output.state, {
				code: output.state === TaskState.INPUT_REQUIRED ? "input_required" : "auth_required",
				text: output.statusMessage ?? (output.state === TaskState.INPUT_REQUIRED ? "Additional input required" : "Authentication required")
			});
			else if (INTERRUPTED_STATES.has(current.state)) {} else {
				if (output.statusMessage !== void 0 && output.statusMessage.length > 0) this.opts.store.setStatusText(record.taskId, output.statusMessage);
				this.opts.store.setState(record.taskId, TaskState.COMPLETED);
			}
		} catch (err) {
			const settled = this.opts.store.get(record.taskId);
			if (settled !== void 0 && settled.state === TaskState.CANCELED) {} else if (timedOut) this.opts.store.setState(record.taskId, TaskState.FAILED, {
				code: "timeout",
				text: `Task exceeded its ${this.opts.taskTimeoutMs ?? 0}ms execution budget`
			});
			else this.opts.store.setState(record.taskId, TaskState.FAILED, {
				code: "executor",
				text: err.message
			});
		} finally {
			if (timer !== void 0) clearTimeout(timer);
			this.running.delete(record.taskId);
			const terminal = this.opts.store.get(record.taskId);
			if (terminal !== void 0) {
				this.emit(record.taskId, { task: toTask(terminal, true, historyLength, true) });
				this.opts.metrics?.recordTaskSettled(this.opts.serverId, record.taskId, terminal.state, Date.now() - startedAt);
			}
			this.settle(record.taskId);
			this.opts.onTaskSettled?.(record.taskId);
		}
	}
	/** Build the event sink that folds executor events into store + frames. */
	eventSink(taskId, contextId, trace) {
		return (ev) => {
			const current = this.opts.store.get(taskId);
			if (current === void 0 || isTerminal(current.state)) return;
			if (ev.type === "status") {
				this.opts.store.setState(taskId, ev.state);
				this.emit(taskId, { statusUpdate: {
					taskId,
					contextId,
					status: statusOf(this.opts.store.get(taskId))
				} });
			} else if (ev.type === "trace") {
				if (!trace) return;
				const record = this.opts.store.appendTrace(taskId, ev.call);
				this.emit(taskId, { statusUpdate: {
					taskId,
					contextId,
					status: statusOf(record),
					metadata: { [TRACE_EXTENSION_URI]: { event: ev.call } }
				} });
			} else if (ev.artifactId !== void 0 && ev.parts !== void 0) {
				const artifact = this.opts.store.appendArtifact(taskId, {
					artifactId: ev.artifactId,
					...ev.name !== void 0 ? { name: ev.name } : {},
					parts: ev.parts,
					...ev.append !== void 0 ? { append: ev.append } : {},
					...ev.lastChunk !== void 0 ? { lastChunk: ev.lastChunk } : {}
				}).artifacts.find((a) => a.artifactId === ev.artifactId);
				if (artifact !== void 0) this.emit(taskId, { artifactUpdate: {
					taskId,
					contextId,
					artifact: {
						artifactId: artifact.artifactId,
						...artifact.name !== void 0 ? { name: artifact.name } : {},
						parts: ev.append === true ? ev.parts : artifact.parts
					},
					...ev.append !== void 0 ? { append: ev.append } : {},
					...ev.lastChunk !== void 0 ? { lastChunk: ev.lastChunk } : {}
				} });
			}
		};
	}
	/** Assign an SSE event id, retain it for reconnect replay, and broadcast it. */
	emit(taskId, frame) {
		const id = this.nextEventId++;
		let log = this.eventLogs.get(taskId);
		if (log === void 0) {
			log = [];
			this.eventLogs.set(taskId, log);
			if (this.eventLogs.size > 1e3) {
				const oldest = this.eventLogs.keys().next().value;
				if (oldest !== void 0 && oldest !== taskId) this.eventLogs.delete(oldest);
			}
		}
		log.push({
			id,
			frame
		});
		if (log.length > this.maxEventLog) log.splice(0, log.length - this.maxEventLog);
		for (const listener of this.listeners.get(taskId) ?? []) listener(frame, id);
	}
	replay(taskId, lastEventId, ceiling, sub) {
		const log = this.eventLogs.get(taskId) ?? [];
		let replayed = false;
		for (const event of log) {
			if (event.id <= lastEventId || event.id > ceiling || "artifactUpdate" in event.frame) continue;
			sub(event.frame, event.id);
			replayed = true;
		}
		return replayed;
	}
	noteInbound(req, method, taskIds, streaming) {
		const source = sourceOf(req);
		this.opts.onInbound?.({
			method,
			...source !== void 0 ? { source } : {},
			taskIds,
			streaming
		});
	}
	remotePeerOf(req) {
		const source = sourceOf(req);
		return source ? hashOf(source) : null;
	}
	/** Apply the per-instance request limiter. */
	limit(req) {
		if (this.limiter === void 0) return void 0;
		const key = addressOf(req);
		const decision = this.limiter.allow(key);
		if (decision.ok) return void 0;
		return {
			status: 429,
			contentType: "application/json",
			body: JSON.stringify(rpcError(null, -32e3, "Rate limit exceeded")),
			headers: { "Retry-After": String(Math.ceil(decision.retryAfterMs / 1e3)) }
		};
	}
	async waitTerminal(taskId) {
		const current = this.opts.store.get(taskId);
		if (current !== void 0 && (isTerminal(current.state) || INTERRUPTED_STATES.has(current.state))) return;
		await new Promise((resolve) => {
			let waiters = this.waiters.get(taskId);
			if (waiters === void 0) {
				waiters = /* @__PURE__ */ new Set();
				this.waiters.set(taskId, waiters);
			}
			waiters.add(resolve);
		});
	}
	settle(taskId) {
		const waiters = this.waiters.get(taskId);
		if (waiters === void 0) return;
		this.waiters.delete(taskId);
		for (const waiter of waiters) waiter();
	}
	/** Filter, sort, and cursor-page tasks for the spec ListTasks method. */
	listTasks(params) {
		const contextId = typeof params["contextId"] === "string" ? params["contextId"] : void 0;
		const status = params["status"];
		const accepted = new Set(Array.isArray(status) ? status.filter((s) => typeof s === "string") : typeof status === "string" ? [status] : []);
		const after = typeof params["statusTimestampAfter"] === "string" ? params["statusTimestampAfter"] : void 0;
		const includeArtifacts = params["includeArtifacts"] === true;
		const historyLength = typeof params["historyLength"] === "number" ? params["historyLength"] : void 0;
		const pageSizeRaw = typeof params["pageSize"] === "number" ? params["pageSize"] : 50;
		const pageSize = Math.max(1, Math.min(100, Math.floor(pageSizeRaw)));
		const offset = decodePageToken(params["pageToken"]);
		const filtered = this.opts.store.list().filter((record) => contextId === void 0 || record.contextId === contextId).filter((record) => accepted.size === 0 || accepted.has(record.state)).filter((record) => after === void 0 || record.updatedAt >= after).sort((a, b) => a.updatedAt === b.updatedAt ? a.taskId < b.taskId ? 1 : -1 : a.updatedAt < b.updatedAt ? 1 : -1);
		return {
			tasks: filtered.slice(offset, offset + pageSize).map((record) => toTask(record, includeArtifacts, historyLength, true)),
			nextPageToken: offset + pageSize < filtered.length ? encodePageToken(offset + pageSize) : "",
			pageSize,
			totalSize: filtered.length
		};
	}
};
var TaskAborted = class extends Error {
	constructor() {
		super("a2a: task aborted");
		this.name = "TaskAborted";
	}
};
var TaskTimeout = class extends Error {
	timeoutMs;
	constructor(timeoutMs) {
		super(`a2a: task exceeded ${timeoutMs}ms`);
		this.timeoutMs = timeoutMs;
		this.name = "TaskTimeout";
	}
};
/** Read the JSON-RPC endpoint path off the card's first interface. */
function endpointOf(card) {
	const url = card.supportedInterfaces?.[0]?.url;
	if (!url) return "/a2a";
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}
function sourceOf(req) {
	const s = req.socket;
	if (!s?.remoteAddress) return void 0;
	return `${s.remoteAddress}:${s.remotePort ?? ""}`;
}
/** Case-tolerant header lookup for structural requests and Node's lowercase map. */
function headerValue(req, name) {
	const headers = req.headers;
	if (headers === void 0) return void 0;
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === lower && typeof value === "string") return value;
}
/** Rate-limit key: one client address, not one TCP connection. */
function addressOf(req) {
	return req.socket?.remoteAddress ?? "unknown";
}
/** A2A-Version from the header or the HTTP query parameter, if supplied. */
function sameProtocol(version) {
	return version.split(".").slice(0, 2).join(".") === "1.0";
}
function requestedVersion(req) {
	const header = req.headers?.["a2a-version"] ?? req.headers?.["A2A-Version"];
	if (header !== void 0 && header.trim().length > 0) return header.trim();
	try {
		const url = new URL(req.url ?? "", "http://127.0.0.1");
		const query = url.searchParams.get("A2A-Version") ?? url.searchParams.get("a2a-version");
		return query !== null && query.trim().length > 0 ? query.trim() : void 0;
	} catch {
		return;
	}
}
/** One JSON-RPC result SSE frame. */
function formatResult(id, frame, eventId) {
	return `${eventId !== void 0 ? `id: ${eventId}\n` : ""}data: ${JSON.stringify({
		jsonrpc: "2.0",
		id,
		result: frame
	})}\n\n`;
}
/** One JSON-RPC error SSE frame (same envelope as the non-streaming binding). */
function formatError(id, code, message, data) {
	return `data: ${JSON.stringify({
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message,
			...data !== void 0 ? { data } : {}
		}
	})}\n\n`;
}
function hashOf(value) {
	let h = 0;
	for (let i = 0; i < value.length; i++) h = h * 31 + value.charCodeAt(i) >>> 0;
	return `peer-${h.toString(16)}`;
}
function acceptsText(modes) {
	if (modes === void 0 || modes.length === 0) return true;
	return modes.some((mode) => mode === "*/*" || mode === "text/*" || mode === "text/plain" || mode.startsWith("text/"));
}
function rpcFault(code, message) {
	return {
		code,
		message
	};
}
function statusOf(record) {
	const text = record.error?.message ?? record.statusText;
	return {
		state: record.state,
		timestamp: record.updatedAt,
		...text !== void 0 ? { message: {
			messageId: `a2a-status-${record.taskId}`,
			role: Role.AGENT,
			parts: [{ text }],
			...record.error === void 0 ? { metadata: { reason: "no-visible-output" } } : {}
		} } : {}
	};
}
function toTask(record, includeArtifacts = true, historyLength, includeHistory = false) {
	const history = includeHistory ? taskHistory(record, historyLength) : void 0;
	return {
		id: record.taskId,
		contextId: record.contextId,
		status: statusOf(record),
		...includeArtifacts ? { artifacts: record.artifacts } : {},
		...history !== void 0 && history.length > 0 ? { history } : {},
		metadata: {
			skill: record.skill,
			...record.serverId !== void 0 ? { serverId: record.serverId } : {},
			...record.trace !== void 0 ? { [TRACE_EXTENSION_URI]: record.trace } : {}
		}
	};
}
/** Best-effort history from the durable task inputs and visible output. */
function taskHistory(record, historyLength) {
	const messages = [];
	if (record.inputs !== void 0 && record.inputs.length > 0) messages.push(...record.inputs);
	else if (record.parts.length > 0) messages.push({
		messageId: record.messageIds?.at(-1) ?? `a2a-input-${record.taskId}`,
		...record.contextId !== void 0 ? { contextId: record.contextId } : {},
		taskId: record.taskId,
		role: Role.USER,
		parts: record.parts
	});
	const output = resultTextOf(record.artifacts);
	const statusText = record.error?.message ?? record.statusText;
	if (output.length > 0 || statusText !== void 0) messages.push({
		messageId: `a2a-output-${record.taskId}`,
		...record.contextId !== void 0 ? { contextId: record.contextId } : {},
		taskId: record.taskId,
		role: Role.AGENT,
		parts: output.length > 0 ? [{ text: output }] : [{ text: statusText ?? "" }],
		...output.length === 0 && statusText !== void 0 ? { metadata: { reason: "no-visible-output" } } : {}
	});
	if (historyLength === void 0) return messages;
	if (historyLength <= 0) return [];
	return messages.slice(-historyLength);
}
/** Visible delivery text: only the designated `result` artifact, text parts only. */
function resultTextOf(artifacts) {
	return artifacts.filter((artifact) => artifact.artifactId === "result").flatMap((artifact) => artifact.parts).map((part) => "text" in part && typeof part.text === "string" ? part.text : "").filter((text) => text.length > 0).join("\n").trim();
}
function extractTaskIds(result) {
	if (result === null || typeof result !== "object") return [];
	const value = result;
	if (typeof value.id === "string") return [value.id];
	if (typeof value.task?.id === "string") return [value.task.id];
	if (Array.isArray(value.tasks)) return value.tasks.map((t) => t.id).filter((id) => typeof id === "string");
	if (Array.isArray(result)) return result.map((t) => t.id).filter((id) => typeof id === "string");
	return [];
}
function parseEventId(raw) {
	if (raw === void 0) return void 0;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : void 0;
}
function encodePageToken(offset) {
	return Buffer.from(String(offset), "utf8").toString("base64url");
}
function decodePageToken(raw) {
	if (typeof raw !== "string" || raw.length === 0) return 0;
	try {
		const offset = Number.parseInt(Buffer.from(raw, "base64url").toString("utf8"), 10);
		return Number.isFinite(offset) && offset >= 0 ? offset : 0;
	} catch {
		return 0;
	}
}
//#endregion
//#region lib/types/server/routes.js
/**
* HTTP binding for the inbound server: registers the AgentCard route and the
* JSON-RPC / SSE endpoint on a structural webServer (normally
* `@deepseek-ai/dsh-host-webserver`), with runtime enable/disable.
* @module dsh-a2a/server/routes
*/
const DEFAULT_CARD_PATH = "/.well-known/agent-card.json";
/** Runtime-registered HTTP routes for one A2A server. */
var A2aRoutes = class {
	webServer;
	server;
	cardPath;
	maxBodyBytes;
	disposers = [];
	registered = false;
	constructor(webServer, server, cardPath = DEFAULT_CARD_PATH, maxBodyBytes = 1048576) {
		this.webServer = webServer;
		this.server = server;
		this.cardPath = cardPath;
		this.maxBodyBytes = maxBodyBytes;
	}
	get active() {
		return this.registered;
	}
	/** Register the AgentCard + endpoint routes (idempotent). */
	enable() {
		if (this.registered) return;
		this.disposers.push(this.webServer.register({
			kind: "exact",
			path: this.cardPath,
			handler: (req, res) => {
				res.writeHead(200, {
					"content-type": "application/json",
					"a2a-version": "1.0"
				});
				res.end(JSON.stringify(this.server.cardFor(toServerReq(req))));
			}
		}));
		this.disposers.push(this.webServer.register({
			kind: "prefix",
			path: endpointPathOf(this.server),
			handler: (req, res) => this.onRequest(req, res)
		}));
		this.registered = true;
	}
	/** Unregister the routes (idempotent). */
	disable() {
		for (const disposer of this.disposers.splice(0)) disposer();
		this.registered = false;
	}
	dispose() {
		this.disable();
	}
	async onRequest(req, res) {
		const path = (req.url ?? "").split("?")[0] ?? "";
		const streaming = req.method === "POST" && (req.headers.accept ?? "").includes("text/event-stream");
		if (req.method === "POST" && path === endpointPathOf(this.server)) {
			let body;
			try {
				body = await readBody(req, this.maxBodyBytes);
			} catch (err) {
				const tooLarge = err.code === "BODY_TOO_LARGE";
				res.writeHead(tooLarge ? 413 : 400, { "content-type": "text/plain" });
				res.end(tooLarge ? "Payload Too Large" : "Bad Request");
				return;
			}
			if (streaming) {
				const preflight = this.server.preflight(toServerReq(req));
				if (preflight !== void 0) {
					res.writeHead(preflight.status, {
						"content-type": preflight.contentType,
						...preflight.headers ?? {}
					});
					res.end(preflight.body);
					return;
				}
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
					"x-accel-buffering": "no",
					"a2a-version": "1.0",
					...this.server.responseHeaders(toServerReq(req))
				});
				if ((await this.server.handleStream(toServerReq(req), body, (frame) => res.write(frame), { preflighted: true })).status !== 200) {
					res.end();
					return;
				}
				res.end();
				return;
			}
			const out = await this.server.handle(toServerReq(req), body);
			res.writeHead(out.status, {
				"content-type": out.contentType,
				...out.headers ?? {}
			});
			res.end(out.body);
			return;
		}
		const out = await this.server.handle(toServerReq(req), path === this.cardPath ? "" : "");
		res.writeHead(out.status, {
			"content-type": out.contentType,
			...out.headers ?? {}
		});
		res.end(out.body);
	}
};
function endpointPathOf(server) {
	const url = server.card.supportedInterfaces?.[0]?.url;
	if (!url) return "/a2a";
	try {
		return new URL(url).pathname;
	} catch {
		return "/a2a";
	}
}
function readBody(req, maxBytes) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.byteLength;
			if (size > maxBytes) {
				const error = /* @__PURE__ */ new Error("request body too large");
				error.code = "BODY_TOO_LARGE";
				req.resume();
				reject(error);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.once("error", reject);
	});
}
function toServerReq(req) {
	const headers = {};
	for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers[key] = value;
	else if (Array.isArray(value)) headers[key] = value.join(", ");
	const method = req.method;
	const url = req.url;
	const socket = req.socket;
	return {
		...method !== void 0 ? { method } : {},
		...url !== void 0 ? { url } : {},
		headers,
		...socket ? { socket: {
			...socket.remoteAddress !== void 0 ? { remoteAddress: socket.remoteAddress } : {},
			...socket.remotePort !== void 0 ? { remotePort: socket.remotePort } : {}
		} } : {}
	};
}
//#endregion
//#region lib/types/server/exec/session.js
/**
* The `session` executor: one inbound task is one turn on the context's DSH
* agent session; reply text becomes the task's output part. Live assistant
* text deltas are projected as `result` artifact chunks so
* SendStreamingMessage carries real progress before the terminal task. Tool
* lifecycle is exposed only through the opt-in trace metadata channel; it is
* never modelled as an artifact.
* @module dsh-a2a/server/exec/session
*/
/** Build the session executor over a context session pool. */
function createSessionExecutor(pool) {
	return {
		name: "session",
		async execute(input, execCtx) {
			if (input.parts.length === 0) return { parts: [{ text: "No prompt provided." }] };
			let streamed = false;
			const reply = await pool.runTurn(input.contextId, input.parts, input.signal, {
				onEvent: (event) => {
					if (event.type === "text-delta") {
						streamed = true;
						execCtx.onEvent({
							type: "artifact",
							artifactId: "result",
							parts: [{ text: event.text }],
							append: true,
							lastChunk: false
						});
					}
				},
				...input.trace === true ? { onTrace: (call) => execCtx.onEvent({
					type: "trace",
					call
				}) } : {}
			});
			if (streamed) {
				execCtx.onEvent({
					type: "artifact",
					artifactId: "result",
					parts: [],
					append: true,
					lastChunk: true
				});
				return {
					parts: [],
					appendResult: false
				};
			}
			if (input.signal.aborted) return { parts: [{ text: "(canceled)" }] };
			if (reply.length === 0) return {
				parts: [],
				appendResult: false,
				statusMessage: "The agent completed without visible output."
			};
			return { parts: [{ text: reply }] };
		},
		disposeAll: () => pool.disposeAll()
	};
}
//#endregion
//#region lib/types/server/exec/subagent.js
/**
* The `subagent` executor: one inbound task is delegated to a named one-shot
* subagent under the context's parent session. The child runs with the
* composition's own tools and the delegation boundary; its output becomes the
* task's artifact. The subagent seam must be mounted, else the skill binding
* fails loudly at resolution time.
* @module dsh-a2a/server/exec/subagent
*/
/** Build a subagent executor delegating inbound tasks to one-shot children. */
function createSubagentExecutor(opts) {
	const { pool, subagents, provider } = opts;
	return {
		name: "subagent",
		async execute(input, execCtx) {
			if (input.parts.length === 0) return { parts: [{ text: "No prompt provided." }] };
			const { agent } = await pool.agentFor(input.contextId);
			const prompt = await pool.contentBlocks(input.parts);
			const text = (await (await subagents.start(provider, {
				label: `a2a:${input.skill}`,
				prompt,
				parent: agent,
				signal: input.signal
			})).result).output.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).filter(Boolean).join("\n").trim();
			if (text.length === 0) return {
				parts: [],
				appendResult: false,
				statusMessage: "The agent completed without visible output."
			};
			execCtx.onEvent({
				type: "artifact",
				artifactId: "result",
				parts: [{ text }],
				name: input.skill,
				lastChunk: true
			});
			return {
				parts: [{ text }],
				appendResult: false
			};
		},
		disposeAll: () => pool.disposeAll()
	};
}
//#endregion
//#region lib/types/server/executor.js
/**
* Executor abstraction for inbound tasks: an executor turns one task into
* output parts while reporting status and artifact updates. The registry is
* INTERNAL (built by the plugin from config) — public registration was cut:
* there is no external caller yet, so the seam stays an interface with two
* built-in implementations (session, subagent).
* @module dsh-a2a/server/executor
*/
/**
* Skill → executor resolution. The subagent executor is absent on
* compositions without the subagent seam; resolving a skill bound to a
* missing kind fails loudly with a readable message.
*/
var ExecutorSet = class {
	bySkill;
	session;
	subagent;
	constructor(bySkill, session, subagent) {
		this.bySkill = bySkill;
		this.session = session;
		this.subagent = subagent;
	}
	resolve(skill) {
		if ((this.bySkill[skill] ?? "session") === "session") return this.session;
		const subagent = this.subagent;
		if (subagent === void 0) throw new Error(`a2a: skill "${skill}" is bound to the subagent executor but no subagent seam is mounted`);
		return subagent;
	}
	async disposeAll() {
		await this.session.disposeAll?.();
		await this.subagent?.disposeAll?.();
	}
};
//#endregion
//#region lib/types/server/inbound-registry.js
/**
* Inbound connection registry: which remote peers are talking to this DSH's
* A2A server. Fed by the A2A server's `onInbound` hook (every JSON-RPC
* request / SSE open), surfaced through the dashboard API, and disconnectable
* (`closePeer` cancels the peer's active tasks and drops the record).
* @module dsh-a2a/server/inbound-registry
*/
function newPeerId() {
	return `peer-${crypto.randomUUID()}`;
}
/** In-memory inbound peer registry. */
var LiveInboundRegistry = class {
	peers = /* @__PURE__ */ new Map();
	findBySource(source) {
		if (source === null) return void 0;
		for (const peer of this.peers.values()) if (peer.source === source) return peer;
	}
	/** Observe one inbound event: method, source, task ids, streaming flag. */
	note(input) {
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const source = input.source ?? null;
		let peer = this.findBySource(source);
		if (peer === void 0) {
			peer = {
				id: newPeerId(),
				label: source ?? "unknown",
				source,
				firstSeen: now,
				lastSeen: now,
				taskCount: 0,
				active: /* @__PURE__ */ new Set(),
				streamingCount: 0
			};
			this.peers.set(peer.id, peer);
		}
		peer.lastSeen = now;
		peer.taskCount += input.taskIds.length;
		for (const id of input.taskIds) peer.active.add(id);
		if (input.streaming) peer.streamingCount += 1;
	}
	/** A task settled: drop it from every peer's active set. */
	settle(taskId) {
		for (const peer of this.peers.values()) if (peer.active.delete(taskId)) peer.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
	}
	/** Decrement streaming count when an SSE connection closes. */
	endStream(source) {
		const peer = this.findBySource(source ?? null);
		if (peer !== void 0 && peer.streamingCount > 0) {
			peer.streamingCount -= 1;
			peer.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
		}
	}
	list() {
		return [...this.peers.values()].map((p) => ({
			id: p.id,
			label: p.label,
			source: p.source,
			firstSeen: p.firstSeen,
			lastSeen: p.lastSeen,
			taskCount: p.taskCount,
			activeTaskIds: [...p.active],
			streaming: p.streamingCount > 0
		})).sort((a, b) => a.lastSeen < b.lastSeen ? 1 : -1);
	}
	closePeer(peerId) {
		const peer = this.peers.get(peerId);
		if (peer === void 0) return {
			ok: false,
			message: `inbound peer ${peerId} not found`
		};
		this.peers.delete(peerId);
		return {
			ok: true,
			message: `inbound peer ${peer.label} closed`
		};
	}
	activeTasksOf(peerId) {
		return [...this.peers.get(peerId)?.active ?? []];
	}
};
//#endregion
//#region lib/types/servers/inbound-manager.js
/**
* Inbound server manager: owns every inbound A2A server instance. Each
* instance binds one concrete agent preset (its session pool is composed from
* that preset) and serves its own endpoint and AgentCard route. Instances are
* persisted in the `inbound_servers` domain table and assembled on boot; the
* manager owns route registration and the full lifecycle
* (add/enable/disable/update/remove) driven from the GUI and facade, and
* disposes every instance's environment on teardown.
*
* Skill declaration is DERIVED, never typed: "the preset decides its skills;
* everything is a plugin." An instance's AgentCard skills are the
* model-invocable entries of its preset's skill directory — the preset's
* standing scope key (`agentPresets.standingKeyFor`) plus
* `ctx.skills.list({ scope })` — resolved automatically at add/update/boot
* and cached on the live instance; the creator types no skill text. A missing
* skills service or standing mount falls back to a built-in `chat` skill so
* minimal compositions stay exercisable.
* @module dsh-a2a/servers/inbound-manager
*/
/** Effective per-instance working directory: record override, else deployment default. */
function resolveInstanceCwd(record, deploymentCwd) {
	return record.workspace ?? deploymentCwd;
}
/** Validate an optional per-instance workspace override (absolute + existing dir). */
function validateWorkspace(raw) {
	if (raw === void 0) return { ok: true };
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { ok: true };
	if (!isAbsolute(trimmed)) return {
		ok: false,
		message: `workspace must be an absolute path: ${trimmed}`
	};
	try {
		if (!statSync(trimmed).isDirectory()) return {
			ok: false,
			message: `workspace is not a directory: ${trimmed}`
		};
	} catch {
		return {
			ok: false,
			message: `workspace does not exist: ${trimmed}`
		};
	}
	return {
		ok: true,
		value: trimmed
	};
}
/**
* Validate an optional per-instance advertised base URL. The value must be an
* absolute `http(s)` URL; a trailing slash is trimmed so card URLs join paths
* consistently. Blank = inherit the deployment base URL.
*/
function validateBaseUrl(raw) {
	const trimmed = trimOptional(raw);
	if (trimmed === void 0) return { ok: true };
	if (trimmed.toLowerCase() === "auto") return {
		ok: true,
		value: "auto"
	};
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		return {
			ok: false,
			message: `baseUrl must be an absolute URL: ${trimmed}`
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return {
		ok: false,
		message: `baseUrl must use http or https: ${trimmed}`
	};
	return {
		ok: true,
		value: trimmed.replace(/\/$/, "")
	};
}
/** Per-instance advertised base URL, or the deployment default. */
function resolveInstanceBaseUrl(record, deploymentBaseUrl) {
	return record.baseUrl ?? deploymentBaseUrl;
}
/** Resolve the host's base-URL source (a getter lets the GUI retune it). */
function deploymentBaseUrlOf(host) {
	return typeof host.defaultBaseUrl === "function" ? host.defaultBaseUrl() : host.defaultBaseUrl;
}
/** Case-insensitive header lookup on the structural request shape. */
function requestHeader(req, name) {
	const headers = req.headers;
	if (headers === void 0) return void 0;
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === lower && typeof value === "string") return value;
}
/**
* Derive the externally visible origin from a request (`auto` advertised base
* URL mode): `X-Forwarded-Host`/`Host` for the authority, `X-Forwarded-Proto`
* for the scheme. Returns undefined when the request carries no usable host.
*/
function deriveBaseUrlFromRequest(req) {
	const host = (requestHeader(req, "x-forwarded-host") ?? requestHeader(req, "host"))?.split(",")[0]?.trim();
	if (host === void 0 || host.length === 0) return void 0;
	return `${requestHeader(req, "x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https" ? "https" : "http"}://${host}`;
}
/** Trim an optional text override; blank collapses to undefined. */
function trimOptional(raw) {
	if (raw === void 0) return void 0;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/** Global tool names accepted in a per-instance allow-list. */
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const MAX_TOOL_ALLOW = 200;
/** Validate an optional per-instance tool allow-list. */
function validateToolAllow(raw) {
	if (raw === void 0) return { ok: true };
	const seen = /* @__PURE__ */ new Set();
	for (const item of raw) {
		if (typeof item !== "string") return {
			ok: false,
			message: "toolAllow must be a list of tool names"
		};
		const name = item.trim();
		if (name.length === 0) continue;
		if (!TOOL_NAME_RE.test(name)) return {
			ok: false,
			message: `invalid tool name: ${name}`
		};
		seen.add(name);
	}
	if (seen.size > MAX_TOOL_ALLOW) return {
		ok: false,
		message: `toolAllow holds at most ${MAX_TOOL_ALLOW} names`
	};
	return {
		ok: true,
		...seen.size > 0 ? { value: [...seen] } : {}
	};
}
/** Per-instance tool restriction, or undefined when the instance keeps every tool. */
function buildToolRestriction(record) {
	const allow = record.toolAllow;
	if (allow === void 0 || allow.length === 0) return void 0;
	return { allow };
}
/** Per-instance model override, or undefined when the instance inherits the default. */
function buildModelOverride(record) {
	const provider = trimOptional(record.provider);
	const model = trimOptional(record.model);
	if (provider === void 0 && model === void 0) return void 0;
	return {
		...provider !== void 0 ? { provider } : {},
		...model !== void 0 ? { model } : {}
	};
}
function refuseExecutor(reason) {
	return {
		name: "refuse",
		async execute() {
			throw new Error(`a2a: ${reason}; refusing inbound task`);
		}
	};
}
/** Built-in fallback skill when no skills service / standing mount exists. */
function chatFallbackSkills() {
	return [{
		id: "chat",
		name: "chat",
		description: "Conversational assistance over a DSH agent session.",
		tags: ["chat"]
	}];
}
/**
* Derive an instance's AgentCard skills from its preset's skill directory.
*
* `agentPresets.standingKeyFor(preset)` yields the preset's standing scope
* key (no agent required); `ctx.skills.list({ scope })` returns the catalogue
* that preset agent actually sees (its layer + the deployment global). Only
* model-invocable entries are advertised, mapped to `AgentSkill` (id = name,
* name = name). Any missing service, failed mount, or empty catalogue falls
* back to the built-in `chat` skill.
*
* @param agentPresets - the preset roster, or undefined.
* @param skills - the skill registry, or undefined.
* @param preset - the instance's preset id; undefined = deployment default.
*/
async function derivePresetSkills(agentPresets, skills, preset) {
	if (agentPresets?.standingKeyFor === void 0 || skills === void 0) return chatFallbackSkills();
	try {
		const scope = await agentPresets.standingKeyFor(preset);
		const advertised = (await skills.list({ scope })).filter((row) => row.invocation?.modelInvocable !== false).map((row) => ({
			id: row.name,
			name: row.name,
			...row.description !== void 0 && row.description.length > 0 ? { description: row.description } : {}
		}));
		return advertised.length > 0 ? advertised : chatFallbackSkills();
	} catch {
		return chatFallbackSkills();
	}
}
/** The managed env-var name backing one inbound instance's auth token. */
function inboundAuthEnv(id) {
	return `A2A_INBOUND_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}
/**
* Resolve one inbound instance's bearer token: the credentials service first
* (per-call layered read; the GUI writes here), then the process environment
* (external `export` of the same name keeps working).
*/
async function resolveAuthToken(credentials, envName) {
	if (envName === void 0) return void 0;
	try {
		const stored = await credentials?.resolve(envName);
		if (stored !== void 0 && stored.value.length > 0) return stored.value;
	} catch {}
	const direct = process.env[envName];
	return direct !== void 0 && direct.length > 0 ? direct : void 0;
}
/** Assemble one live instance (skills and auth token already resolved). */
function assemble(record, skills, authToken, host) {
	const endpointPath = record.endpointPath;
	const cardPath = `${endpointPath.replace(/\/$/, "")}/agent-card.json`;
	const preset = trimOptional(record.preset) ?? host.defaultPresetId;
	const traceEnabled = host.inboundTrace && (record.trace ?? host.inboundTrace);
	const sessionCwd = resolveInstanceCwd(record, host.sessionCwd);
	const modelOverride = buildModelOverride(record);
	const tasks = new ScopedTaskStore(host.tasks, record.id);
	const cardOptions = {
		endpointPath,
		name: record.name,
		description: record.description,
		version: record.version,
		skills,
		trace: traceEnabled,
		...authToken !== void 0 ? { authToken } : {},
		...host.attachments !== void 0 ? { inputModes: [
			"text/plain",
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif",
			"application/octet-stream"
		] } : {}
	};
	const deploymentBaseUrl = deploymentBaseUrlOf(host);
	const configuredBaseUrl = resolveInstanceBaseUrl(record, deploymentBaseUrl);
	const autoBaseUrl = configuredBaseUrl === "auto";
	const staticAutoFallback = deploymentBaseUrl === "auto" ? "http://127.0.0.1" : deploymentBaseUrl;
	const withAdvertisedPort = (url) => {
		if (url === "auto" || host.webPort === void 0) return url;
		const port = String(host.webPort).trim();
		if (port === "" || port === "80" || port === "443") return url;
		try {
			const parsed = new URL(url);
			if (parsed.port !== "" || parsed.protocol !== "http:") return url;
			parsed.port = port;
			return parsed.toString().replace(/\/$/, "");
		} catch {
			return url;
		}
	};
	const card = buildCard({
		...cardOptions,
		baseUrl: autoBaseUrl ? staticAutoFallback : withAdvertisedPort(configuredBaseUrl)
	});
	const sessions = new ContextSessionRegistry();
	const sessionPool = host.agents ? new ContextSessionPool(host.agents, {
		cwd: sessionCwd,
		sessionNamespace: record.id,
		...host.agentPresets !== void 0 ? { agentPresets: host.agentPresets } : {},
		...preset !== void 0 ? { presetId: () => preset } : {},
		...host.attachments !== void 0 ? { attachments: host.attachments } : {},
		resolveAgentOptions: () => modelOverride ?? host.resolveDefaultModel?.(),
		toolRestriction: () => buildToolRestriction(record),
		onSessionOpened: (info) => {
			tasks.setContextSession(info.contextId, info.sessionId).catch((err) => {
				host.logger.error(`[a2a:${record.id}] context binding persist failed: ${String(err)}`);
			});
			Promise.resolve(host.onSessionOpened?.({
				...info,
				serverId: record.id,
				cwd: sessionCwd
			})).catch((err) => {
				host.logger.warn(`[a2a:${record.id}] workspace accounting failed: ${String(err)}`);
			});
		},
		...host.reviveArchivedSession !== void 0 ? { reviveArchivedSession: host.reviveArchivedSession } : {}
	}) : void 0;
	const executors = new ExecutorSet({ chat: "session" }, sessionPool ? createSessionExecutor(sessionPool) : refuseExecutor("no agent loop mounted"), sessionPool !== void 0 && host.subagents !== void 0 ? createSubagentExecutor({
		pool: sessionPool,
		subagents: host.subagents,
		provider: host.subagentProvider
	}) : void 0);
	const inbound = new LiveInboundRegistry();
	const skillIds = new Set(skills.map((s) => s.id));
	const gate = async (input) => {
		if (!skillIds.has(input.skill)) return {
			ok: false,
			reason: `unknown skill "${input.skill}"`
		};
		const decision = {
			contextId: input.contextId,
			skill: input.skill,
			parts: input.parts,
			remotePeerId: input.remotePeerId
		};
		const decided = await host.ctx.waterfall("a2a/inbound-task", decision, async () => decision);
		host.logger.info(`[a2a:${record.id}] inbound skill=${decided.skill} rejected=${decided.rejected?.reason ?? "no"}`);
		if (decided.rejected !== void 0) return {
			ok: false,
			reason: decided.rejected.reason
		};
		return { ok: true };
	};
	const server = new A2AServer({
		card,
		...autoBaseUrl ? { cardForRequest: (req) => buildCard({
			...cardOptions,
			baseUrl: withAdvertisedPort(deriveBaseUrlFromRequest(req) ?? staticAutoFallback)
		}) } : {},
		store: tasks,
		executors,
		...authToken !== void 0 ? { authToken } : {},
		cardPath,
		gate,
		traceEnabled,
		serverId: record.id,
		...host.metrics !== void 0 ? { metrics: host.metrics } : {},
		...host.taskTimeoutMs !== void 0 ? { taskTimeoutMs: host.taskTimeoutMs } : {},
		...host.requestsPerMinute !== void 0 ? { requestsPerMinute: host.requestsPerMinute } : {},
		...host.maxConcurrentTasks !== void 0 ? { maxConcurrentTasks: host.maxConcurrentTasks } : {},
		onInbound: (facts) => inbound.note({
			method: facts.method,
			...facts.source !== void 0 ? { source: facts.source } : {},
			taskIds: facts.taskIds,
			streaming: facts.streaming
		}),
		onTaskSettled: (taskId) => {
			host.logger.info(`[a2a:${record.id}] task settled ${taskId}`);
			inbound.settle(taskId);
		},
		onStreamOpen: ({ taskId }) => sessions.noteStreamOpen(taskId),
		onStreamClose: (taskId) => sessions.noteStreamClose(taskId)
	});
	const routes = new A2aRoutes(host.webServer, server, cardPath, host.maxBodyBytes ?? 1048576);
	return {
		id: record.id,
		name: record.name,
		record,
		preset,
		skills,
		card,
		server,
		routes,
		inbound,
		sessions,
		...sessionPool !== void 0 ? { sessionPool } : {},
		executors,
		endpointPath,
		cardPath,
		traceEnabled,
		dispose: () => {
			routes.dispose();
			sessions.clear();
			executors.disposeAll().catch(() => {});
		}
	};
}
/** Persisted-instance store over the inbound_servers table. */
var DomainInboundStore = class DomainInboundStore {
	table;
	static KEY(id) {
		return `in:${id}`;
	}
	constructor(table) {
		this.table = table;
	}
	list() {
		const out = [];
		const entries = this.table.entries;
		if (entries === void 0) return out;
		for (const [key, raw] of entries.call(this.table)) {
			if (!key.startsWith("in:")) continue;
			const parsed = safeParse$1(raw);
			if (parsed !== void 0) out.push(parsed);
		}
		return out;
	}
	get(id) {
		const raw = this.table.get(DomainInboundStore.KEY(id));
		return raw === void 0 ? void 0 : safeParse$1(raw);
	}
	async save(record) {
		await this.table.put(DomainInboundStore.KEY(record.id), JSON.stringify(record));
	}
	async remove(id) {
		await this.table.put(DomainInboundStore.KEY(id), "");
	}
};
function safeParse$1(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return void 0;
		return parsed;
	} catch {
		return;
	}
}
/** Manages the live set of inbound server instances. */
var InboundServerManager = class {
	host;
	store;
	live = /* @__PURE__ */ new Map();
	constructor(host, store) {
		this.host = host;
		this.store = store;
	}
	/** Assemble every persisted instance (skills derived per preset). */
	async boot() {
		for (const record of this.store.list()) try {
			const live = assemble(record, await derivePresetSkills(this.host.agentPresets, this.host.skills, trimOptional(record.preset) ?? this.host.defaultPresetId), await resolveAuthToken(this.host.credentials, record.authTokenEnv), this.host);
			this.live.set(record.id, live);
			if (record.enabled) live.routes.enable();
		} catch (err) {
			this.host.logger.error(`[a2a:${record.id}] failed to assemble: ${String(err.message)}`);
		}
	}
	list() {
		return [...this.live.values()];
	}
	get(id) {
		return this.live.get(id);
	}
	/** Create, persist, and assemble a new inbound instance. */
	async add(input) {
		const id = this.newId(input.name);
		if (this.live.has(id)) return {
			ok: false,
			message: `inbound server ${id} already exists`
		};
		const workspace = validateWorkspace(input.workspace);
		if (!workspace.ok) return {
			ok: false,
			message: workspace.message
		};
		const advertisedBaseUrl = validateBaseUrl(input.baseUrl);
		if (!advertisedBaseUrl.ok) return {
			ok: false,
			message: advertisedBaseUrl.message
		};
		const provider = trimOptional(input.provider);
		const model = trimOptional(input.model);
		const toolAllow = validateToolAllow(input.toolAllow);
		if (!toolAllow.ok) return {
			ok: false,
			message: toolAllow.message
		};
		const preset = trimOptional(input.preset) ?? this.host.defaultPresetId;
		const record = {
			id,
			name: input.name,
			description: input.description,
			version: input.version,
			endpointPath: input.endpointPath ?? `/a2a/${id}`,
			...preset !== void 0 ? { preset } : {},
			...input.authTokenEnv !== void 0 ? { authTokenEnv: input.authTokenEnv } : {},
			...input.trace !== void 0 ? { trace: input.trace } : {},
			...workspace.value !== void 0 ? { workspace: workspace.value } : {},
			...provider !== void 0 ? { provider } : {},
			...model !== void 0 ? { model } : {},
			...toolAllow.value !== void 0 ? { toolAllow: toolAllow.value } : {},
			...advertisedBaseUrl.value !== void 0 ? { baseUrl: advertisedBaseUrl.value } : {},
			enabled: input.enabled ?? true
		};
		try {
			const live = assemble(record, await derivePresetSkills(this.host.agentPresets, this.host.skills, preset), await resolveAuthToken(this.host.credentials, record.authTokenEnv), this.host);
			await this.store.save(record);
			this.live.set(id, live);
			if (record.enabled) live.routes.enable();
			return {
				ok: true,
				message: `inbound server "${record.name}" created`,
				id
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to create inbound server: ${String(err.message)}`
			};
		}
	}
	/** Persist, rebuild (re-deriving skills), and apply a patch onto a live instance. */
	async update(id, patch) {
		const live = this.live.get(id);
		const stored = this.store.get(id);
		if (live === void 0 || stored === void 0) return {
			ok: false,
			message: `inbound server ${id} not found`
		};
		if (patch.workspace !== void 0) {
			const workspace = validateWorkspace(patch.workspace);
			if (!workspace.ok) return {
				ok: false,
				message: workspace.message
			};
		}
		if (patch.baseUrl !== void 0) {
			const baseUrl = validateBaseUrl(patch.baseUrl);
			if (!baseUrl.ok) return {
				ok: false,
				message: baseUrl.message
			};
		}
		const { workspace: _dropWs, provider: _dropProv, model: _dropModel, toolAllow: _dropTools, baseUrl: _dropBase, preset: _dropPreset, ...base } = stored;
		const nextToolAllow = patch.toolAllow !== void 0 ? validateToolAllow(patch.toolAllow) : validateToolAllow(stored.toolAllow);
		if (!nextToolAllow.ok) return {
			ok: false,
			message: nextToolAllow.message
		};
		const nextWorkspace = patch.workspace !== void 0 ? trimOptional(patch.workspace) : stored.workspace;
		const nextProvider = patch.provider !== void 0 ? trimOptional(patch.provider) : stored.provider;
		const nextModel = patch.model !== void 0 ? trimOptional(patch.model) : stored.model;
		const nextBaseUrl = patch.baseUrl !== void 0 ? trimOptional(patch.baseUrl)?.replace(/\/$/, "") : stored.baseUrl;
		const nextPreset = patch.preset !== void 0 ? trimOptional(patch.preset) : trimOptional(stored.preset);
		const next = {
			...base,
			name: patch.name ?? stored.name,
			description: patch.description ?? stored.description,
			version: patch.version ?? stored.version,
			endpointPath: patch.endpointPath ?? stored.endpointPath,
			...nextPreset !== void 0 ? { preset: nextPreset } : {},
			...patch.authTokenEnv !== void 0 ? { authTokenEnv: patch.authTokenEnv } : {},
			...patch.trace !== void 0 ? { trace: patch.trace } : {},
			...nextWorkspace !== void 0 ? { workspace: nextWorkspace } : {},
			...nextProvider !== void 0 ? { provider: nextProvider } : {},
			...nextModel !== void 0 ? { model: nextModel } : {},
			...nextToolAllow.value !== void 0 ? { toolAllow: nextToolAllow.value } : {},
			...nextBaseUrl !== void 0 ? { baseUrl: nextBaseUrl } : {},
			enabled: stored.enabled
		};
		try {
			await this.store.save(next);
			const replaced = assemble(next, await derivePresetSkills(this.host.agentPresets, this.host.skills, next.preset ?? this.host.defaultPresetId), await resolveAuthToken(this.host.credentials, next.authTokenEnv), this.host);
			const wasEnabled = live.routes.active;
			live.dispose();
			this.live.set(id, replaced);
			if (wasEnabled || next.enabled) replaced.routes.enable();
			return {
				ok: true,
				message: `inbound server ${id} updated`
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to update inbound server: ${String(err.message)}`
			};
		}
	}
	/**
	* Set (or clear) an inbound instance's bearer token. The value is written to
	* the credentials service under this instance's managed env-var name; the
	* record stores only that name and the live instance is rebuilt.
	*/
	async setAuth(id, token) {
		const live = this.live.get(id);
		const stored = this.store.get(id);
		if (live === void 0 || stored === void 0) return {
			ok: false,
			message: `inbound server ${id} not found`
		};
		const credentials = this.host.credentials;
		const envName = inboundAuthEnv(id);
		try {
			if (token === void 0 || token.length === 0) {
				if (credentials !== void 0) await credentials.unset(envName);
				const { authTokenEnv: _dropped, ...rest } = stored;
				await this.store.save(rest);
				const replaced = assemble(rest, await derivePresetSkills(this.host.agentPresets, this.host.skills, rest.preset ?? this.host.defaultPresetId), void 0, this.host);
				const wasEnabled = live.routes.active;
				live.dispose();
				this.live.set(id, replaced);
				if (wasEnabled || rest.enabled) replaced.routes.enable();
				return {
					ok: true,
					message: `inbound server ${id} auth cleared`
				};
			}
			if (credentials === void 0) return {
				ok: false,
				message: "credentials service not mounted; cannot store the token (set the env var externally instead)"
			};
			await credentials.set(envName, token);
			const next = {
				...stored,
				authTokenEnv: envName
			};
			await this.store.save(next);
			const replaced = assemble(next, await derivePresetSkills(this.host.agentPresets, this.host.skills, next.preset ?? this.host.defaultPresetId), token, this.host);
			const wasEnabled = live.routes.active;
			live.dispose();
			this.live.set(id, replaced);
			if (wasEnabled || next.enabled) replaced.routes.enable();
			return {
				ok: true,
				message: `inbound server ${id} auth set (${envName})`
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to set inbound auth: ${String(err.message)}`
			};
		}
	}
	/** Enable/disable an instance's routes. */
	setEnabled(id, enabled) {
		const live = this.live.get(id);
		if (live === void 0) return {
			ok: false,
			message: `inbound server ${id} not found`
		};
		if (enabled) live.routes.enable();
		else live.routes.disable();
		const stored = this.store.get(id);
		if (stored !== void 0) this.store.save({
			...stored,
			enabled
		}).catch(() => {});
		return {
			ok: true,
			message: `inbound server ${id} ${enabled ? "enabled" : "disabled"}`
		};
	}
	/** Remove, dispose, and unpersist an instance. */
	async remove(id) {
		const live = this.live.get(id);
		if (live === void 0) return {
			ok: false,
			message: `inbound server ${id} not found`
		};
		live.dispose();
		this.live.delete(id);
		await this.store.remove(id);
		return {
			ok: true,
			message: `inbound server ${id} removed`
		};
	}
	/** Dispose every instance. */
	disposeAll() {
		for (const live of this.live.values()) live.dispose();
		this.live.clear();
	}
	newId(seed) {
		return `${seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "server"}-${this.host.newId()}`;
	}
};
//#endregion
//#region lib/types/server/settings.js
/**
* Deployment-wide inbound settings, editable at runtime from the GUI dashboard
* and persisted in the `a2a` domain's `identity` table (the same kv table the
* service identity uses, under its own key). Only the advertised base URL
* lives here today: `auto` derives it per request, an absolute http(s) URL
* pins it, and an absent value falls back to the loader config.
* @module dsh-a2a/server/settings
*/
const SETTINGS_KEY = "settings";
function decode(raw) {
	if (raw === void 0 || raw === "") return void 0;
	try {
		const parsed = JSON.parse(raw);
		const baseUrl = typeof parsed.baseUrl === "string" && parsed.baseUrl.length > 0 ? parsed.baseUrl : void 0;
		return baseUrl === void 0 ? {} : { baseUrl };
	} catch {
		return;
	}
}
function encode(value) {
	return JSON.stringify(value);
}
/** Read the persisted deployment settings (undefined when never configured). */
function readDeploymentSettings(domain) {
	return decode(domain.identity.get(SETTINGS_KEY));
}
/** Persist deployment settings; a blank `baseUrl` clears the override. */
async function writeDeploymentSettings(domain, record) {
	await domain.identity.put(SETTINGS_KEY, encode(record));
}
//#endregion
//#region lib/types/server/preset-capabilities.js
/**
* Preset capability projection: turn a preset roster plus the host's
* composition inventory into the "what plugins does an A2A session actually
* carry" list the dashboard shows next to the preset picker.
*
* The DSH agent-preset registry keeps the authoritative plugin rows; this
* module is a pure mapping so it can be unit-tested without a host.
* @module dsh-a2a/server/preset-capabilities
*/
/** Friendly names for the plugin modules the dashboard commonly sees. */
const PLUGIN_DESCRIPTORS = {
	"@deepseek-ai/dsh-persona": {
		label: "人格提示词",
		hint: "系统提示词里的人设部分（卡片的正文就挂在这里）"
	},
	"@deepseek-ai/dsh-agent-instructions": {
		label: "项目指令",
		hint: "AGENTS.md 等项目说明注入"
	},
	"@deepseek-ai/dsh-time-context": {
		label: "时间上下文",
		hint: "把当前时间告诉模型"
	},
	"@deepseek-ai/dsh-tool-bash": {
		label: "终端命令",
		hint: "执行 shell 命令"
	},
	"@deepseek-ai/dsh-tool-pwsh": {
		label: "PowerShell",
		hint: "Windows 下的命令执行"
	},
	"@deepseek-ai/dsh-tool-fs": {
		label: "文件读写",
		hint: "读/写/改文件"
	},
	"@deepseek-ai/dsh-tool-fs-search": {
		label: "文件搜索",
		hint: "按内容或文件名搜索"
	},
	"@deepseek-ai/dsh-tool-jobs": {
		label: "后台任务",
		hint: "管理长跑进程"
	},
	"@deepseek-ai/dsh-tool-schedule": {
		label: "定时提醒",
		hint: "设定时任务"
	},
	"@deepseek-ai/dsh-skill-filesystem": {
		label: "文件技能",
		hint: "把文件系统能力暴露成 skill"
	},
	"@deepseek-ai/dsh-tool-skill": {
		label: "技能调用",
		hint: "按需加载技能"
	},
	"@deepseek-ai/dsh-command-goal": {
		label: "目标命令",
		hint: "/goal 命令"
	},
	"@deepseek-ai/dsh-tool-goal": {
		label: "目标工具",
		hint: "跨轮次目标管理"
	},
	"@deepseek-ai/dsh-plan-mode": {
		label: "计划模式",
		hint: "先出方案再动手"
	},
	"@deepseek-ai/dsh-compaction-basic": {
		label: "上下文压缩",
		hint: "长了自动压缩历史"
	},
	"@deepseek-ai/dsh-compaction-tool-result-pruner": {
		label: "工具结果裁剪",
		hint: "缩短过长的工具输出"
	},
	"@deepseek-ai/dsh-tool-subagent": {
		label: "子代理",
		hint: "派发子任务"
	},
	"@deepseek-ai/dsh-tool-subagent-control": {
		label: "子代理管理",
		hint: "查看/控制子代理"
	},
	"@deepseek-ai/dsh-tool-web-search": {
		label: "联网搜索",
		hint: "搜索网页"
	},
	"@deepseek-ai/dsh-tool-web-fetch": {
		label: "网页读取",
		hint: "抓取网页正文"
	},
	"dsh-nekowhale-stickers": {
		label: "表情包",
		hint: "搜索/发送贴纸与表情包"
	},
	"cordis:group": {
		label: "插件分组",
		hint: "一组插件的容器"
	}
};
/** Short module name without the `@deepseek-ai/` scope. */
function shortModuleName(module) {
	return module.replace(/^@[^/]+\//, "");
}
/** Friendly label + hint for a plugin module; unknown modules keep their short name. */
function describePlugin(module) {
	return PLUGIN_DESCRIPTORS[module] ?? { label: shortModuleName(module) };
}
/**
* Map roster rows to their composed plugin rows.
* Presets without a composition entry get an empty list (not an error): the
* dashboard still lists them, it just cannot say what they carry.
* @param rows - the preset roster.
* @param compositions - the host composition inventory, or undefined.
* @returns capabilities keyed by preset id.
*/
function presetCapabilities(rows, compositions) {
	const byId = /* @__PURE__ */ new Map();
	for (const composition of compositions ?? []) byId.set(composition.id, composition);
	const result = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const composition = byId.get(row.id);
		if (composition === void 0) {
			result.set(row.id, { plugins: [] });
			continue;
		}
		const plugins = (composition.rows ?? []).map((plugin) => {
			const descriptor = describePlugin(plugin.moduleName);
			return {
				entryId: plugin.entryId,
				module: plugin.moduleName,
				enabled: plugin.enabled,
				...plugin.condition !== void 0 ? { condition: plugin.condition } : {},
				label: descriptor.label,
				...descriptor.hint !== void 0 ? { hint: descriptor.hint } : {}
			};
		});
		result.set(row.id, {
			plugins,
			...composition.broken === true ? { broken: true } : {},
			source: "inventory"
		});
	}
	return result;
}
/**
* Fallback capability projection from `inspectCompositions()`.
* The inspection reports module names but not per-row enablement, so every row
* is reported as enabled; it is only used when the host cannot return a full
* composition inventory.
* @param rows - the preset roster.
* @param inspections - host inspections, or undefined.
* @returns capabilities keyed by preset id with `source: 'inspection'`.
*/
function capabilitiesFromInspections(rows, inspections) {
	const byId = /* @__PURE__ */ new Map();
	for (const inspection of inspections ?? []) byId.set(inspection.id, inspection);
	const result = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const inspection = byId.get(row.id);
		if (inspection === void 0) {
			result.set(row.id, {
				plugins: [],
				source: "inspection"
			});
			continue;
		}
		const plugins = (inspection.modules ?? []).map((module) => {
			const descriptor = describePlugin(module.moduleName);
			return {
				entryId: null,
				module: module.moduleName,
				enabled: true,
				label: descriptor.label,
				...descriptor.hint !== void 0 ? { hint: descriptor.hint } : {}
			};
		});
		result.set(row.id, {
			plugins,
			source: "inspection"
		});
	}
	return result;
}
//#endregion
//#region lib/types/server/net.js
/**
* Local network address discovery for the deployment advertised base URL.
*
* The dashboard offers the machine's own IPv4 origins as pick-list entries so
* operators do not have to type (and remember) the LAN address by hand.
* @module dsh-a2a/server/net
*/
const IPV4_FAMILY = 4;
function isIpv4(info) {
	return info.family === "IPv4" || info.family === IPV4_FAMILY;
}
/**
* Build candidate origins from a `networkInterfaces()` result: every non-internal
* IPv4 address on every interface, in interface-name order. Pure so the pick
* list can be tested without touching the host's real NICs.
*/
function baseUrlCandidatesFrom(interfaces) {
	const candidates = [];
	for (const name of Object.keys(interfaces).sort()) for (const info of interfaces[name] ?? []) {
		if (info.internal || !isIpv4(info)) continue;
		candidates.push({
			value: `http://${info.address}`,
			label: `${info.address}（${name}）`,
			interface: name
		});
	}
	return candidates;
}
/** Candidates for the current host. */
function discoverBaseUrlCandidates() {
	return baseUrlCandidatesFrom(networkInterfaces());
}
/**
* Ensure `directory` is a registered host workspace.
*
* A composition without the workspace registry is left untouched: the plugin
* keeps working, sessions just stay outside the host session list. A
* registration failure is reported through `onError` and swallowed so a
* missing workspace record can never fail plugin startup or an inbound save.
* @param registry - the probed workspace registry, or undefined when absent.
* @param directory - absolute directory the default inbound sessions run in.
* @param options - optional title and observers.
* @returns `registered`, `unavailable`, or `failed` (see the status type).
*/
async function registerDefaultWorkspace(registry, directory, options = {}) {
	if (registry === void 0) return "unavailable";
	try {
		await registry.create(directory, options.title ?? "A2A Sessions");
		options.onRegistered?.(directory);
		return "registered";
	} catch (error) {
		options.onError?.(directory, error);
		return "failed";
	}
}
/**
* Account existing sessions under a workspace.
*
* The host only attaches a session when it is opened *through* that workspace;
* sessions the plugin opened by `cwd` (every inbound context) therefore stay
* unaccounted and invisible in the host session list, even once the directory
* itself is registered. Attach is validated against the stored header cwd, so
* a session belonging to another workspace rejects — a mismatch is skipped,
* never fatal, and the count reports only the adoptions that happened.
* @param workspace - the resolved workspace entity, or undefined when absent.
* @param sessionIds - candidate session ids (duplicates and unknowns are fine).
* @param options - optional failure observer.
* @returns how many sessions the workspace newly accounted.
*/
async function adoptSessions(workspace, sessionIds, options = {}) {
	if (workspace === void 0) return 0;
	const accounted = new Set(workspace.sessionIds ?? []);
	const seen = /* @__PURE__ */ new Set();
	let adopted = 0;
	for (const sessionId of sessionIds) {
		if (seen.has(sessionId) || accounted.has(sessionId)) continue;
		seen.add(sessionId);
		try {
			await workspace.attachSession(sessionId);
			adopted += 1;
		} catch (error) {
			options.onError?.(sessionId, error);
		}
	}
	return adopted;
}
//#endregion
//#region lib/types/outbound/calls.js
/**
* Outbound A2A client: AgentCard discovery plus the JSON-RPC methods the
* tools layer needs. Supports blocking and streaming sends, cancellation
* propagation, and bounded retries for transient transport failures.
* @module dsh-a2a/outbound/calls
*/
/** Error carrying the remote JSON-RPC error code. */
var A2AError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "A2AError";
	}
};
/** A connected remote A2A agent (one AgentCard endpoint). */
var A2AClient = class A2AClient {
	opts;
	card;
	endpoint;
	constructor(card, endpoint, opts) {
		this.opts = opts;
		this.card = card;
		this.endpoint = endpoint;
	}
	/** Fetch and validate an AgentCard, then connect to its JSON-RPC endpoint. */
	static async connect(agentCardUrl, opts = {}) {
		const timeoutMs = opts.timeoutMs ?? 6e4;
		const fetchImpl = opts.fetchImpl ?? fetch;
		const response = await withRetries(opts.retries ?? 2, opts.retryDelayMs ?? 150, async () => {
			const result = await fetchImpl(agentCardUrl, {
				headers: {
					accept: "application/json",
					"a2a-version": "1.0",
					...opts.bearerToken ? { authorization: `Bearer ${opts.bearerToken}` } : {}
				},
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (result.status >= 500) throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, `agent card fetch failed: HTTP ${result.status}`);
			return result;
		});
		if (!response.ok) throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `agent card fetch failed: HTTP ${response.status}`);
		const card = await response.json();
		if (typeof card.name !== "string" || !Array.isArray(card.skills)) throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `invalid agent card at ${agentCardUrl}`);
		const endpoint = (card.supportedInterfaces?.find((i) => (i.protocolBinding ?? "JSONRPC") === "JSONRPC") ?? card.supportedInterfaces?.[0])?.url;
		if (!endpoint) throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, `agent card at ${agentCardUrl} advertises no JSON-RPC interface`);
		return new A2AClient(card, endpoint, opts);
	}
	/** Send a message and wait (or poll/stream) until the task settles. */
	async sendMessage(message, options = {}) {
		if (options.stream === true && this.card.capabilities?.streaming === true) return this.sendStreamingMessage(message, options);
		const task = taskFromResult(await this.call(A2A_METHODS.sendMessage, { message }, options.signal));
		if (task === void 0) throw new A2AError(A2A_ERROR_CODES.INVALID_AGENT_RESPONSE, "SendMessage returned neither a task nor a message");
		if (isTerminal(task.status.state)) return task;
		return this.pollTask(task.id, options.signal);
	}
	/**
	* Send a message over SSE and return the settled task. Transport failures
	* before the first frame are retried; once progress was observed a retry
	* could duplicate remote work, so the error is surfaced instead.
	*/
	async sendStreamingMessage(message, options = {}) {
		const retries = this.opts.retries ?? 2;
		let lastEventId;
		for (let attempt = 0;; attempt += 1) try {
			return await this.sendStreamingOnce(message, options, lastEventId, (id) => {
				lastEventId = id;
			});
		} catch (err) {
			if (options.signal?.aborted === true || attempt >= retries || !retryableError(err)) throw err;
			await new Promise((resolve) => setTimeout(resolve, (this.opts.retryDelayMs ?? 150) * (attempt + 1)));
		}
	}
	async sendStreamingOnce(message, options = {}, lastEventId, onEventId) {
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		const timeoutMs = this.opts.timeoutMs ?? 6e4;
		const { signal, cleanup } = mergedSignal(options.signal, timeoutMs);
		let task;
		try {
			const response = await fetchImpl(this.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
					"a2a-version": "1.0",
					...this.opts.bearerToken ? { authorization: `Bearer ${this.opts.bearerToken}` } : {},
					...lastEventId !== void 0 ? { "last-event-id": lastEventId } : {}
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: crypto.randomUUID(),
					method: A2A_METHODS.sendStreamingMessage,
					params: { message }
				}),
				signal
			});
			if (response.status === 401) throw new A2AError(-32040, "remote agent rejected credentials (401)");
			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				throw new A2AError(-32e3, `remote agent rate-limited the request${retryAfter ? `; retry after ${retryAfter}s` : ""}`);
			}
			if (!response.ok || response.body === null) throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, `A2A stream failed: HTTP ${response.status}`);
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				for (;;) {
					const split = buffer.indexOf("\n\n");
					if (split < 0) break;
					const raw = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);
					const eventId = /^id:\s*(\d+)/m.exec(raw)?.[1];
					if (eventId !== void 0) onEventId?.(eventId);
					const parsed = parseSseEvent(raw);
					if (parsed === void 0) continue;
					if ("error" in parsed) throw new A2AError(parsed.error.code, parsed.error.message);
					task = applyFrame(task, parsed);
					options.onTask?.(task);
					options.onEvent?.(parsed);
					if (task !== void 0 && isTerminal(task.status.state)) return task;
				}
			}
			if (task !== void 0 && isTerminal(task.status.state)) return task;
			throw new A2AError(A2A_ERROR_CODES.INTERNAL_ERROR, "A2A stream closed without a terminal task");
		} catch (err) {
			if (signal.aborted) {
				if (task !== void 0) this.cancelTask(task.id).catch(() => {});
				if (options.signal?.aborted === true) throw abortError(options.signal.reason);
				throw new A2AError(-32e3, `A2A stream timed out after ${timeoutMs}ms`);
			}
			throw err;
		} finally {
			cleanup();
		}
	}
	async getTask(taskId, signal) {
		return this.call(A2A_METHODS.getTask, { id: taskId }, signal);
	}
	async listTasks(params = {}, signal) {
		const result = await this.call(A2A_METHODS.listTasks, params, signal);
		if (Array.isArray(result)) return result;
		const value = result;
		return Array.isArray(value.tasks) ? value.tasks : [];
	}
	async cancelTask(taskId, signal) {
		return this.call(A2A_METHODS.cancelTask, { id: taskId }, signal);
	}
	/** Poll a task until terminal or the overall timeout elapses. */
	async pollTask(taskId, signal) {
		const budget = this.opts.timeoutMs ?? 6e4;
		const deadline = Date.now() + budget;
		for (;;) {
			if (signal?.aborted === true) {
				this.cancelTask(taskId).catch(() => {});
				throw abortError(signal.reason);
			}
			const task = await this.getTask(taskId, signal).catch(async (err) => {
				if (signal?.aborted === true) {
					this.cancelTask(taskId).catch(() => {});
					throw abortError(signal.reason);
				}
				throw err;
			});
			if (isTerminal(task.status.state)) return task;
			if (Date.now() >= deadline) {
				this.cancelTask(taskId).catch(() => {});
				throw new A2AError(-32e3, `task ${taskId} did not settle within ${budget}ms`);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	async call(method, params, signal) {
		const timeoutMs = this.opts.timeoutMs ?? 6e4;
		const fetchImpl = this.opts.fetchImpl ?? fetch;
		return withRetries(this.opts.retries ?? 2, this.opts.retryDelayMs ?? 150, async () => {
			const { signal: merged, cleanup } = mergedSignal(signal, timeoutMs);
			try {
				let response;
				try {
					response = await fetchImpl(this.endpoint, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json",
							"a2a-version": "1.0",
							...this.opts.bearerToken ? { authorization: `Bearer ${this.opts.bearerToken}` } : {}
						},
						body: JSON.stringify({
							jsonrpc: "2.0",
							id: crypto.randomUUID(),
							method,
							params
						}),
						signal: merged
					});
				} catch (err) {
					if (signal?.aborted === true) throw abortError(signal.reason);
					if (merged.aborted) throw new A2AError(-32e3, `A2A call ${method} timed out after ${timeoutMs}ms`);
					if (err instanceof Error && err.name === "TimeoutError") throw new A2AError(-32e3, `A2A call ${method} timed out after ${timeoutMs}ms`);
					throw err;
				}
				if (response.status === 401) throw new A2AError(-32040, "remote agent rejected credentials (401)");
				if (response.status === 429) {
					const retryAfter = response.headers.get("retry-after");
					throw new A2AError(-32e3, `remote agent rate-limited the request${retryAfter ? `; retry after ${retryAfter}s` : ""}`);
				}
				if (!response.ok) throw new A2AError(response.status >= 500 ? A2A_ERROR_CODES.INTERNAL_ERROR : A2A_ERROR_CODES.INVALID_REQUEST, `A2A call ${method} failed: HTTP ${response.status}`);
				const payload = await response.json();
				if ("error" in payload) {
					const error = payload.error;
					throw new A2AError(error.code, error.message);
				}
				return payload.result;
			} finally {
				cleanup();
			}
		});
	}
};
/** Whether an error is safe to retry at the transport layer. */
function retryableError(err) {
	if (err instanceof A2AError) return err.code === A2A_ERROR_CODES.INTERNAL_ERROR || /timed out|fetch|network|ECONN|socket/i.test(err.message);
	return err instanceof Error && err.name !== "AbortError";
}
/** Retry transient transport failures and 5xx responses. */
async function withRetries(retries, delayMs, task) {
	let attempt = 0;
	for (;;) try {
		return await task();
	} catch (err) {
		if (attempt >= retries || !retryableError(err)) throw err;
		attempt += 1;
		await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
	}
}
/** Combine an optional caller signal with a per-call timeout. */
function mergedSignal(signal, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("timeout")), timeoutMs);
	timer.unref?.();
	const onAbort = () => controller.abort(signal?.reason);
	if (signal?.aborted === true) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
	};
}
function abortError(reason) {
	const error = new Error(reason instanceof Error ? reason.message : "A2A call canceled");
	error.name = "AbortError";
	error.cause = reason;
	return error;
}
/** Parse one SSE block into a StreamResponse or a JSON-RPC error. */
function parseSseEvent(raw) {
	const data = raw.replace(/\r/g, "").split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
	if (data.length === 0) return void 0;
	try {
		const payload = JSON.parse(data);
		if (payload.error !== void 0) return { error: {
			code: typeof payload.error.code === "number" ? payload.error.code : -32e3,
			message: payload.error.message ?? "remote stream error"
		} };
		if (payload.result !== void 0) return payload.result;
		if (typeof payload.code === "number" && typeof payload.message === "string") return { error: {
			code: payload.code,
			message: payload.message
		} };
		return payload;
	} catch {
		return;
	}
}
/** Fold one stream frame into the task snapshot. */
/**
* Merge an appended artifact slice: a text fragment continues the trailing text
* part, so streamed deltas read as one answer instead of one word per part.
*/
function appendParts(existing, incoming) {
	const merged = [...existing];
	for (const part of incoming) {
		const last = merged[merged.length - 1];
		if (last !== void 0 && "text" in last && typeof last.text === "string" && "text" in part && typeof part.text === "string") {
			merged[merged.length - 1] = {
				...last,
				text: last.text + part.text
			};
			continue;
		}
		merged.push(part);
	}
	return merged;
}

function applyFrame(current, frame) {
	if ("task" in frame) return frame.task;
	if ("message" in frame) {
		const messageTask = taskFromMessage(frame.message);
		if (current === void 0) return messageTask;
		return {
			...current,
			status: messageTask.status,
			artifacts: [...current.artifacts ?? [], ...messageTask.artifacts ?? []]
		};
	}
	if ("statusUpdate" in frame) {
		const update = frame.statusUpdate;
		return {
			...current ?? { id: update.taskId },
			id: update.taskId,
			...update.contextId !== void 0 ? { contextId: update.contextId } : {},
			status: update.status
		};
	}
	const update = frame.artifactUpdate;
	const base = current ?? {
		id: update.taskId,
		...update.contextId !== void 0 ? { contextId: update.contextId } : {},
		status: {
			state: "TASK_STATE_WORKING",
			timestamp: (/* @__PURE__ */ new Date()).toISOString()
		}
	};
	const artifacts = [...base.artifacts ?? []];
	const index = artifacts.findIndex((artifact) => artifact.artifactId === update.artifact.artifactId);
	if (index >= 0) artifacts[index] = update.append === true ? {
		...artifacts[index],
		parts: appendParts(artifacts[index].parts ?? [], update.artifact.parts)
	} : { ...update.artifact };
	else artifacts.push(update.artifact);
	return {
		...base,
		artifacts
	};
}
/** Accept the spec envelope `{task}`/`{message}`, plus a bare Task for older peers. */
function taskFromResult(result) {
	if (result === null || typeof result !== "object") return void 0;
	const value = result;
	if (value.task !== void 0) return value.task;
	if (value.message !== void 0) return taskFromMessage(value.message);
	if (typeof value.id === "string" && value.status !== void 0) return value;
}
/** A message-only stream/response becomes a completed task-shaped result for the tool layer. */
function taskFromMessage(message) {
	return {
		id: message.taskId ?? "",
		...message.contextId !== void 0 ? { contextId: message.contextId } : {},
		status: {
			state: "TASK_STATE_COMPLETED",
			timestamp: (/* @__PURE__ */ new Date()).toISOString()
		},
		artifacts: [{
			artifactId: `message-${message.messageId}`,
			parts: message.parts
		}]
	};
}
//#endregion
//#region lib/types/outbound/tools.js
/**
* Outbound half: register one remote agent's skills as model-facing tools on
* `ctx.tools`. Tool names are `a2a__<agent>__<skill>` normalized to the DSH
* function-name contract (≤64 chars, collision hash), mirroring the naming
* rule of dsh-mcp-client. An agent advertising zero skills registers nothing.
* Each tool propagates the caller's abort signal, streams the remote turn when
* the remote supports it, and exposes an optional taskId so an interrupted
* remote task can be continued.
* @module dsh-a2a/outbound/tools
*/
function normalizeToolName(raw) {
	const norm = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
	if (norm.length > 0 && /^[A-Za-z0-9_-]+$/.test(norm)) return norm;
	let hash = 0;
	for (let i = 0; i < raw.length; i++) hash = hash * 31 + raw.charCodeAt(i) >>> 0;
	return `_${hash.toString(16)}`;
}
/** Register one tool per advertised skill; empty skills register nothing. */
function registerAgentTools(registrar, opts) {
	const prefix = opts.toolPrefix ?? "a2a";
	const disabled = new Set(opts.disabledSkills ?? []);
	const skills = (opts.client.card.skills ?? []).filter((skill) => !disabled.has(skill.id));
	const out = [];
	for (const skill of skills) {
		const override = opts.skillOverrides?.[skill.id];
		const raw = `${prefix}__${opts.agentName}__${skill.id}`;
		const name = normalizeToolName(raw);
		let toolName = name;
		if (out.some((t) => t.name === toolName)) {
			let hash = 0;
			for (let i = 0; i < raw.length; i++) hash = hash * 31 + raw.charCodeAt(i) >>> 0;
			toolName = `${name.slice(0, 56)}_${hash.toString(16)}`;
		}
		const dispose = registrar.register(makeTool(toolName, opts, skill, override));
		if (dispose) out.push({
			name: toolName,
			dispose
		});
	}
	return out;
}
function makeTool(name, opts, skill, override) {
	return {
		name,
		description: [override?.description ?? skill.description, ...skill.examples?.length ? [`Examples: ${skill.examples.join(" | ")}`] : []].filter(Boolean).join("\n"),
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "The task or instruction to send to the remote agent."
				},
				taskId: {
					type: "string",
					description: "Continue an existing interrupted remote task (use the id reported by a previous INPUT_REQUIRED/AUTH_REQUIRED result)."
				}
			},
			required: ["prompt"]
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: String(value)
			}]
		},
		async execute(args, exec) {
			const contextId = opts.contextFor(exec.agent?.id);
			const message = {
				messageId: crypto.randomUUID(),
				role: Role.USER,
				...args.taskId !== void 0 && args.taskId.length > 0 ? { taskId: args.taskId } : { contextId },
				parts: [{ text: args.prompt }]
			};
			const started = Date.now();
			try {
				const task = await opts.client.sendMessage(message, {
					...exec.signal !== void 0 ? { signal: exec.signal } : {},
					stream: true,
					onEvent: (_frame) => {}
				});
				opts.metrics?.recordOutbound(opts.serverId, skill.id, true, Date.now() - started);
				return textOf(task);
			} catch (err) {
				opts.metrics?.recordOutbound(opts.serverId, skill.id, false, Date.now() - started, err.message);
				throw err;
			}
		}
	};
}
/** Render a settled/interrupted task as tool text (INPUT_REQUIRED surfaced, not thrown). */
function textOf(task) {
	const output = taskOutputText(task);
	if (task.status.state === "TASK_STATE_FAILED") throw new A2AError(-32e3, `Remote agent task failed: ${output || partsToText$1(task.status.message?.parts) || "no detail"}`);
	if (task.status.state === "TASK_STATE_INPUT_REQUIRED" || task.status.state === "TASK_STATE_AUTH_REQUIRED") {
		const ask = partsToText$1(task.status.message?.parts) || output || "agent awaits input";
		return `[remote agent ${task.status.state} task=${task.id}] ${ask}`;
	}
	return output || "(remote agent returned no output)";
}
/**
* Select model-facing output from a remote task. The designated `result`
* artifact wins (structured `data` parts there are a legitimate result); any
* other artifact contributes text parts only, so tool-call or diagnostic data
* can never be spliced into the local tool result.
*/
function taskOutputText(task) {
	const visible = (task.artifacts ?? []).filter((artifact) => artifact.metadata?.["https://github.com/hanphone/dsh-a2a/blob/main/docs/extensions/dsh-trace/v1.md"] === void 0 && artifact.artifactId !== "dsh-a2a/trace");
	const result = visible.filter((artifact) => artifact.artifactId === "result");
	if (result.length > 0) return result.flatMap((artifact) => artifact.parts ?? []).map((part) => partsToText$1([part])).filter(Boolean).join("\n").trim();
	return visible.flatMap((artifact) => artifact.parts ?? []).map((part) => "text" in part && typeof part.text === "string" ? part.text : "").filter((text) => text.length > 0).join("\n").trim();
}
//#endregion
//#region lib/types/outbound/registry.js
/**
* Outbound agent registry: the persisted list of connected remote agents,
* their connection state, and the tool-registration disposers for each live
* connection. Loaded at boot, mutations persist through the agent store.
* @module dsh-a2a/client/registry
*/
/** A list of remote agents, each with live tool registrations when enabled. */
var OutboundAgentRegistry = class {
	opts;
	live = /* @__PURE__ */ new Map();
	views = /* @__PURE__ */ new Map();
	seedRecords;
	constructor(opts) {
		this.opts = opts;
	}
	/** Load persisted records and connect every enabled agent (background). */
	loadAll() {
		const records = this.opts.store.list();
		this.seedRecords = records;
		for (const record of records) if (record.enabled) this.connectRecord(record).catch((err) => {
			this.opts.onError?.(`[a2a] failed to connect "${record.name}": ${err.message}`);
		});
	}
	/**
	* Seed configured agents that the persisted store does not know yet. The
	* store is the runtime state: an existing record (enabled or disabled,
	* present or removed) keeps its state — a disabled agent stays
	* disconnected and a removed one is not resurrected. Only specs with a name
	* absent from the store (and not already live this boot) connect and
	* persist.
	* @param specs - declared agents from the profile config.
	*/
	async seed(specs) {
		const known = new Set(this.opts.store.list().map((r) => r.name));
		for (const connection of this.live.values()) known.add(connection.record.name);
		for (const spec of specs) {
			if (known.has(spec.name)) continue;
			const result = await this.add(spec);
			if (result.ok) known.add(spec.name);
			else this.opts.onError?.(`[a2a] seed agent "${spec.name}": ${result.message}`);
		}
	}
	list() {
		return [...this.views.values()];
	}
	/** Add and connect an agent, persisting the record on success. */
	async add(spec) {
		const record = {
			id: `agent-${crypto.randomUUID()}`,
			name: spec.name,
			agentCardUrl: spec.agentCardUrl,
			...spec.bearerTokenEnv ? { bearerTokenEnv: spec.bearerTokenEnv } : {},
			enabled: spec.enabled ?? true,
			timeoutMs: spec.timeoutMs ?? this.opts.defaultTimeoutMs ?? 6e4,
			lastCardAt: null,
			...spec.disabledSkills !== void 0 ? { disabledSkills: [...spec.disabledSkills] } : {},
			...spec.skillOverrides !== void 0 ? { skillOverrides: { ...spec.skillOverrides } } : {}
		};
		try {
			await this.connectRecord(record);
		} catch (err) {
			this.views.set(record.id, {
				id: record.id,
				name: record.name,
				agentCardUrl: record.agentCardUrl,
				enabled: record.enabled,
				state: "failed",
				skillCount: 0,
				toolCount: 0,
				skills: [],
				lastError: err.message
			});
			return {
				ok: false,
				message: `failed to connect to ${record.agentCardUrl}: ${err.message}`
			};
		}
		this.persist(this.live.get(record.id)?.record ?? record);
		return {
			ok: true,
			message: `agent "${record.name}" connected`
		};
	}
	async remove(id) {
		const live = this.live.get(id);
		const view = this.views.get(id);
		if (live === void 0 && view === void 0) return {
			ok: false,
			message: `agent ${id} not found`
		};
		for (const disposer of live?.disposers ?? []) disposer.dispose();
		this.live.delete(id);
		this.views.delete(id);
		await this.persistAll();
		return {
			ok: true,
			message: `agent ${id} removed`
		};
	}
	async setEnabled(id, enabled) {
		const live = this.live.get(id);
		const view = this.views.get(id);
		if (live === void 0 && view === void 0) return {
			ok: false,
			message: `agent ${id} not found`
		};
		if (enabled && live === void 0) {
			const record = this.findRecord(id);
			if (record === void 0) return {
				ok: false,
				message: `agent ${id} has no persisted record`
			};
			try {
				await this.connectRecord(record);
			} catch (err) {
				return {
					ok: false,
					message: `failed to connect: ${err.message}`
				};
			}
			await this.persistAll();
			return {
				ok: true,
				message: `agent ${id} enabled`
			};
		}
		if (!enabled && live !== void 0) {
			for (const disposer of live.disposers) disposer.dispose();
			this.live.delete(id);
			const current = this.views.get(id);
			if (current !== void 0) this.views.set(id, {
				...current,
				enabled: false,
				state: "disconnected",
				toolCount: 0,
				skillCount: 0,
				skills: current.skills.map((skill) => ({
					...skill,
					enabled: false
				}))
			});
			await this.persistAll();
			return {
				ok: true,
				message: `agent ${id} disabled`
			};
		}
		return {
			ok: true,
			message: `agent ${id} already ${enabled ? "enabled" : "disabled"}`
		};
	}
	async refresh(id) {
		const record = this.findRecord(id) ?? this.live.get(id)?.record;
		if (record === void 0) return {
			ok: false,
			message: `agent ${id} not found`
		};
		const live = this.live.get(id);
		for (const disposer of live?.disposers ?? []) disposer.dispose();
		this.live.delete(id);
		try {
			await this.connectRecord(record);
		} catch (err) {
			const current = this.views.get(id);
			if (current !== void 0) this.views.set(id, {
				...current,
				state: "failed",
				skillCount: 0,
				toolCount: 0,
				skills: [],
				lastError: err.message
			});
			return {
				ok: false,
				message: `refresh failed: ${err.message}`
			};
		}
		await this.persistAll();
		return {
			ok: true,
			message: `agent "${record.name}" reconnected`
		};
	}
	async disposeAll() {
		for (const connection of this.live.values()) for (const disposer of connection.disposers) disposer.dispose();
		this.live.clear();
		this.views.clear();
	}
	async connectRecord(record) {
		const token = await this.opts.tokenOf(record.bearerTokenEnv);
		const client = await A2AClient.connect(record.agentCardUrl, {
			...token ? { bearerToken: token } : {},
			timeoutMs: record.timeoutMs
		});
		const contextByAgent = /* @__PURE__ */ new Map();
		const fallback = `a2a-out-${crypto.randomUUID()}`;
		const contextFor = (agentId) => {
			const key = agentId ?? "\0fallback";
			const existing = contextByAgent.get(key);
			if (existing !== void 0) return existing;
			const id = agentId ? `a2a-out-${crypto.randomUUID()}` : fallback;
			contextByAgent.set(key, id);
			return id;
		};
		const disposers = registerAgentTools(this.opts.registrar, {
			agentName: record.name,
			client,
			...this.opts.toolPrefix !== void 0 ? { toolPrefix: this.opts.toolPrefix } : {},
			contextFor,
			...record.disabledSkills !== void 0 ? { disabledSkills: record.disabledSkills } : {},
			...record.skillOverrides !== void 0 ? { skillOverrides: record.skillOverrides } : {},
			...this.opts.serverId !== void 0 ? { serverId: this.opts.serverId } : {},
			...this.opts.metrics !== void 0 ? { metrics: this.opts.metrics } : {}
		});
		const disabled = new Set(record.disabledSkills ?? []);
		const skills = (client.card.skills ?? []).map((skill) => {
			const override = record.skillOverrides?.[skill.id];
			const description = override?.description ?? skill.description ?? void 0;
			return {
				id: skill.id,
				name: override?.name ?? skill.name,
				...description !== void 0 ? { description } : {},
				enabled: !disabled.has(skill.id)
			};
		});
		const updated = {
			...record,
			lastCardAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		const skillCount = skills.filter((skill) => skill.enabled).length;
		this.live.set(updated.id, {
			record: updated,
			client,
			disposers,
			skillCount,
			skills
		});
		this.views.set(updated.id, {
			id: updated.id,
			name: updated.name,
			agentCardUrl: updated.agentCardUrl,
			enabled: updated.enabled,
			state: "connected",
			skillCount,
			toolCount: disposers.length,
			skills,
			...client.card.version !== void 0 ? { agentVersion: client.card.version } : {}
		});
		try {
			const next = [...this.opts.store.list().filter((r) => r.id !== updated.id), updated];
			await this.opts.store.save(next);
		} catch (err) {
			this.opts.onError?.(`[a2a] failed to persist agent card timestamp: ${String(err)}`);
		}
	}
	findRecord(id) {
		const current = () => this.opts.store.list().find((r) => r.id === id);
		return current() ?? this.seedRecords?.find((r) => r.id === id);
	}
	persist(record) {
		const next = [...this.opts.store.list().filter((r) => r.id !== record.id), record];
		this.opts.store.save(next).catch((err) => {
			this.opts.onError?.(`[a2a] failed to persist agent list: ${String(err)}`);
		});
	}
	async persistAll() {
		const liveRecords = [...this.live.values()].map((c) => c.record);
		const liveIds = new Set(liveRecords.map((r) => r.id));
		const kept = this.opts.store.list().filter((r) => !liveIds.has(r.id) && this.views.has(r.id)).map((r) => {
			const view = this.views.get(r.id);
			return view === void 0 ? r : {
				...r,
				enabled: view.enabled
			};
		});
		await this.opts.store.save([...kept, ...liveRecords]);
	}
};
//#endregion
//#region lib/types/servers/outbound-manager.js
/**
* Outbound server manager: owns every outbound A2A connection instance. Each
* instance is one connected remote — its own AgentCard URL, auth env, timeout,
* creator-declared name, and an optional agent-preset binding. Each live
* instance is one `OutboundAgentRegistry` with an isolated per-instance agent
* store; enabled instances map their remote skills to `a2a__<name>__<skill>`
* model tools. The manager owns the full lifecycle (add/enable/disable/remove/
* refresh) driven from the GUI and facade, persists each instance in the
* `outbound_servers` domain table, and disposes every connection on teardown.
*
* The `preset` field names the agent preset this DSH would compose its local
* hand-off session with when driving that remote. P0 connects skills to tools
* and manages the connection; the hand-off session composition behind `preset`
* is a documented extension point (the outbound tools currently call the
* remote directly) and the value is persisted metadata surfaced to the GUI.
* @module dsh-a2a/servers/outbound-manager
*/
/** An `AgentStore` bound to one outbound server instance's agents-table key. */
var ServerAgentStore = class {
	table;
	key;
	constructor(table, key) {
		this.table = table;
		this.key = key;
	}
	list() {
		const raw = this.table.get(this.key);
		if (raw === void 0 || raw === "") return [];
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	async save(records) {
		await this.table.put(this.key, JSON.stringify(records));
	}
};
/** Persisted-instance store over the outbound_servers table. */
var DomainOutboundStore = class DomainOutboundStore {
	table;
	static KEY(id) {
		return `out:${id}`;
	}
	constructor(table) {
		this.table = table;
	}
	list() {
		const out = [];
		const entries = this.table.entries;
		if (entries === void 0) return out;
		for (const [key, raw] of entries.call(this.table)) {
			if (!key.startsWith("out:")) continue;
			const parsed = safeParse(raw);
			if (parsed !== void 0) out.push(parsed);
		}
		return out;
	}
	get(id) {
		const raw = this.table.get(DomainOutboundStore.KEY(id));
		return raw === void 0 ? void 0 : safeParse(raw);
	}
	async save(record) {
		await this.table.put(DomainOutboundStore.KEY(record.id), JSON.stringify(record));
	}
	async remove(id) {
		await this.table.put(DomainOutboundStore.KEY(id), "");
	}
};
function safeParse(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed.id !== "string" || typeof parsed.name !== "string" || typeof parsed.agentCardUrl !== "string") return void 0;
		return parsed;
	} catch {
		return;
	}
}
/** The managed env-var name backing one outbound instance's auth token. */
function outboundAuthEnv(id) {
	return `A2A_OUTBOUND_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}
/** Manages the live set of outbound connection instances. */
var OutboundServerManager = class {
	host;
	agentSink;
	records;
	newId;
	registries = /* @__PURE__ */ new Map();
	timers = /* @__PURE__ */ new Map();
	constructor(host, agentSink, records, newId) {
		this.host = host;
		this.agentSink = agentSink;
		this.records = records;
		this.newId = newId;
	}
	/** The host default connection timeout (what a minimal record falls back to). */
	get defaultTimeoutMs() {
		return this.host.defaultTimeoutMs;
	}
	agentKeyFor(id) {
		return `out:${id}`;
	}
	makeRegistry(record) {
		return new OutboundAgentRegistry({
			registrar: { register: (def) => this.host.registrar.register(def) },
			store: new ServerAgentStore(this.agentSink, this.agentKeyFor(record.id)),
			toolPrefix: "a2a",
			defaultTimeoutMs: this.host.defaultTimeoutMs,
			tokenOf: (env) => this.host.tokenOf(env),
			onError: this.host.onError,
			serverId: record.id,
			...this.host.metrics !== void 0 ? { metrics: this.host.metrics } : {}
		});
	}
	/** Record → registry spec for connecting one instance. */
	toSpec(record) {
		return {
			name: record.name,
			agentCardUrl: record.agentCardUrl,
			...record.bearerTokenEnv !== void 0 ? { bearerTokenEnv: record.bearerTokenEnv } : {},
			enabled: record.enabled,
			timeoutMs: record.timeoutMs ?? this.host.defaultTimeoutMs,
			...record.disabledSkills !== void 0 ? { disabledSkills: record.disabledSkills } : {},
			...record.skillOverrides !== void 0 ? { skillOverrides: record.skillOverrides } : {}
		};
	}
	/** Boot every persisted enabled instance as a connected registry. */
	boot() {
		for (const record of this.records.list()) try {
			const registry = this.makeRegistry(record);
			this.registries.set(record.id, registry);
			if (record.enabled) {
				registry.loadAll();
				this.schedule(record.id);
			}
		} catch (err) {
			this.host.onError(`[a2a:out:${record.id}] failed to boot: ${String(err.message)}`);
		}
	}
	/** One view per live instance (enriched from its registry / record). */
	list() {
		return [...this.registries.keys()].map((id) => this.viewFor(id)).filter((v) => v !== void 0);
	}
	get(id) {
		const registry = this.registries.get(id);
		return registry === void 0 ? void 0 : {
			id,
			registry
		};
	}
	viewFor(id) {
		const registry = this.registries.get(id);
		const record = this.records.get(id);
		if (registry === void 0 || record === void 0) return void 0;
		const agent = registry.list()[0];
		return {
			id,
			name: record.name,
			agentCardUrl: record.agentCardUrl,
			...record.preset !== void 0 ? { preset: record.preset } : {},
			enabled: agent?.enabled ?? record.enabled,
			timeoutMs: record.timeoutMs,
			state: agent?.state ?? "disconnected",
			skillCount: agent?.skillCount ?? 0,
			toolCount: agent?.toolCount ?? 0,
			skills: agent?.skills ?? [],
			...agent?.agentVersion !== void 0 ? { agentVersion: agent.agentVersion } : {},
			...agent?.lastError !== void 0 ? { lastError: agent.lastError } : {},
			...record.lastCardAt !== void 0 ? { lastCardAt: record.lastCardAt } : {}
		};
	}
	/** Create, persist, and connect a new outbound instance. */
	async add(input) {
		const record = {
			id: input.id ?? this.newId(),
			name: input.name,
			agentCardUrl: input.agentCardUrl,
			...input.bearerTokenEnv !== void 0 ? { bearerTokenEnv: input.bearerTokenEnv } : {},
			...input.preset !== void 0 ? { preset: input.preset } : {},
			enabled: input.enabled ?? true,
			timeoutMs: input.timeoutMs ?? this.host.defaultTimeoutMs,
			...input.disabledSkills !== void 0 ? { disabledSkills: [...input.disabledSkills] } : {},
			...input.skillOverrides !== void 0 ? { skillOverrides: { ...input.skillOverrides } } : {}
		};
		if (this.registries.has(record.id)) return {
			ok: false,
			message: `outbound server ${record.id} already exists`
		};
		const registry = this.makeRegistry(record);
		await this.records.save(record);
		this.registries.set(record.id, registry);
		if (record.enabled) {
			const result = await registry.add(this.toSpec(record));
			if (result.ok) {
				await this.records.save({
					...record,
					lastCardAt: (/* @__PURE__ */ new Date()).toISOString()
				});
				this.schedule(record.id);
			}
			return result.ok ? {
				...result,
				id: record.id
			} : result;
		}
		return {
			ok: true,
			message: `outbound server "${record.name}" added (disabled)`,
			id: record.id
		};
	}
	async setEnabled(id, enabled) {
		const registry = this.registries.get(id);
		if (registry === void 0) return {
			ok: false,
			message: `outbound server ${id} not found`
		};
		const view = registry.list()[0];
		const record = this.records.get(id);
		if (record !== void 0) await this.records.save({
			...record,
			enabled
		});
		if (view === void 0) return {
			ok: true,
			message: `outbound server ${id} marked ${enabled ? "enabled" : "disabled"}`
		};
		const result = await registry.setEnabled(view.id, enabled);
		if (result.ok) this.schedule(id);
		return result;
	}
	/** Read a remote AgentCard for the two-phase add preview (no state change). */
	async discover(agentCardUrl, bearerToken) {
		try {
			const client = await A2AClient.connect(agentCardUrl, {
				...bearerToken !== void 0 && bearerToken.length > 0 ? { bearerToken } : {},
				timeoutMs: this.host.defaultTimeoutMs
			});
			const url = client.card.supportedInterfaces?.[0]?.url ?? agentCardUrl;
			return {
				ok: true,
				message: `discovered "${client.card.name}"`,
				preview: {
					name: client.card.name,
					...client.card.version !== void 0 ? { version: client.card.version } : {},
					...client.card.description != null ? { description: client.card.description } : {},
					endpoint: url,
					skills: (client.card.skills ?? []).map((s) => ({
						id: s.id,
						name: s.name,
						...s.description != null ? { description: s.description } : {}
					}))
				}
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to discover ${agentCardUrl}: ${String(err.message)}`
			};
		}
	}
	/** Edit a live instance's name/preset/timeout (persist + rebuild if connected). */
	async update(id, patch) {
		const registry = this.registries.get(id);
		const stored = this.records.get(id);
		if (registry === void 0 || stored === void 0) return {
			ok: false,
			message: `outbound server ${id} not found`
		};
		const next = {
			...stored,
			name: patch.name ?? stored.name,
			...patch.preset !== void 0 ? { preset: patch.preset } : {},
			...patch.timeoutMs !== void 0 ? { timeoutMs: patch.timeoutMs } : {},
			...patch.disabledSkills !== void 0 ? { disabledSkills: [...patch.disabledSkills] } : {},
			...patch.skillOverrides !== void 0 ? { skillOverrides: { ...patch.skillOverrides } } : {}
		};
		try {
			await this.records.save(next);
			const rebuilt = this.makeRegistry(next);
			await registry.disposeAll();
			this.registries.set(id, rebuilt);
			if (next.enabled) {
				const result = await rebuilt.add(this.toSpec(next));
				if (!result.ok) this.host.onError(`[a2a:out:${id}] update rebuild: ${result.message}`);
			}
			this.schedule(id);
			return {
				ok: true,
				message: `outbound server ${id} updated`
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to update outbound server: ${String(err.message)}`
			};
		}
	}
	async remove(id) {
		const registry = this.registries.get(id);
		if (registry === void 0) return {
			ok: false,
			message: `outbound server ${id} not found`
		};
		this.clearTimer(id);
		const view = registry.list()[0];
		if (view !== void 0) await registry.remove(view.id);
		await registry.disposeAll();
		this.registries.delete(id);
		await this.records.remove(id);
		return {
			ok: true,
			message: `outbound server ${id} removed`
		};
	}
	async refresh(id) {
		const registry = this.registries.get(id);
		if (registry === void 0) return {
			ok: false,
			message: `outbound server ${id} not found`
		};
		const view = registry.list()[0];
		if (view === void 0) return {
			ok: false,
			message: `outbound server ${id} has no connected agent`
		};
		const result = await registry.refresh(view.id);
		if (result.ok) {
			const record = this.records.get(id);
			if (record !== void 0) await this.records.save({
				...record,
				lastCardAt: (/* @__PURE__ */ new Date()).toISOString()
			});
		}
		return result;
	}
	/**
	* Set (or clear) an outbound instance's bearer token: written to the
	* credentials service under this instance's managed env-var name, the record
	* stores only that name, and the connection is rebuilt so the new token
	* takes effect.
	*/
	async setAuth(id, token) {
		const registry = this.registries.get(id);
		const record = this.records.get(id);
		if (registry === void 0 || record === void 0) return {
			ok: false,
			message: `outbound server ${id} not found`
		};
		const credentials = this.host.credentials;
		const envName = outboundAuthEnv(id);
		try {
			let next;
			if (token === void 0 || token.length === 0) {
				if (credentials !== void 0) await credentials.unset(envName);
				const { bearerTokenEnv: _dropped, ...rest } = record;
				next = rest;
			} else {
				if (credentials === void 0) return {
					ok: false,
					message: "credentials service not mounted; cannot store the token (set the env var externally instead)"
				};
				await credentials.set(envName, token);
				next = {
					...record,
					bearerTokenEnv: envName
				};
			}
			await this.records.save(next);
			const rebuilt = this.makeRegistry(next);
			await registry.disposeAll();
			this.registries.set(id, rebuilt);
			if (next.enabled) {
				const result = await rebuilt.add(this.toSpec(next));
				if (!result.ok) this.host.onError(`[a2a:out:${id}] auth rebuild: ${result.message}`);
			}
			this.schedule(id);
			return {
				ok: true,
				message: `outbound server ${id} auth ${token ? "set" : "cleared"} (${envName})`
			};
		} catch (err) {
			return {
				ok: false,
				message: `failed to set outbound auth: ${String(err.message)}`
			};
		}
	}
	/** Start/refresh the automatic card-refresh timer for one instance. */
	schedule(id) {
		this.clearTimer(id);
		const interval = this.host.refreshIntervalMs ?? 0;
		if (interval <= 0) return;
		const record = this.records.get(id);
		if (record === void 0 || !record.enabled) return;
		const timer = setInterval(() => {
			const current = this.records.get(id);
			if (current === void 0 || !current.enabled) {
				this.clearTimer(id);
				return;
			}
			this.refresh(id).then((result) => {
				if (!result.ok) this.host.onError(`[a2a:out:${id}] scheduled refresh: ${result.message}`);
			}).catch((err) => {
				this.host.onError(`[a2a:out:${id}] scheduled refresh failed: ${String(err)}`);
			});
		}, interval);
		timer.unref?.();
		this.timers.set(id, timer);
	}
	clearTimer(id) {
		const timer = this.timers.get(id);
		if (timer !== void 0) clearInterval(timer);
		this.timers.delete(id);
	}
	async disposeAll() {
		for (const id of [...this.timers.keys()]) this.clearTimer(id);
		for (const registry of this.registries.values()) await registry.disposeAll();
		this.registries.clear();
	}
};
//#endregion
//#region lib/types/index.js
/**
* @lf17708152275/dsh-a2a — Cordis plugin entry.
*
* Mounts the A2A v1.0.1 dual-end plugin as a MULTI-INSTANCE composition: an
* arbitrary set of inbound A2A servers (each a preset-bound session pool, its
* own endpoint + AgentCard + creator-declared skills + auth) and an arbitrary
* set of outbound A2A connections (each a remote URL + preset + timeout).
* Instances are persisted in the `a2a` domain (`inbound_servers` /
* `outbound_servers` tables) and created/edited/started/stopped entirely from
* the GUI — the plugin `Config` is minimal and instance setup is not
* patch-config driven. The protocol surface is aligned with the official A2A
* v1.0.1 spec (see docs/reference/http-api.md).
*
* Optional services are probed rather than injected so a composition lacking
* one half idles just that half; only the storage domain is required.
*
* Function-plugin export shape: named `name`/`inject`/`Config`/`apply`, no
* default export (mixing forms makes the Loader drop the namespace).
* @module dsh-a2a
*/
const name = "a2a";
/** Only the storage domain is required; the other halves are probed. */
const inject = ["storageDomain"];
/** Loader-validated config schema (defaults applied by the Loader). */
const Config = z.object({
	baseUrl: z.string(),
	subagentProvider: z.string().default("in-process"),
	defaultTimeoutMs: z.number().default(6e4),
	inboundTimeoutMs: z.number().default(6e5),
	requestsPerMinute: z.number().default(120),
	maxConcurrentTasks: z.number().default(32),
	maxBodyBytes: z.number().default(1048576),
	outboundRefreshMs: z.number().default(3e5),
	inboundTrace: z.boolean().default(false)
});
function apply(ctx, config) {
	const logger = ctx.logger("a2a");
	const subagentProvider = config.subagentProvider;
	const inboundCwd = inboundSessionCwd();
	const updateChecker = createUpdateChecker({ packageRoot: pluginPackageRoot() });
	ctx.inject(["storageDomain"], (ctx) => {
		ctx.effect(async () => {
			const domain = await openDomain(ctx.storageDomain);
			const store = new DomainTaskStore(domain);
			const webServer = probeService(ctx, "webServer", "register");
			const tools = probeService(ctx, "tools", "register");
			const agents = probeService(ctx, "agents", "create");
			const agentPresets = probeService(ctx, "agentPresets", "list");
			const skills = probeService(ctx, "skills", "list");
			const credentials = probeService(ctx, "credentials", "resolve");
			const subagents = probeService(ctx, "subagents", "start");
			const attachments = probeService(ctx, "attachments", "admitPromptContent");
			const metrics = new A2aMetrics();
			const commandsRef = probeService(ctx, "commands", "register");
			const loopbackBaseUrl = () => `http://127.0.0.1:${webServerPort(webServer) ?? process.env["DSH_A2A_PORT"] ?? "3000"}`;
			const reviveArchivedSession = async (sessionId) => {
				const registry = probeService(ctx, "workspaceRegistry", "unarchiveSession");
				if (registry === void 0) return;
				if (!(registry.archivedSessionIds ?? []).some((id) => String(id) === sessionId)) return;
				await registry.unarchiveSession(sessionId);
				logger.info(`[a2a] revived archived session ${sessionId}`);
			};
			/**
			* Title a fresh inbound session with the context id the bridge bound it to,
			* so the dashboard list reads `wx3-...` instead of an opaque session id.
			*/
			const nameInboundSession = async (sessionId, contextId) => {
				await nameNewSession(probeService(ctx, "sessionController", "rename"), sessionId, contextId, { onError: (error) => logger.warn(`[a2a] could not title inbound session ${sessionId}: ${error.message}`) });
			};
			const adoptSessionsInto = async (cwd, sessionIds) => {
				const registry = probeService(ctx, "workspaceRegistry", "resolveByPath");
				if (registry === void 0) return 0;
				try {
					return await adoptSessions(await registry.resolveByPath(cwd), sessionIds);
				} catch (error) {
					logger.warn(`[a2a] workspace accounting failed for ${cwd}: ${error.message}`);
					return 0;
				}
			};
			const knownInboundSessionIds = () => {
				const ids = [];
				try {
					for (const [, raw] of domain.contexts.entries()) try {
						const parsed = JSON.parse(raw);
						if (typeof parsed.sessionId === "string") ids.push(parsed.sessionId);
					} catch {}
				} catch {}
				return ids;
			};
			let workspaceSwept = false;
			const ensureInboundWorkspace = () => registerDefaultWorkspace(probeService(ctx, "workspaceRegistry", "create"), inboundCwd, {
				onRegistered: (dir) => logger.info(`[a2a] default inbound workspace registered: ${dir}`),
				onError: (dir, error) => logger.warn(`[a2a] default inbound workspace registration failed for ${dir}: ${error.message}`)
			}).then(async (status) => {
				if (status === "registered" && !workspaceSwept) {
					workspaceSwept = true;
					const adopted = await adoptSessionsInto(inboundCwd, knownInboundSessionIds());
					if (adopted > 0) logger.info(`[a2a] adopted ${adopted} existing inbound session(s) into the default workspace`);
				}
				return status;
			});
			let deploymentSettings = readDeploymentSettings(domain);
			const effectiveBaseUrl = () => deploymentSettings?.baseUrl ?? config.baseUrl ?? loopbackBaseUrl();
			const inboundManager = new InboundServerManager({
				ctx,
				webServer: webServer ?? { register: noopRegister },
				tasks: store,
				logger,
				...agents !== void 0 ? { agents } : {},
				...agentPresets !== void 0 ? { agentPresets } : {},
				...skills !== void 0 ? { skills } : {},
				...credentials !== void 0 ? { credentials } : {},
				...subagents !== void 0 ? { subagents } : {},
				...attachments !== void 0 ? { attachments } : {},
				metrics,
				taskTimeoutMs: config.inboundTimeoutMs,
				requestsPerMinute: config.requestsPerMinute,
				maxConcurrentTasks: config.maxConcurrentTasks,
				maxBodyBytes: config.maxBodyBytes,
				...agentPresets?.defaultId !== void 0 ? { defaultPresetId: agentPresets.defaultId } : {},
				resolveDefaultModel: () => resolveDefaultModel(ctx),
				reviveArchivedSession,
				onSessionOpened: async (info) => {
					await adoptSessionsInto(info.cwd, [info.sessionId]);
					await nameInboundSession(info.sessionId, info.contextId);
				},
				sessionCwd: inboundCwd,
				defaultBaseUrl: effectiveBaseUrl,
				subagentProvider,
				inboundTrace: config.inboundTrace,
				newId: () => crypto.randomUUID().slice(0, 8),
				get webPort() {
					return String(webServerPort(webServer) ?? process.env["DSH_A2A_PORT"] ?? "3000");
				}
			}, new DomainInboundStore(domain.inbound_servers));
			await inboundManager.boot();
			let workspaceRegTimer;
			let workspaceRegAttempts = 0;
			const attemptWorkspaceRegistration = async () => {
				workspaceRegAttempts += 1;
				if (await ensureInboundWorkspace() !== "unavailable") return;
				if (workspaceRegAttempts >= WORKSPACE_REGISTRATION_ATTEMPTS) {
					logger.warn("[a2a] workspace registry stayed unavailable; default inbound sessions are not listed");
					return;
				}
				workspaceRegTimer = setTimeout(() => void attemptWorkspaceRegistration(), 500);
			};
			attemptWorkspaceRegistration();
			const outboundManager = new OutboundServerManager({
				registrar: { register: (def) => tools?.register(def) },
				tokenOf: async (env) => env ? await resolveAuthToken(credentials, env) : void 0,
				...credentials !== void 0 ? { credentials } : {},
				onError: (message) => logger.warn(message),
				defaultTimeoutMs: config.defaultTimeoutMs,
				refreshIntervalMs: config.outboundRefreshMs,
				metrics
			}, domain.agents, new DomainOutboundStore(domain.outbound_servers), () => `out-${crypto.randomUUID().slice(0, 12)}`);
			outboundManager.boot();
			const impl = makeFacade({
				domain,
				store,
				inboundManager,
				outboundManager,
				agentPresets,
				metrics,
				logger: logger.info.bind(logger),
				listModels: () => listAvailableModels(ctx),
				modelDiagnostics: async () => (await probeModelCatalogue(ctx)).diagnostics,
				listTools: () => listAvailableTools(ctx),
				defaultBaseUrl: effectiveBaseUrl,
				...config.baseUrl !== void 0 ? { configBaseUrl: config.baseUrl } : {},
				deploymentSettings: () => deploymentSettings,
				ensureInboundWorkspace,
				updateDeploymentSettings: async (patch) => {
					const current = deploymentSettings ?? {};
					const raw = patch.baseUrl ?? "";
					let next;
					if (raw.trim().length === 0) {
						const { baseUrl: _cleared, ...rest } = current;
						next = rest;
					} else {
						const checked = validateBaseUrl(raw);
						if (!checked.ok) return {
							ok: false,
							message: checked.message
						};
						next = {
							...current,
							...checked.value !== void 0 ? { baseUrl: checked.value } : {}
						};
					}
					try {
						await writeDeploymentSettings(domain, next);
					} catch (err) {
						return {
							ok: false,
							message: `failed to persist settings: ${String(err)}`
						};
					}
					deploymentSettings = next;
					for (const live of inboundManager.list()) await inboundManager.update(live.id, {});
					return {
						ok: true,
						message: `advertised base URL: ${next.baseUrl ?? "inherit (plugin config)"}`
					};
				}
			});
			new A2AService(ctx, impl);
			if (commandsRef !== void 0) ctx.effect(() => commandsRef.register(buildA2aCommand(impl)), "a2a: command");
			if (webServer !== void 0) ctx.effect(() => webServer.register({
				kind: "prefix",
				path: "/a2a/api",
				handler: (req, res) => handleApiRequest(req, res, impl, updateChecker)
			}), "a2a: dashboard api");
			else logger.warn("a2a: webServer not mounted; GUI dashboard API idle");
			return async () => {
				if (workspaceRegTimer !== void 0) clearTimeout(workspaceRegTimer);
				inboundManager.disposeAll();
				await outboundManager.disposeAll();
				await domain.close();
			};
		}, "a2a: multi-instance composition");
	});
}
/** Facade closure over the two managers (commands and `ctx.a2a` consumers). */
function makeFacade(host) {
	/** Log the capability projection once per plugin lifetime, not per snapshot. */
	let capabilitiesLogged = false;
	/** Current deployment default base URL (`auto` or a concrete origin). */
	const hostBaseUrl = () => {
		const source = host.defaultBaseUrl;
		if (source === void 0) return void 0;
		return typeof source === "function" ? source() : source;
	};
	const inboundView = (id) => {
		const live = host.inboundManager.get(id);
		if (live === void 0) return void 0;
		const r = live.record;
		const effectiveBaseUrl = r.baseUrl ?? hostBaseUrl();
		const autoBaseUrl = effectiveBaseUrl === "auto";
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			version: r.version,
			endpointPath: live.endpointPath,
			...live.preset !== void 0 ? { preset: live.preset } : {},
			...r.preset !== void 0 ? { presetOverride: r.preset } : {},
			...r.authTokenEnv !== void 0 ? { authTokenEnv: r.authTokenEnv } : {},
			cardPath: live.cardPath,
			...!autoBaseUrl && live.card.supportedInterfaces?.[0]?.url !== void 0 ? { cardUrl: live.card.supportedInterfaces[0].url } : {},
			enabled: live.routes.active,
			trace: live.traceEnabled,
			...r.workspace !== void 0 ? { workspace: r.workspace } : {},
			...r.provider !== void 0 ? { provider: r.provider } : {},
			...r.model !== void 0 ? { model: r.model } : {},
			...r.toolAllow !== void 0 ? { toolAllow: r.toolAllow } : {},
			...effectiveBaseUrl !== void 0 ? { baseUrl: effectiveBaseUrl } : {},
			skills: live.skills.map((s) => ({
				id: s.id,
				name: s.name,
				...s.description != null ? { description: s.description } : {}
			}))
		};
	};
	const cancelContextTasks = (contextId, serverId) => {
		let canceled = 0;
		for (const task of host.store.list()) {
			if (task.contextId !== contextId || isTerminal(task.state)) continue;
			if (serverId !== void 0 && task.serverId !== serverId) continue;
			for (const live of host.inboundManager.list()) if (live.server.abort(task.taskId)) {
				canceled += 1;
				break;
			}
		}
		return canceled;
	};
	const sessionViews = () => aggregateSessionViews(host.store.list(), host.inboundManager.list());
	const audit = (kind, detail, serverId) => {
		host.metrics.recordAudit({
			kind,
			detail,
			...serverId !== void 0 ? { serverId } : {}
		});
	};
	const taskPage = (query = {}) => {
		const filtered = host.store.list().filter((task) => query.serverId === void 0 || task.serverId === query.serverId).filter((task) => query.contextId === void 0 || task.contextId === query.contextId).filter((task) => query.state === void 0 || task.state === query.state).sort((a, b) => a.updatedAt === b.updatedAt ? a.taskId < b.taskId ? 1 : -1 : a.updatedAt < b.updatedAt ? 1 : -1);
		const limit = Math.max(1, Math.min(200, Math.floor(query.limit ?? 50)));
		const offset = Math.max(0, Math.floor(query.offset ?? 0));
		const tasks = filtered.slice(offset, offset + limit);
		return {
			tasks,
			total: filtered.length,
			nextOffset: offset + tasks.length < filtered.length ? offset + tasks.length : null
		};
	};
	return {
		status() {
			return {
				inbounds: host.inboundManager.list().map((live) => inboundView(live.id)).filter((v) => v !== void 0),
				outbounds: host.outboundManager.list(),
				tasks: host.store.list().length,
				sessions: sessionViews()
			};
		},
		async models() {
			try {
				return await host.listModels?.() ?? [];
			} catch {
				return [];
			}
		},
		async tools() {
			try {
				return [...await host.listTools?.() ?? []];
			} catch {
				return [];
			}
		},
		async modelDiagnostics() {
			try {
				return await host.modelDiagnostics?.() ?? { reason: "no diagnostics hook" };
			} catch (err) {
				return { reason: `diagnostics threw: ${err.message}` };
			}
		},
		settings() {
			const storedBaseUrl = host.deploymentSettings?.()?.baseUrl;
			return {
				mode: storedBaseUrl === "auto" ? "auto" : storedBaseUrl !== void 0 ? "custom" : "inherit",
				...storedBaseUrl !== void 0 ? { baseUrl: storedBaseUrl } : {},
				effectiveBaseUrl: hostBaseUrl() ?? "",
				...host.configBaseUrl !== void 0 ? { configBaseUrl: host.configBaseUrl } : {},
				candidates: discoverBaseUrlCandidates()
			};
		},
		async updateSettings(patch) {
			const apply = host.updateDeploymentSettings;
			if (apply === void 0) return {
				ok: false,
				message: "deployment settings are not editable in this composition"
			};
			return apply(patch);
		},
		async presets() {
			if (host.agentPresets === void 0) return [];
			const defaultId = host.agentPresets.defaultId;
			let rows;
			try {
				rows = await host.agentPresets.list();
			} catch {
				return [];
			}
			let compositions;
			if (host.agentPresets.compositionInventory !== void 0) try {
				compositions = await host.agentPresets.compositionInventory();
			} catch {
				compositions = void 0;
			}
			let capabilities = presetCapabilities(rows, compositions);
			let source = compositions === void 0 ? "unavailable" : "inventory";
			const described = (projection) => [...projection.values()].filter((capability) => capability.plugins.length > 0).length;
			if (described(capabilities) === 0 && host.agentPresets.inspectCompositions !== void 0) try {
				capabilities = capabilitiesFromInspections(rows, host.agentPresets.inspectCompositions());
				source = "inspection";
			} catch {
				source = "unavailable";
			}
			if (!capabilitiesLogged) {
				capabilitiesLogged = true;
				host.logger(`[a2a] preset capabilities: source=${source}, presets=${rows.length}, with-plugins=${described(capabilities)}`);
			}
			return rows.map((preset) => {
				const capability = capabilities.get(preset.id);
				return {
					id: preset.id,
					...preset.name !== void 0 ? { name: preset.name } : {},
					...preset.description !== void 0 ? { description: preset.description } : {},
					...defaultId !== void 0 && preset.id === defaultId ? { isDefault: true } : {},
					...capability?.broken === true ? { broken: true } : {},
					...capability !== void 0 ? { plugins: capability.plugins } : {}
				};
			});
		},
		listInboundServers() {
			return host.inboundManager.list().map((live) => inboundView(live.id)).filter((v) => v !== void 0);
		},
		async createInboundServer(input) {
			if (input.workspace === void 0 || input.workspace.trim().length === 0) await host.ensureInboundWorkspace?.();
			const result = await host.inboundManager.add({
				name: input.name,
				description: input.description,
				version: input.version,
				...input.endpointPath !== void 0 ? { endpointPath: input.endpointPath } : {},
				...input.preset !== void 0 ? { preset: input.preset } : {},
				...input.authTokenEnv !== void 0 ? { authTokenEnv: input.authTokenEnv } : {},
				...input.trace !== void 0 ? { trace: input.trace } : {},
				...input.enabled !== void 0 ? { enabled: input.enabled } : {},
				...input.workspace !== void 0 ? { workspace: input.workspace } : {},
				...input.provider !== void 0 ? { provider: input.provider } : {},
				...input.model !== void 0 ? { model: input.model } : {},
				...input.toolAllow !== void 0 ? { toolAllow: input.toolAllow } : {},
				...input.baseUrl !== void 0 ? { baseUrl: input.baseUrl } : {}
			});
			host.logger(`[a2a] inbound created: ${result.message}`);
			audit("inbound.create", result.message, result.id);
			return result;
		},
		async removeInboundServer(id) {
			const result = await host.inboundManager.remove(id);
			audit("inbound.remove", result.message, id);
			return result;
		},
		async setInboundServerEnabled(id, enabled) {
			const result = host.inboundManager.setEnabled(id, enabled);
			audit("inbound.enable", result.message, id);
			return result;
		},
		async updateInboundServer(id, patch) {
			if (patch.workspace !== void 0 && patch.workspace.trim().length === 0) await host.ensureInboundWorkspace?.();
			const result = await host.inboundManager.update(id, patch);
			audit("inbound.update", result.message, id);
			return result;
		},
		async setInboundAuth(id, token) {
			const result = await host.inboundManager.setAuth(id, token);
			audit("inbound.setAuth", result.message, id);
			return result;
		},
		agentCard(id) {
			return host.inboundManager.get(id)?.card;
		},
		async sendTestMessage(id, input) {
			const live = host.inboundManager.get(id);
			if (live === void 0) throw new Error(`inbound server ${id} not found`);
			const message = {
				messageId: crypto.randomUUID(),
				role: Role.USER,
				...input.contextId !== void 0 ? { contextId: input.contextId } : {},
				parts: [{ text: input.text }],
				...input.skill !== void 0 ? { metadata: { skill: input.skill } } : {}
			};
			return live.server.sendTest(message);
		},
		listOutboundServers() {
			return [...host.outboundManager.list()];
		},
		async createOutboundServer(input) {
			const result = await host.outboundManager.add({
				...input.id !== void 0 ? { id: input.id } : {},
				name: input.name,
				agentCardUrl: input.agentCardUrl,
				...input.bearerTokenEnv !== void 0 ? { bearerTokenEnv: input.bearerTokenEnv } : {},
				...input.preset !== void 0 ? { preset: input.preset } : {},
				enabled: input.enabled ?? true,
				timeoutMs: input.timeoutMs ?? host.outboundManager.defaultTimeoutMs,
				...input.disabledSkills !== void 0 ? { disabledSkills: input.disabledSkills } : {},
				...input.skillOverrides !== void 0 ? { skillOverrides: input.skillOverrides } : {}
			});
			audit("outbound.create", result.message, result.id);
			return result;
		},
		async removeOutboundServer(id) {
			const result = await host.outboundManager.remove(id);
			audit("outbound.remove", result.message, id);
			return result;
		},
		async setOutboundServerEnabled(id, enabled) {
			const result = await host.outboundManager.setEnabled(id, enabled);
			audit("outbound.enable", result.message, id);
			return result;
		},
		async refreshOutboundServer(id) {
			const result = await host.outboundManager.refresh(id);
			audit("outbound.refresh", result.message, id);
			return result;
		},
		async setOutboundAuth(id, token) {
			const result = await host.outboundManager.setAuth(id, token);
			audit("outbound.setAuth", result.message, id);
			return result;
		},
		async discoverOutbound(url, bearerToken) {
			return host.outboundManager.discover(url, bearerToken);
		},
		async updateOutboundServer(id, patch) {
			const result = await host.outboundManager.update(id, patch);
			audit("outbound.update", result.message, id);
			return result;
		},
		getTask(taskId) {
			return host.store.get(taskId);
		},
		listTasks(query) {
			return taskPage(query);
		},
		async cancelTask(taskId) {
			const live = host.inboundManager.list().find((l) => l.server.abort(taskId));
			return {
				ok: live !== void 0,
				message: live !== void 0 ? `task ${taskId} canceled` : `task ${taskId} not found or already terminal`
			};
		},
		listSessions() {
			return sessionViews();
		},
		async cancelSessionTasks(contextId, serverId) {
			const canceled = cancelContextTasks(contextId, serverId);
			return {
				ok: true,
				message: canceled > 0 ? `session ${contextId}: canceled ${canceled} active task(s)` : `session ${contextId}: no active tasks`
			};
		},
		async closeSession(contextId, serverId) {
			const canceled = cancelContextTasks(contextId, serverId);
			let closed = 0;
			for (const live of host.inboundManager.list()) {
				if (serverId !== void 0 && live.id !== serverId) continue;
				if (live.sessionPool !== void 0 && live.sessionPool.has(contextId)) {
					await live.sessionPool.disposeContext(contextId);
					closed += 1;
				}
			}
			const parts = [...canceled > 0 ? [`canceled ${canceled} active task(s)`] : [], ...closed > 0 ? [`closed ${closed} live session(s)`] : []];
			return {
				ok: true,
				message: parts.length > 0 ? `session ${contextId}: ${parts.join("; ")}` : `session ${contextId}: no active tasks or live sessions`
			};
		},
		sessionMessages(contextId, serverId) {
			const matches = host.inboundManager.list().filter((live) => (serverId === void 0 || live.id === serverId) && live.sessionPool?.has(contextId) === true);
			if (matches.length > 1) throw new Error(`session ${contextId} is ambiguous; specify serverId`);
			return matches[0]?.sessionPool?.messages(contextId) ?? [];
		},
		metrics() {
			return host.metrics.snapshot();
		},
		inbounds() {
			return host.inboundManager.list().flatMap((live) => live.inbound.list());
		},
		async closeInbound(peerId) {
			for (const live of host.inboundManager.list()) {
				const peers = live.inbound.activeTasksOf(peerId);
				for (const taskId of peers) live.server.abort(taskId);
				if (live.inbound.closePeer(peerId)) return {
					ok: true,
					message: `inbound peer ${peerId} closed`
				};
			}
			return {
				ok: false,
				message: `inbound peer ${peerId} not found`
			};
		}
	};
}
/** Locate the host `llm` service through reflection or a plain property read. */
function probeLlm(ctx) {
	const svc = probeService(ctx, "llm", "listProviders") ?? probeService(ctx, "llm", "listModels");
	if (svc !== void 0) return {
		llm: svc,
		via: "reflect"
	};
	const direct = ctx.llm;
	if (direct !== void 0 && direct !== null) return {
		llm: direct,
		via: "property"
	};
	return {
		llm: void 0,
		via: "none"
	};
}
/** Enumerate the models the deployment can actually route to (best effort). */
async function probeModelCatalogue(ctx) {
	const { llm, via } = probeLlm(ctx);
	const diagnostics = { service: via };
	if (llm === void 0 || llm === null) return {
		rows: [],
		diagnostics: {
			...diagnostics,
			reason: "llm service not found on ctx"
		}
	};
	const svc = llm;
	diagnostics.listProviders = typeof svc.listProviders === "function";
	diagnostics.listModels = typeof svc.listModels === "function";
	if (typeof svc.listModels !== "function") return {
		rows: [],
		diagnostics: {
			...diagnostics,
			reason: "llm service has no listModels()"
		}
	};
	let providers = [];
	try {
		providers = await svc.listProviders?.() ?? [];
	} catch (err) {
		return {
			rows: [],
			diagnostics: {
				...diagnostics,
				reason: `listProviders threw: ${err.message}`
			}
		};
	}
	diagnostics.providers = providers.map((raw) => providerIdOf(raw) ?? `?${JSON.stringify(raw)}`);
	const rows = [];
	const failures = [];
	for (const raw of providers) {
		const provider = providerIdOf(raw);
		if (provider === void 0) continue;
		try {
			for (const model of await svc.listModels(provider)) rows.push({
				provider: model.provider,
				id: model.id,
				name: model.name
			});
		} catch (err) {
			failures.push(`${provider}: ${err.message}`);
		}
	}
	if (failures.length > 0) diagnostics.failures = failures;
	diagnostics.rows = rows.length;
	return {
		rows,
		diagnostics
	};
}
function providerIdOf(raw) {
	if (typeof raw === "string") return raw;
	const row = raw;
	if (typeof row.id === "string") return row.id;
	if (typeof row.provider === "string") return row.provider;
}
async function listAvailableModels(ctx) {
	try {
		return (await probeModelCatalogue(ctx)).rows;
	} catch {
		return [];
	}
}
async function listAvailableTools(ctx) {
	const service = probeService(ctx, "tools", "schemas");
	if (service?.schemas === void 0) return [];
	try {
		const rows = [];
		for (const schema of service.schemas()) {
			const name = String(schema.name ?? "");
			if (name.length === 0) continue;
			rows.push(typeof schema.description === "string" ? {
				name,
				description: schema.description
			} : { name });
		}
		return rows.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}
function resolveDefaultModel(ctx) {
	return probeService(ctx, "agentDefaultModel", "currentSelection")?.currentSelection();
}
/** Absolute stable cwd for inbound per-context sessions (never profile root). */
function inboundSessionCwd() {
	const home = join(homedir(), ".dsh");
	const dshHome = process.env["DSH_HOME"] ?? home;
	const dir = join(dshHome, "a2a-sessions");
	try {
		mkdirSync(dir, { recursive: true });
	} catch {}
	return dir;
}
/** Startup retry budget for the default workspace registration (500ms each). */
const WORKSPACE_REGISTRATION_ATTEMPTS = 40;
function noopRegister() {
	return () => {};
}
/** The plugin package root in source and bundled layouts (src/ or lib/ → root). */
function pluginPackageRoot() {
	return fileURLToPath(new URL("..", import.meta.url));
}
/** The listening port of a mounted webServer (undefined when unavailable). */
function webServerPort(webServer) {
	const candidate = webServer;
	if (candidate === void 0) return void 0;
	const value = typeof candidate.port === "function" ? candidate.port() : candidate.port;
	return typeof value === "number" && Number.isFinite(value) ? String(value) : void 0;
}
//#endregion
export { A2AClient, A2AError, A2AServer, A2AService, Config, apply, inject, name };
