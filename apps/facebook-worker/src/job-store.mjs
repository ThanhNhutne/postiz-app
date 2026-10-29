import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const JOB_PREFIX = 'fbw:job:';
const IDEMPOTENCY_PREFIX = 'fbw:idempotency:';
const LOCK_PREFIX = 'fbw:lock:profile:';
const QUEUE_KEY = 'fbw:queue';

function newJob(input) {
  const now = new Date().toISOString();
  return {
    id: 'fbw_' + randomUUID(),
    idempotencyKey: input.idempotencyKey,
    type: input.type,
    profile: input.profile,
    status: 'QUEUED',
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  };
}

export class RedisJobStore {
  constructor(redisUrl, ttlSeconds = 604800) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    this.ttlSeconds = ttlSeconds;
  }

  async connect() {
    if (this.redis.status === 'wait') await this.redis.connect();
    return this.redis.ping();
  }

  async ping() {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  async createOrGet(input) {
    const idemKey = IDEMPOTENCY_PREFIX + input.idempotencyKey;
    const existingId = await this.redis.get(idemKey);
    if (existingId) {
      const existing = await this.get(existingId);
      if (existing) return { job: existing, created: false };
    }

    const job = newJob(input);
    const won = await this.redis.set(
      idemKey,
      job.id,
      'EX',
      this.ttlSeconds,
      'NX'
    );

    if (!won) {
      const winnerId = await this.redis.get(idemKey);
      const winner = winnerId ? await this.get(winnerId) : null;
      if (winner) return { job: winner, created: false };
      throw new Error('Idempotency reservation exists without a job');
    }

    await this.save(job);
    await this.enqueue(job.id);
    return { job, created: true };
  }

  async save(job) {
    const next = { ...job, updatedAt: new Date().toISOString() };
    await this.redis.set(
      JOB_PREFIX + job.id,
      JSON.stringify(next),
      'EX',
      this.ttlSeconds
    );
    return next;
  }

  async get(id) {
    const raw = await this.redis.get(JOB_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  }

  async enqueue(id) {
    await this.redis.rpush(QUEUE_KEY, id);
  }

  async claimNext() {
    const id = await this.redis.lpop(QUEUE_KEY);
    return id ? this.get(id) : null;
  }

  async acquireProfileLock(profile, ttlSeconds) {
    const token = randomUUID();
    const ok = await this.redis.set(
      LOCK_PREFIX + profile,
      token,
      'EX',
      ttlSeconds,
      'NX'
    );
    return ok ? token : null;
  }

  async releaseProfileLock(profile, token) {
    const script = [
      "if redis.call('get', KEYS[1]) == ARGV[1] then",
      "  return redis.call('del', KEYS[1])",
      "else",
      "  return 0",
      "end",
    ].join('\n');
    await this.redis.eval(script, 1, LOCK_PREFIX + profile, token);
  }
}

export class MemoryJobStore {
  constructor() {
    this.jobs = new Map();
    this.idempotency = new Map();
    this.queue = [];
    this.locks = new Map();
  }

  async connect() { return 'PONG'; }
  async ping() { return true; }
  async close() {}

  async createOrGet(input) {
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) {
      return { job: this.jobs.get(existingId), created: false };
    }
    const job = newJob(input);
    this.idempotency.set(input.idempotencyKey, job.id);
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    return { job, created: true };
  }

  async save(job) {
    const next = { ...job, updatedAt: new Date().toISOString() };
    this.jobs.set(job.id, next);
    return next;
  }

  async get(id) { return this.jobs.get(id) || null; }
  async enqueue(id) { this.queue.push(id); }
  async claimNext() {
    const id = this.queue.shift();
    return id ? this.get(id) : null;
  }

  async acquireProfileLock(profile) {
    if (this.locks.has(profile)) return null;
    const token = randomUUID();
    this.locks.set(profile, token);
    return token;
  }

  async releaseProfileLock(profile, token) {
    if (this.locks.get(profile) === token) this.locks.delete(profile);
  }
}
