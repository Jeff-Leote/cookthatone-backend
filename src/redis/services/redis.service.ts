import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  onModuleInit() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async deleteByPrefix(prefix: string) {
    const keysStream = this.client.scanStream({
      match: `${prefix}*`,
      count: 100,
    });
    for await (const keys of keysStream as AsyncIterable<string[]>) {
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    }
  }
}
