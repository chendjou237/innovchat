import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  ENCRYPTION_KEY: z.string().min(1),
  PHONE_HASH_KEY: z.string().min(1),
  WHATSAPP_PROVIDER: z.enum(['mock', 'graph']).default('mock'),
  META_GRAPH_VERSION: z.string().default('v23.0'),
  META_APP_SECRET: z.string().default(''),
  META_VERIFY_TOKEN: z.string().default(''),
  MOCK_WEBHOOK_URL: z.string().default('http://localhost:3000/api/v1/webhooks/whatsapp'),
  // Mock webhook delay in ms; 0 disables the simulated status callbacks.
  MOCK_WEBHOOK_DELAY_MS: z.coerce.number().default(400),
  SEED_ADMIN_EMAIL: z.string().default('admin@ecole.cm'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMe123!'),
  SEED_SAMPLE_DATA: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

// Local development: read apps/api/.env when present (Docker passes real env vars instead).
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error('Configuration invalide : ' + JSON.stringify(parsed.error.flatten().fieldErrors));
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: forget the cached configuration. */
export function resetEnvCache() {
  cached = null;
}

export const isProd = () => env().NODE_ENV === 'production';
