'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FacebookMarketplaceDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.marketplace.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';

const FacebookMarketplaceSettings = () => {
  const form = useSettings();

  return (
    <div className="flex flex-col gap-[12px] pt-[12px]">
      <Input
        label="Listing title"
        {...form.register('title')}
      />
      <Input
        label="Price"
        type="number"
        {...form.register('price')}
      />
      <Input
        label="Category"
        {...form.register('category')}
      />
      <Input
        label="Condition"
        {...form.register('condition')}
      />
      <Input
        label="Location"
        {...form.register('location')}
      />
      <div className="text-[12px] opacity-70">
        Description comes from the main Postiz content editor. Marketplace
        requires at least one image.
      </div>
    </div>
  );
};

export default withProvider<FacebookMarketplaceDto>({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: FacebookMarketplaceSettings,
  CustomPreviewComponent: undefined,
  dto: FacebookMarketplaceDto,
  maximumCharacters: 5000,
});
