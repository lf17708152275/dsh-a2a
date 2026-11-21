/**
 * Advertised base-URL completion: a port-less `http` base URL is completed with
 * the host web server's port so cards and the dashboard never advertise port 80
 * on a machine whose A2A routes answer elsewhere; `https`, explicit ports and
 * `auto` are left untouched.
 * @module dsh-a2a/tests/unit/base-url-port.spec
 */

import { describe, expect, it } from 'vitest'
import { withAdvertisedPort } from '../../src/servers/inbound-manager.ts'

describe('withAdvertisedPort', () => {
  it('completes a port-less http base URL with the web server port', () => {
    expect(withAdvertisedPort('http://10.10.10.2', '53793')).toBe('http://10.10.10.2:53793')
    expect(withAdvertisedPort('http://127.0.0.1', '53793')).toBe('http://127.0.0.1:53793')
  })

  it('keeps an explicit port the user typed', () => {
    expect(withAdvertisedPort('http://10.10.10.2:3080', '53793')).toBe('http://10.10.10.2:3080')
  })

  it('leaves https alone: a TLS deployment ends at a proxy that owns 443', () => {
    expect(withAdvertisedPort('https://companion.example.com', '53793')).toBe('https://companion.example.com')
    expect(withAdvertisedPort('https://companion.example.com/app/a2a/x', '53793')).toBe(
      'https://companion.example.com/app/a2a/x',
    )
  })

  it('leaves auto and unknown ports alone', () => {
    expect(withAdvertisedPort('auto', '53793')).toBe('auto')
    expect(withAdvertisedPort('http://10.10.10.2', undefined)).toBe('http://10.10.10.2')
    expect(withAdvertisedPort('http://10.10.10.2', '')).toBe('http://10.10.10.2')
    expect(withAdvertisedPort('http://10.10.10.2', '80')).toBe('http://10.10.10.2')
  })

  it('keeps a path prefix and drops the trailing slash it completed', () => {
    expect(withAdvertisedPort('http://10.10.10.2/prefix/', '53793')).toBe('http://10.10.10.2:53793/prefix')
  })
})
