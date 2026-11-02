/**
 * Advertised base URL candidates: local IPv4 interfaces offered as a pick list.
 *
 * Regression shape: dropping the internal/IPv6 filters or the interface label
 * makes these assertions fail, and the dashboard would offer unusable origins.
 * @module dsh-a2a/tests/unit/net-candidates.spec
 */

import { describe, expect, it } from 'vitest'
import { baseUrlCandidatesFrom } from '../../src/server/net.ts'

describe('baseUrlCandidatesFrom', () => {
  it('offers every non-internal IPv4 origin with an interface label', () => {
    const candidates = baseUrlCandidatesFrom({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      wlp4s0: [{ address: '192.168.31.20', family: 'IPv4', internal: false }],
      eth0: [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
    })
    expect(candidates).toEqual([
      { value: 'http://10.0.0.7', label: '10.0.0.7（eth0）', interface: 'eth0' },
      { value: 'http://192.168.31.20', label: '192.168.31.20（wlp4s0）', interface: 'wlp4s0' },
    ])
  })

  it('accepts the numeric IPv4 family discriminant too', () => {
    const candidates = baseUrlCandidatesFrom({
      eth0: [{ address: '172.16.4.9', family: 4, internal: false }],
    })
    expect(candidates.map((c) => c.value)).toEqual(['http://172.16.4.9'])
  })

  it('skips IPv6 and internal addresses, and tolerates missing interfaces', () => {
    const candidates = baseUrlCandidatesFrom({
      wlp4s0: [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '127.0.0.1', family: 'IPv4', internal: true },
      ],
      ghost: undefined,
    })
    expect(candidates).toEqual([])
  })
})
