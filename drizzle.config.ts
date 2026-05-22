import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Load .env.local for local migration runs; CI / production pass env vars directly.
config({ path: '.env.local', quiet: true })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set to run drizzle-kit. Add it to .env.local.')
}

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
  casing: 'snake_case',
})
