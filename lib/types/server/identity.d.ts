/**
 * Service identity: the inbound AgentCard's name/description/version,
 * editable at runtime from the GUI dashboard and persisted in the `a2a`
 * domain's `identity` table. Skills stay derived from the live tool registry
 * (the "card derives from ctx.tools" design); identity editing builds a fresh
 * card preserving the endpoint URL and swaps it onto the server, so routes
 * and the facade see the new value immediately.
 * @module dsh-a2a/server/identity
 */
import { type CardOptions } from './card.ts';
import type { AgentCard, AgentSkill } from '../protocol.ts';
import type { A2aDomain } from './store.ts';
/** Persisted service identity (only the card identity fields; skills derive). */
export interface A2aIdentity {
    readonly name: string;
    readonly description: string;
    readonly version: string;
}
/** Read the persisted identity (undefined when never configured). */
export declare function readIdentity(domain: A2aDomain): A2aIdentity | undefined;
/** Persist a new identity (fire-and-forget like the task store writes). */
export declare function writeIdentity(domain: A2aDomain, identity: A2aIdentity): void;
/**
 * Build the AgentCard options for a given base URL/path and the override
 * identity. `identity` (persisted) wins over the composition `defaults`; when
 * no identity is stored, the composition defaults stand.
 */
export declare function cardOptionsFor(baseUrl: string, endpointPath: string, defaults: {
    readonly name: string;
    readonly description: string;
    readonly version: string;
}, identity: A2aIdentity | undefined, skills: readonly AgentSkill[], authToken?: string): CardOptions;
/**
 * Build a fresh AgentCard from an existing one plus a new identity and skill
 * list, preserving the endpoint URL (baseUrl/path) and security scheme.
 */
export declare function rebuildCardWithIdentity(card: AgentCard, identity: A2aIdentity, skills: readonly AgentSkill[]): AgentCard;
//# sourceMappingURL=identity.d.ts.map