import IORedis, { Redis } from 'ioredis';
import { env } from './config';

/** New ioredis connection. BullMQ workers need maxRetriesPerRequest = null. */
export function createRedis(): Redis {
  return new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

export const REDIS = Symbol('REDIS');
