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
export declare enum TaskState {
    SUBMITTED = "TASK_STATE_SUBMITTED",
    WORKING = "TASK_STATE_WORKING",
    INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED",
    AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED",
    COMPLETED = "TASK_STATE_COMPLETED",
    FAILED = "TASK_STATE_FAILED",
    CANCELED = "TASK_STATE_CANCELED",
    REJECTED = "TASK_STATE_REJECTED"
}
/** States that settle a task; a settled task no longer transitions. */
export declare const TERMINAL_STATES: ReadonlySet<TaskState>;
/** Interrupted (non-terminal, still owed) states. */
export declare const INTERRUPTED_STATES: ReadonlySet<TaskState>;
/** @returns whether the state settles the task. */
export declare function isTerminal(state: TaskState): boolean;
/** Message sender role (spec `Role`; JSON = `ROLE_*` per ADR-001). */
export declare enum Role {
    USER = "ROLE_USER",
    AGENT = "ROLE_AGENT"
}
/** Base properties common to every message part. */
export interface PartBase {
    readonly metadata?: Record<string, unknown> | null;
}
/** Conveys plain textual content. */
export interface TextPart extends PartBase {
    readonly text: string;
}
/** Conveys a file: raw bytes (base64 in JSON), a URL, or both. */
export interface FilePart extends PartBase {
    readonly raw?: string;
    readonly url?: string;
    readonly filename?: string;
    readonly mediaType?: string;
}
/** Conveys structured data (a JSON value). */
export interface DataPart extends PartBase {
    readonly data: unknown;
}
/** A container for a section of communication content (spec `Part`). */
export type Part = TextPart | FilePart | DataPart;
/** A message in a task's conversation (spec `Message`). */
export interface Message {
    /** Unique id created by the message creator. */
    readonly messageId: string;
    /** Associates this message with a context. */
    readonly contextId?: string;
    /** Associates this message with a task. */
    readonly taskId?: string;
    readonly role: Role;
    readonly parts: readonly Part[];
    readonly metadata?: Record<string, unknown> | null;
    /** Extension URIs present or contributed. */
    readonly extensions?: readonly string[];
    /** Task ids this message references for additional context. */
    readonly referenceTaskIds?: readonly string[];
}
/** Configuration of a send-message request (spec `SendMessageConfiguration`). */
export interface SendMessageConfiguration {
    /** Media types the client accepts for response parts. */
    readonly acceptedOutputModes?: readonly string[];
    /** Push notification config; task id empty when sent with SendMessage. */
    readonly taskPushNotificationConfig?: TaskPushNotificationConfig;
    /** Max history messages to return; 0 = none; unset = no limit. */
    readonly historyLength?: number;
    /** true = return immediately after task creation; false (default) = block to terminal/interrupted. */
    readonly returnImmediately?: boolean;
}
/** A container for the status of a task. */
export interface TaskStatus {
    readonly state: TaskState;
    readonly message?: Message | null;
    /** ISO 8601 timestamp when the status was recorded. */
    readonly timestamp: string;
}
/** A chunk of task output (spec `Artifact`). */
export interface Artifact {
    readonly name?: string;
    readonly artifactId?: string;
    readonly parts: readonly Part[];
    readonly metadata?: Record<string, unknown> | null;
}
/** The core unit of action for A2A (spec `Task`). */
export interface Task {
    /** Server-generated id for a new task. */
    readonly id: string;
    readonly contextId?: string;
    readonly status: TaskStatus;
    readonly artifacts?: readonly Artifact[];
    readonly history?: readonly Message[];
    readonly metadata?: Record<string, unknown> | null;
}
/** Task status transition event (spec `TaskStatusUpdateEvent`). */
export interface TaskStatusUpdateEvent {
    readonly taskId: string;
    readonly contextId?: string;
    readonly status: TaskStatus;
    readonly metadata?: Record<string, unknown> | null;
}
/** Task artifact update event (spec `TaskArtifactUpdateEvent`). */
export interface TaskArtifactUpdateEvent {
    readonly taskId: string;
    readonly contextId?: string;
    readonly artifact: Artifact;
    /** Append this chunk to the artifact with the same id instead of replacing it. */
    readonly append?: boolean;
    readonly lastChunk?: boolean;
    readonly metadata?: Record<string, unknown> | null;
}
/** Result of SendMessage: one of the two spec payload variants. */
export interface SendMessageResponse {
    readonly task?: Task;
    readonly message?: Message;
}
/** Result of ListTasks (spec `ListTasksResponse`). */
export interface ListTasksResponse {
    readonly tasks: readonly Task[];
    readonly nextPageToken: string;
    readonly pageSize: number;
    readonly totalSize: number;
}
/** Streaming payload variants (spec `StreamResponse` oneof). */
export type StreamResponse = {
    readonly task: Task;
} | {
    readonly message: Message;
} | {
    readonly statusUpdate: TaskStatusUpdateEvent;
} | {
    readonly artifactUpdate: TaskArtifactUpdateEvent;
};
/** Push notification configuration (spec `TaskPushNotificationConfig`). */
export interface TaskPushNotificationConfig {
    readonly id?: string;
    readonly url: string;
    readonly token?: string | null;
    readonly authentication?: {
        readonly schemes: readonly string[];
        readonly credentials?: string | null;
    } | null;
}
/** JSON-RPC 2.0 message base. */
export interface JsonRpcRequest {
    readonly jsonrpc: '2.0';
    readonly id?: string | number | null;
    readonly method: string;
    readonly params?: Record<string, unknown> | null;
}
export interface JsonRpcSuccess {
    readonly jsonrpc: '2.0';
    readonly id: string | number | null;
    readonly result: unknown;
}
export interface JsonRpcErrorBody {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}
export interface JsonRpcError {
    readonly jsonrpc: '2.0';
    readonly id: string | number | null;
    readonly error: JsonRpcErrorBody;
}
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;
/** A skill advertised by an agent (spec `AgentSkill`). */
export interface AgentSkill {
    readonly id: string;
    /** Human-readable name. Required by the protocol. */
    readonly name: string;
    /** Detailed description (CommonMark may be used). */
    readonly description?: string | null;
    readonly tags?: readonly string[] | null;
    readonly examples?: readonly string[] | null;
    readonly inputModes?: readonly string[] | null;
    readonly outputModes?: readonly string[] | null;
}
/** One optional extension declared by an agent (spec `AgentExtension`). */
export interface AgentExtension {
    /** Stable extension identifier; SHOULD carry a version in the URI. */
    readonly uri: string;
    readonly description?: string;
    /** When true, a client that does not support the extension must be rejected. */
    readonly required?: boolean;
    /** Extension-defined discovery parameters. */
    readonly params?: Record<string, unknown>;
}
/** Optional A2A protocol features (spec `AgentCapabilities`). */
export interface AgentCapabilities {
    /** `SendStreamingMessage` + `SubscribeToTask` support. */
    readonly streaming?: boolean;
    /** Push notification webhooks. */
    readonly pushNotifications?: boolean;
    /** Extended Agent Card support. */
    readonly extendedAgentCard?: boolean;
    readonly stateTransitionHistory?: boolean;
    /** Optional extensions this agent can activate for a request. */
    readonly extensions?: readonly AgentExtension[];
}
/** Information about the providing organization (spec `AgentProvider`). */
export interface AgentProvider {
    readonly organization: string;
    readonly url?: string | null;
}
/** Authentication requirements of the agent's endpoint (spec `AgentAuthentication`). */
export interface AgentAuthentication {
    /** Scheme names, e.g. "Bearer", "OAuth2", "ApiKey". Empty = no A2A-level auth. */
    readonly schemes: readonly string[];
    /** Non-secret scheme configuration; MUST NOT contain plaintext secrets. */
    readonly credentials?: string | null;
}
/** One supported interface of an agent (spec `AgentInterface`). */
export interface AgentInterface {
    readonly url: string;
    readonly protocolBinding?: 'JSONRPC' | 'GRPC' | 'HTTP+JSON' | string;
    readonly protocolVersion?: string;
    readonly tenant?: string;
}
/** The discovery manifest of an A2A agent (spec `AgentCard`). */
export interface AgentCard {
    readonly name: string;
    readonly description?: string | null;
    readonly supportedInterfaces?: readonly AgentInterface[];
    readonly provider?: AgentProvider | null;
    readonly iconUrl?: string | null;
    readonly version: string;
    readonly documentationUrl?: string | null;
    readonly capabilities: AgentCapabilities;
    readonly securitySchemes?: Record<string, unknown> | null;
    readonly securityRequirements?: readonly unknown[] | null;
    readonly defaultInputModes?: readonly string[];
    readonly defaultOutputModes?: readonly string[];
    readonly skills: readonly AgentSkill[];
}
/** JSON-RPC + A2A error codes. */
export declare const A2A_ERROR_CODES: {
    readonly PARSE_ERROR: -32700;
    readonly INVALID_REQUEST: -32600;
    readonly METHOD_NOT_FOUND: -32601;
    readonly INVALID_PARAMS: -32602;
    readonly INTERNAL_ERROR: -32603;
    readonly TASK_NOT_FOUND: -32001;
    readonly TASK_CANCEL_NOT_ALLOWED: -32002;
    readonly PUSH_NOTIFICATION_NOT_SUPPORTED: -32003;
    readonly UNSUPPORTED_OPERATION: -32004;
    readonly CONTENT_TYPE_NOT_SUPPORTED: -32005;
    readonly STREAMING_NOT_SUPPORTED: -32006;
    readonly VERSION_NOT_SUPPORTED: -32007;
    readonly INVALID_AGENT_RESPONSE: -32008;
};
/** A2A v1.0 JSON-RPC method names (spec §5.3 Method Mapping Reference). */
export declare const A2A_METHODS: {
    readonly sendMessage: "SendMessage";
    readonly sendStreamingMessage: "SendStreamingMessage";
    readonly getTask: "GetTask";
    readonly listTasks: "ListTasks";
    readonly cancelTask: "CancelTask";
    readonly subscribeToTask: "SubscribeToTask";
    readonly createTaskPushNotificationConfig: "CreateTaskPushNotificationConfig";
    readonly getTaskPushNotificationConfig: "GetTaskPushNotificationConfig";
    readonly listTaskPushNotificationConfigs: "ListTaskPushNotificationConfigs";
    readonly deleteTaskPushNotificationConfig: "DeleteTaskPushNotificationConfig";
    readonly getExtendedAgentCard: "GetExtendedAgentCard";
};
/** The A2A protocol version this plugin implements (header + interface). */
export declare const PROTOCOL_VERSION = "1.0";
/** HTTP header used to request and acknowledge A2A extensions. */
export declare const A2A_EXTENSIONS_HEADER = "A2A-Extensions";
/** The well-known AgentCard content type (spec §14.1). */
export declare const A2A_JSON_MEDIA_TYPE = "application/a2a+json";
/**
 * Read a message's text parts as a single string (model-facing convenience).
 * File parts render as their URL/name; data parts as JSON.
 */
export declare function partsToText(parts: readonly Part[] | undefined): string;
//# sourceMappingURL=protocol.d.ts.map