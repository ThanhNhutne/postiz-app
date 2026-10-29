'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FacebookGroupDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.group.dto';

export default withProvider<FacebookGroupDto>({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: null,
  CustomPreviewComponent: undefined,
  dto: FacebookGroupDto,
  maximumCharacters: 63206,
});
