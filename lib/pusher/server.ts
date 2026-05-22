import Pusher from 'pusher'

import { env } from '@/lib/env'

/**
 * Pusher server client for ADR-0009 (TripGroup chat / presence) and
 * future Vendor-inbox real-time pings (ADR-0010).
 *
 * Returns a stub client in dev when env vars are missing — calls
 * resolve so feature code doesn't crash without Pusher provisioned.
 */

interface PusherLike {
  trigger(
    channel: string | string[],
    event: string,
    data: unknown,
  ): Promise<unknown>
  authorizeChannel(socketId: string, channel: string): unknown
}

let cached: PusherLike | null = null

export function getPusherServer(): PusherLike {
  if (cached) return cached

  if (
    env.PUSHER_APP_ID &&
    env.PUSHER_KEY &&
    env.PUSHER_SECRET &&
    env.PUSHER_CLUSTER
  ) {
    cached = new Pusher({
      appId: env.PUSHER_APP_ID,
      key: env.PUSHER_KEY,
      secret: env.PUSHER_SECRET,
      cluster: env.PUSHER_CLUSTER,
      useTLS: true,
    })
    return cached
  }

  cached = {
    async trigger() {
      return undefined
    },
    authorizeChannel() {
      return { auth: 'dev-stub' }
    },
  }
  return cached
}

export function _resetPusherCacheForTests(): void {
  cached = null
}
