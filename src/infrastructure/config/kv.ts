import { createClient as createRedisClient } from 'redis';

// Use REDIS_URL for connection (direct Redis connection)
const hasRedisUrl = !!process.env.REDIS_URL;
const useLocalRedis = process.env.USE_LOCAL_REDIS === 'true' || 
  (process.env.NODE_ENV === 'development' && !hasRedisUrl);

let kvClient: any;

if (hasRedisUrl || useLocalRedis) {
  // Use direct Redis connection (Vercel Redis or local Redis)
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const isSSL = redisUrl.startsWith('rediss://');
  
  console.log('Initializing Redis client:', {
    hasUrl: !!redisUrl,
    urlPrefix: redisUrl.substring(0, 20) + '...',
    isSSL,
    isProduction: process.env.NODE_ENV === 'production',
  });
  
  const socketConfig: any = {
    connectTimeout: 5000, // Reduced to 5 seconds for faster failure detection
    reconnectStrategy: false, // Disable auto-reconnect in serverless (causes issues)
    keepAlive: false, // Disable keep-alive in serverless
  };

  // Enable TLS if using rediss:// protocol
  if (isSSL) {
    socketConfig.tls = true;
    socketConfig.rejectUnauthorized = false; // For self-signed certificates
  }

  const redisClient = createRedisClient({
    url: redisUrl,
    socket: socketConfig,
    // Disable command queueing for serverless
    disableClientInfo: true,
  });
  
  redisClient.on('error', (err: Error) => {
    console.error('Redis Client Error:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
    });
  });
  
  redisClient.on('connect', () => {
    console.log('Redis: Connected successfully');
  });
  
  redisClient.on('ready', () => {
    console.log('Redis: Ready to accept commands');
  });
  
  redisClient.on('reconnecting', () => {
    console.log('Redis: Reconnecting...');
  });
  
  // Don't connect immediately - connect on first use (better for serverless)
  let connectionPromise: Promise<void> | null = null;
  
  async function ensureConnected() {
    if (redisClient.isOpen) {
      return;
    }
    
    if (connectionPromise) {
      return connectionPromise;
    }
    
    connectionPromise = (async () => {
      try {
        console.log('Redis: Attempting to connect...');
        await Promise.race([
          redisClient.connect(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout after 5s')), 5000)
          ),
        ]);
        console.log('Redis: Connection established');
      } catch (error) {
        connectionPromise = null; // Reset on failure
        console.error('Redis: Connection failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          urlPrefix: redisUrl.substring(0, 20) + '...',
        });
        throw error;
      }
    })();
    
    return connectionPromise;
  }
  
  // Create a compatible interface that matches @vercel/kv API
  kvClient = {
    get: async <T>(key: string): Promise<T | null> => {
      try {
        await ensureConnected();
        const value = await redisClient.get(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error('Error getting from Redis:', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    },
    set: async (key: string, value: any): Promise<void> => {
      try {
        await ensureConnected();
        await redisClient.set(key, JSON.stringify(value));
      } catch (error) {
        console.error('Error setting in Redis:', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    },
    setWithExpiry: async (key: string, value: any, ttlSeconds: number): Promise<void> => {
      try {
        await ensureConnected();
        await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
      } catch (error) {
        console.error('Error setting in Redis with expiry:', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    },
    // Hash helpers (values JSON-encoded, like get/set). Used by the reminder log.
    hGet: async <T>(key: string, field: string): Promise<T | null> => {
      try {
        await ensureConnected();
        const value = await redisClient.hGet(key, field);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error('Error hGet from Redis:', {
          key,
          field,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    },
    hSet: async (key: string, field: string, value: any): Promise<void> => {
      await ensureConnected();
      await redisClient.hSet(key, field, JSON.stringify(value));
    },
    hGetAll: async <T>(key: string): Promise<Record<string, T>> => {
      await ensureConnected();
      const raw: Record<string, string> = await redisClient.hGetAll(key);
      const out: Record<string, T> = {};
      for (const [field, value] of Object.entries(raw || {})) {
        try {
          out[field] = JSON.parse(value);
        } catch {
          // Skip a corrupt field rather than failing the whole read.
        }
      }
      return out;
    },
    expireAt: async (key: string, unixSeconds: number): Promise<void> => {
      await ensureConnected();
      await redisClient.expireAt(key, unixSeconds);
    },
    del: async (key: string): Promise<void> => {
      try {
        await ensureConnected();
        await redisClient.del(key);
      } catch (error) {
        console.error('Error deleting from Redis:', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    },
  };
} else {
  throw new Error('REDIS_URL environment variable must be set');
}

export const kv = kvClient;

