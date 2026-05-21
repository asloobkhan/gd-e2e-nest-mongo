import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ProfileController } from './profile.controller';
import { Profile, PROFILE_MODEL_NAME } from './profile.model';
import { ProfileService } from './profile.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PROFILE_MODEL_NAME, schema: Profile }]),
  ],
  providers: [ProfileService],
  controllers: [ProfileController],
  exports: [ProfileService, MongooseModule],
})
export class ProfileModule {}
