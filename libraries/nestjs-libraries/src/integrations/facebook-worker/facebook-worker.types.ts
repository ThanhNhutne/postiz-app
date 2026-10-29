export type FacebookWorkerJobType =
  | 'facebook-group-publish'
  | 'facebook-marketplace-publish';

export type FacebookWorkerJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PUBLISH_STARTED'
  | 'SUCCESS'
  | 'FAILED'
  | 'NEEDS_LOGIN'
  | 'CHECKPOINT'
  | 'CAPTCHA'
  | 'PENDING_APPROVAL'
  | 'ACCOUNT_RESTRICTED'
  | 'UNKNOWN_OUTCOME';

export interface FacebookWorkerProfileStatus {
  profile: string;
  exists: boolean;
  loggedIn: boolean;
  checkpoint: boolean;
  captcha: boolean;
  mock?: boolean;
}

export interface FacebookWorkerGroupValidation {
  valid: boolean;
  groupId: string;
  name: string;
  canPost: boolean;
}

export interface FacebookWorkerMarketplaceValidation {
  available: boolean;
  mock?: boolean;
}

export interface FacebookWorkerMedia {
  type: 'image' | 'video';
  url: string;
}

export interface FacebookWorkerJob {
  id: string;
  idempotencyKey: string;
  type: FacebookWorkerJobType;
  profile: string;
  status: FacebookWorkerJobStatus;
  payload: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: {
    remoteId?: string;
    releaseUrl?: string;
  };
  error?: {
    code: string;
    message: string;
    screenshotPath?: string;
    currentUrl?: string;
  };
}

export interface FacebookWorkerSubmitResponse {
  jobId: string;
  status: FacebookWorkerJobStatus;
  created: boolean;
}
