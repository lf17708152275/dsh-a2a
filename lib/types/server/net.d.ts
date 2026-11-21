/**
 * Local network address discovery for the deployment advertised base URL.
 *
 * The dashboard offers the machine's own IPv4 origins as pick-list entries so
 * operators do not have to type (and remember) the LAN address by hand.
 * @module dsh-a2a/server/net
 */
/** One origin the dashboard offers as the advertised base URL. */
export interface BaseUrlCandidate {
    /** Origin (`scheme://host`), e.g. `http://192.168.1.100`. */
    readonly value: string;
    /** Human label for the pick list, e.g. `192.168.1.100（wlp4s0）`. */
    readonly label: string;
    /** Interface name the address belongs to. */
    readonly interface: string;
}
/** Minimal interface-info shape (`node:os` NetworkInterfaceInfo). */
export interface AddressInfoLike {
    readonly address: string;
    readonly family: string | number;
    readonly internal: boolean;
}
/**
 * Build candidate origins from a `networkInterfaces()` result: every non-internal
 * IPv4 address on every interface, in interface-name order. Pure so the pick
 * list can be tested without touching the host's real NICs.
 */
export declare function baseUrlCandidatesFrom(interfaces: Record<string, readonly AddressInfoLike[] | undefined>): BaseUrlCandidate[];
/** Candidates for the current host. */
export declare function discoverBaseUrlCandidates(): BaseUrlCandidate[];
//# sourceMappingURL=net.d.ts.map