/**
 * AgentCard assembly for the inbound half: identity and skill DECLARATION at
 * the instance level. The skill list is exactly the creator-declared
 * `AgentSkill[]` stored on the inbound server instance — no derivation from
 * the live tool registry (the v0.2 white-list mechanism is removed). The
 * advertised card is a pure function of the instance record plus its base URL
 * and endpoint path.
 * @module dsh-a2a/server/card
 */
import { type AgentCard, type AgentExtension, type AgentSkill } from '../protocol.ts';
/** Identity options for the advertised AgentCard. */
export interface CardOptions {
    readonly baseUrl: string;
    readonly endpointPath: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly skills: readonly AgentSkill[];
    /** Present when inbound bearer auth is configured (env-resolved). */
    readonly authToken?: string;
    /** Advertised input media types; defaults to text/plain. */
    readonly inputModes?: readonly string[];
    /** Advertised output media types; defaults to text/plain. */
    readonly outputModes?: readonly string[];
    /** Advertise the optional trace extension (instance policy allows it). */
    readonly trace?: boolean;
    /** Extra extensions to advertise alongside the built-in trace extension. */
    readonly extensions?: readonly AgentExtension[];
}
/** Assemble the AgentCard advertised by this DSH. */
export declare function buildCard(options: CardOptions): AgentCard;
//# sourceMappingURL=card.d.ts.map