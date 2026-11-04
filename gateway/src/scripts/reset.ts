import Redis from 'ioredis';
import { config } from '../config';
import { keys } from '../redis/keys';

const redis = new Redis(config.redisUrl);
let cursor = '0';
let removed = 0;
do {
  const [next, batch] = await redis.scan(cursor, 'MATCH', keys.all, 'COUNT', 500);
  cursor = next;
  if (batch.length) removed += await redis.del(...batch);
} while (cursor !== '0');
console.log(`removed ${removed} keys`);
redis.disconnect();
