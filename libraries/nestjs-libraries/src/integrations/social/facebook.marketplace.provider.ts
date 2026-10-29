import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { timer } from '@gitroom/helpers/utils/timer';
import { SocialAbstract, BadBody } from '../social.abstract';
import {
  AuthTokenDetails,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './social.integrations.interface';
import { FacebookMarketplaceDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.marketplace.dto';
import {
  FacebookWorkerClient,
  FacebookWorkerError,
} from '@gitroom/nestjs-libraries/integrations/facebook-worker/facebook-worker.client';

type MarketplaceConnection = {
  profile: string;
};

export class FacebookMarketplaceProvider
  extends SocialAbstract
  implements SocialProvider
{
  override maxConcurrentJob = 1;
  identifier = 'facebook-marketplace';
  name = 'Facebook Marketplace';
  toolTip =
    'Unofficial browser automation. Marketplace availability depends on the Facebook account and may change.';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  dto = FacebookMarketplaceDto;

  private worker = new FacebookWorkerClient();

  maxLength() {
    return 5000;
  }

  async customFields() {
    return [
      {
        key: 'profile',
        label: 'Browser profile',
        defaultValue: 'default',
        validation: '/^[a-zA-Z0-9._-]{1,64}$/',
        type: 'text' as const,
        hint: 'Persistent worker profile. Login to Facebook once with browser:login.',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(12);
    return {
      url: state,
      codeVerifier: makeId(18),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }): Promise<AuthTokenDetails | string> {
    let fields: { profile?: string };
    try {
      fields = JSON.parse(Buffer.from(params.code, 'base64').toString());
    } catch {
      return 'Invalid Facebook Marketplace configuration';
    }

    const profile = String(fields.profile || '').trim();
    if (!profile) return 'Browser profile is required';

    try {
      const status = await this.worker.profileStatus(profile);
      if (status.checkpoint) {
        return 'Facebook security checkpoint must be completed in the worker browser';
      }
      if (status.captcha) {
        return 'Facebook CAPTCHA must be completed in the worker browser';
      }
      if (!status.loggedIn) {
        return 'Facebook worker profile is not logged in';
      }

      await this.worker.validateMarketplace(profile);
      const connection: MarketplaceConnection = { profile };

      return {
        id: `facebook-marketplace:${profile}`,
        name: `Facebook Marketplace - ${profile}`,
        accessToken: Buffer.from(JSON.stringify(connection)).toString('base64'),
        refreshToken: '',
        expiresIn: dayjs().add(100, 'year').unix() - dayjs().unix(),
        picture: '',
        username: profile,
      };
    } catch (error: any) {
      if (error instanceof FacebookWorkerError) {
        return `Facebook worker: ${error.message}`;
      }
      return error?.message || 'Facebook Marketplace validation failed';
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      id: '',
      name: '',
      accessToken: '',
      refreshToken: '',
      expiresIn: 0,
      picture: '',
      username: '',
    };
  }

  private connection(accessToken: string): MarketplaceConnection {
    try {
      return JSON.parse(Buffer.from(accessToken, 'base64').toString());
    } catch {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Invalid Facebook Marketplace channel configuration; reconnect the channel'
      );
    }
  }

  override async checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>
  ): Promise<string | true> {
    if (!posts?.[0]?.length) {
      return 'Facebook Marketplace requires at least one image';
    }
    return true;
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookMarketplaceDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [post] = postDetails;
    const connection = this.connection(accessToken);

    const submitted = await this.worker.submitJob({
      idempotencyKey: `${this.identifier}:${post.id}:${integration.id}`,
      type: 'facebook-marketplace-publish',
      profile: connection.profile,
      payload: {
        title: post.settings.title,
        price: post.settings.price,
        category: post.settings.category,
        condition: post.settings.condition,
        location: post.settings.location,
        description: post.message,
        media: FacebookWorkerClient.media(post.media),
      },
    });

    return [
      {
        id: post.id,
        postId: submitted.jobId,
        releaseURL: '',
        status: 'pending',
        pendingData: { workerJobId: submitted.jobId },
      },
    ];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookMarketplaceDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [pending] = await this.postPending(
      id,
      accessToken,
      postDetails,
      integration
    );

    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await this.checkPostStatus(
        accessToken,
        pending.pendingData,
        integration
      );
      if (result.status === 'completed') {
        return [
          {
            id: pending.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          },
        ];
      }
      await timer(2000);
    }

    throw new BadBody(
      this.identifier,
      '{}',
      '{}',
      'Facebook worker did not complete the Marketplace job in time'
    );
  }

  async checkPostStatus(
    accessToken: string,
    pendingData: { workerJobId: string },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    return this.workerResult(pendingData);
  }

  async finalizePost(
    accessToken: string,
    pendingData: { workerJobId: string },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    return this.workerResult(pendingData);
  }

  private async workerResult(
    pendingData: { workerJobId: string }
  ): Promise<PendingCheckResponse> {
    const job = await this.worker.getJob(pendingData.workerJobId);

    if (
      job.status === 'QUEUED' ||
      job.status === 'RUNNING' ||
      job.status === 'PUBLISH_STARTED'
    ) {
      return { status: 'pending', pendingData };
    }

    if (job.status === 'SUCCESS') {
      return {
        status: 'completed',
        postId: job.result?.remoteId || job.id,
        releaseURL: job.result?.releaseUrl || '',
      };
    }

    const suffix =
      job.status === 'UNKNOWN_OUTCOME'
        ? ' The listing may already exist on Facebook; check Marketplace before retrying.'
        : '';

    throw new BadBody(
      this.identifier,
      JSON.stringify({ code: job.error?.code, status: job.status }),
      '{}',
      (job.error?.message ||
        `Facebook Marketplace worker failed: ${job.status}`) + suffix
    );
  }
}
