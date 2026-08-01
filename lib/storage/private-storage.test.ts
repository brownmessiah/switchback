import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GcsPrivateAdapter } from './gcs-private'
import { LocalPrivateAdapter } from './local-private'
import { getPrivateStorageAdapter } from './private-factory'

/**
 * KYC documents (Aadhaar, PAN, govt ID, selfie) are sensitive personal
 * identifiers. They must NOT go in the public uploads bucket, whose IAM grants
 * `allUsers: objectViewer` — anything written there is world-readable to
 * anyone holding the URL, forever, with no auth check.
 *
 * So private storage is a SEPARATE interface, not an option on the public one:
 * it never hands back a durable public URL, only a short-lived signed one.
 */

const TMP = join(process.cwd(), '.dev-stack', 'private-storage-test')

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

function fileOf(content: string, name = 'aadhaar.jpg', type = 'image/jpeg'): File {
  return new File([content], name, { type })
}

describe('LocalPrivateAdapter', () => {
  it('writes outside public/ so Next never serves the file statically', async () => {
    const adapter = new LocalPrivateAdapter(TMP)

    const { storageKey } = await adapter.upload(fileOf('secret'), 'vendor-kyc/v1/id.jpg')

    expect(storageKey).toBe('vendor-kyc/v1/id.jpg')
    expect(existsSync(join(TMP, 'vendor-kyc/v1/id.jpg'))).toBe(true)
    expect(TMP.includes(`${'public'}/`)).toBe(false)
  })

  it('round-trips the bytes it stored', async () => {
    const adapter = new LocalPrivateAdapter(TMP)
    await adapter.upload(fileOf('the-secret-bytes'), 'vendor-kyc/v1/id.jpg')

    const read = await adapter.read('vendor-kyc/v1/id.jpg')

    expect(read?.body.toString()).toBe('the-secret-bytes')
    expect(read?.contentType).toBe('image/jpeg')
  })

  it('returns null reading a key that does not exist', async () => {
    const adapter = new LocalPrivateAdapter(TMP)
    expect(await adapter.read('vendor-kyc/nope.jpg')).toBeNull()
  })

  it('refuses a key that tries to escape the base directory', async () => {
    const adapter = new LocalPrivateAdapter(TMP)

    await expect(
      adapter.upload(fileOf('x'), '../../public/uploads/leaked.jpg'),
    ).rejects.toThrow(/invalid|traversal/i)
  })

  it('refuses to read its way out of the base directory', async () => {
    const adapter = new LocalPrivateAdapter(TMP)
    await expect(adapter.read('../../../etc/passwd')).rejects.toThrow(/invalid|traversal/i)
  })

  it('deletes without complaining about a missing key', async () => {
    const adapter = new LocalPrivateAdapter(TMP)
    await expect(adapter.delete('vendor-kyc/absent.jpg')).resolves.toBeUndefined()
  })
})

describe('GcsPrivateAdapter', () => {
  interface SignOptions {
    version: string
    action: string
    expires: number
  }

  function fakeClient(overrides: Record<string, unknown> = {}) {
    const save = vi.fn(async () => undefined)
    const getSignedUrl = vi.fn(async (_options: SignOptions) => [
      'https://signed.example/obj?exp=1',
    ])
    const file = { save, getSignedUrl, delete: vi.fn(async () => undefined), ...overrides }
    return {
      client: { bucket: () => ({ file: () => file }) } as never,
      save,
      getSignedUrl,
    }
  }

  it('uploads without ever producing a public URL', async () => {
    const { client, save } = fakeClient()
    const adapter = new GcsPrivateAdapter('outvers-kyc', client)

    const result = await adapter.upload(fileOf('secret'), 'vendor-kyc/v1/id.jpg')

    expect(save).toHaveBeenCalled()
    expect(result).toEqual({ storageKey: 'vendor-kyc/v1/id.jpg' })
    // No `url` field at all — a durable link is precisely what must not exist.
    expect('url' in result).toBe(false)
  })

  it('mints a time-limited signed URL for reading', async () => {
    const { client, getSignedUrl } = fakeClient()
    const adapter = new GcsPrivateAdapter('outvers-kyc', client)

    const url = await adapter.getSignedUrl('vendor-kyc/v1/id.jpg', 900)

    expect(url).toBe('https://signed.example/obj?exp=1')
    const args = getSignedUrl.mock.calls[0]![0]
    expect(args.action).toBe('read')
    expect(args.expires).toBeGreaterThan(Date.now())
  })

  it('caps the signed-URL lifetime so a leaked link expires quickly', async () => {
    const { client, getSignedUrl } = fakeClient()
    const adapter = new GcsPrivateAdapter('outvers-kyc', client)

    await adapter.getSignedUrl('vendor-kyc/v1/id.jpg', 60 * 60 * 24 * 30)

    const args = getSignedUrl.mock.calls[0]![0]
    // One hour is the ceiling regardless of what the caller asks for.
    expect(args.expires).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 5_000)
  })
})

describe('getPrivateStorageAdapter', () => {
  it('uses the dedicated KYC bucket when one is configured', () => {
    const adapter = getPrivateStorageAdapter({
      GCS_KYC_BUCKET: 'outvers-kyc',
    })
    expect(adapter).toBeInstanceOf(GcsPrivateAdapter)
  })

  it('never falls back to the PUBLIC uploads bucket', () => {
    // Configuring only the public bucket must NOT silently put KYC documents
    // in it — that is the exact mistake this split exists to prevent.
    const adapter = getPrivateStorageAdapter({ GCS_BUCKET: 'outvers-uploads' })
    expect(adapter).toBeInstanceOf(LocalPrivateAdapter)
  })

  it('uses local private storage when nothing is configured', () => {
    expect(getPrivateStorageAdapter({})).toBeInstanceOf(LocalPrivateAdapter)
  })

  it('honours an explicit local override even with a KYC bucket set', () => {
    const adapter = getPrivateStorageAdapter({
      GCS_KYC_BUCKET: 'outvers-kyc',
      STORAGE_BACKEND: 'local',
    })
    expect(adapter).toBeInstanceOf(LocalPrivateAdapter)
  })
})
