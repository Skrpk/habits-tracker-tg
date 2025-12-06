import { createClient } from '@vercel/kv';
import { createClient as createRedisClient } from 'redis';

// Priority: REDIS_URL (direct connection) > KV REST API > local Redis
const hasRedisUrl = !!process.env.REDIS_URL;
const hasKvCredentials = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
const useLocalRedis = process.env.USE_LOCAL_REDIS === 'true' || 
  (process.env.NODE_ENV === 'development' && !hasRedisUrl && !hasKvCredentials);

let kvClient: any;

if (hasRedisUrl || useLocalRedis) {
  // Use direct Redis connection (Vercel Redis or local Redis)
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisClient = createRedisClient({
    url: redisUrl,
  });
  
  redisClient.on('error', (err: Error) => {
    console.error('Redis Client Error', err);
  });
  
  redisClient.connect().catch(console.error);
  
  // Create a compatible interface that matches @vercel/kv API
  kvClient = {
    get: async <T>(key: string): Promise<T | null> => {
      try {
        const value = await redisClient.get(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error('Error getting from Redis:', error);
        return null;
      }
    },
    set: async (key: string, value: any): Promise<void> => {
      try {
        await redisClient.set(key, JSON.stringify(value));
      } catch (error) {
        console.error('Error setting in Redis:', error);
        throw error;
      }
    },
    del: async (key: string): Promise<void> => {
      try {
        await redisClient.del(key);
      } catch (error) {
        console.error('Error deleting from Redis:', error);
        throw error;
      }
    },
  };
} else if (hasKvCredentials) {
  // Fallback: Use Vercel KV REST API (if REDIS_URL is not available)
  kvClient = createClient({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
} else {
  throw new Error('Either REDIS_URL or KV_REST_API_URL/KV_REST_API_TOKEN must be set');
}

export const kv = kvClient;

