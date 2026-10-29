import {
  FacebookWorkerGroupValidation,
  FacebookWorkerJob,
  FacebookWorkerJobType,
  FacebookWorkerMarketplaceValidation,
  FacebookWorkerMedia,
  FacebookWorkerProfileStatus,
  FacebookWorkerSubmitResponse,
} from './facebook-worker.types';

export class FacebookWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'FacebookWorkerError';
  }
}

export class FacebookWorkerClient {
  private get baseUrl() {
    return (process.env.FACEBOOK_WORKER_URL || 'http://facebook-worker:3001').replace(
      /\/$/,
      ''
    );
  }

  private get apiKey() {
    return process.env.FACEBOOK_WORKER_API_KEY || '';
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.apiKey) {
      throw new FacebookWorkerError(
        'WORKER_NOT_CONFIGURED',
        'FACEBOOK_WORKER_API_KEY is not configured'
      );
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        ...init,
        signal: init.signal || AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
    } catch (error: any) {
      throw new FacebookWorkerError(
        'WORKER_UNAVAILABLE',
        error?.message || 'Facebook worker is unavailable'
      );
    }

    const body = await response.json().catch(() => ({} as any));
    if (!response.ok) {
      throw new FacebookWorkerError(
        body?.code || 'WORKER_ERROR',
        body?.message || `Facebook worker returned HTTP ${response.status}`,
        response.status
      );
    }

    return body as T;
  }

  profileStatus(profile: string) {
    return this.request<FacebookWorkerProfileStatus>(
      `/v1/profiles/${encodeURIComponent(profile)}/status`
    );
  }

  validateGroup(profile: string, groupUrl: string) {
    return this.request<FacebookWorkerGroupValidation>('/v1/groups/validate', {
      method: 'POST',
      body: JSON.stringify({ profile, groupUrl }),
    });
  }

  validateMarketplace(profile: string) {
    return this.request<FacebookWorkerMarketplaceValidation>(
      '/v1/marketplace/validate',
      {
        method: 'POST',
        body: JSON.stringify({ profile }),
      }
    );
  }

  submitJob(input: {
    idempotencyKey: string;
    type: FacebookWorkerJobType;
    profile: string;
    payload: Record<string, any>;
  }) {
    if (process.env.FACEBOOK_AUTOMATION_ENABLED !== 'true') {
      throw new FacebookWorkerError(
        'AUTOMATION_DISABLED',
        'Facebook browser automation is disabled'
      );
    }

    return this.request<FacebookWorkerSubmitResponse>('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  getJob(jobId: string) {
    return this.request<FacebookWorkerJob>(
      `/v1/jobs/${encodeURIComponent(jobId)}`
    );
  }

  static media(
    media:
      | Array<{ type: 'image' | 'video'; path: string }>
      | undefined
  ): FacebookWorkerMedia[] {
    return (media || []).map((item) => ({
      type: item.type,
      url: item.path,
    }));
  }
}
