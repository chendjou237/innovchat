// Integration tests use their own database and Redis db; no worker runs, so tests drive the
// delivery engine directly (DeliveryService) and the mock provider sends no webhooks.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://innovcare:innovcare@localhost:5433/innovcare_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1';
process.env.ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.PHONE_HASH_KEY = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';
process.env.WHATSAPP_PROVIDER = 'mock';
process.env.MOCK_WEBHOOK_DELAY_MS = '0';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_VERIFY_TOKEN = 'test-verify-token';
process.env.SEED_ADMIN_EMAIL = 'admin@test.cm';
process.env.SEED_ADMIN_PASSWORD = 'Password123!';
