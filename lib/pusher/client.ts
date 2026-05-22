'use client'

import PusherClient from 'pusher-js'

/**
 * Pusher browser client factory. Imports the client-only module
 * (`pusher-js`) and returns a configured instance. Called from
 * Client Components that need real-time channel subscriptions
 * (TripGroup chat, Vendor inbox, customer-facing booking pings).
 *
 * The auth endpoint authenticates against our better-auth session
 * cookie and returns Pusher's auth signature for private/presence
 * channels.
 */

interface ClientOptions {
  key: string
  cluster: string
  authEndpoint?: string
}

export function createPusherClient(options: ClientOptions): PusherClient {
  return new PusherClient(options.key, {
    cluster: options.cluster,
    authEndpoint: options.authEndpoint ?? '/api/pusher/auth',
  })
}
