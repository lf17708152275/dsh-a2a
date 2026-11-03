/**
 * Local network address discovery for the deployment advertised base URL.
 *
 * The dashboard offers the machine's own IPv4 origins as pick-list entries so
 * operators do not have to type (and remember) the LAN address by hand.
 * @module dsh-a2a/server/net
 */

import { networkInterfaces } from 'node:os'

/** One origin the dashboard offers as the advertised base URL. */
export interface BaseUrlCandidate {
  /** Origin (`scheme://host`), e.g. `http://192.168.1.100`. */
  readonly value: string
  /** Human label for the pick list, e.g. `192.168.1.100（wlp4s0）`. */
  readonly label: string
  /** Interface name the address belongs to. */
  readonly interface: string
}

/** Minimal interface-info shape (`node:os` NetworkInterfaceInfo). */
export interface AddressInfoLike {
  readonly address: string
  readonly family: string | number
  readonly internal: boolean
}

const IPV4_FAMILY = 4

function isIpv4(info: AddressInfoLike): boolean {
  return info.family === 'IPv4' || info.family === IPV4_FAMILY
}

/**
 * Build candidate origins from a `networkInterfaces()` result: every non-internal
 * IPv4 address on every interface, in interface-name order. Pure so the pick
 * list can be tested without touching the host's real NICs.
 */
export function baseUrlCandidatesFrom(interfaces: Record<string, readonly AddressInfoLike[] | undefined>): BaseUrlCandidate[] {
  const candidates: BaseUrlCandidate[] = []
  for (const name of Object.keys(interfaces).sort()) {
    for (const info of interfaces[name] ?? []) {
      if (info.internal || !isIpv4(info)) continue
      candidates.push({ value: `http://${info.address}`, label: `${info.address}（${name}）`, interface: name })
    }
  }
  return candidates
}

/** Candidates for the current host. */
export function discoverBaseUrlCandidates(): BaseUrlCandidate[] {
  return baseUrlCandidatesFrom(networkInterfaces())
}
