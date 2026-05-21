import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ACGuard, UseRoles } from 'nest-access-control';

import { PatchProfilePayload } from './payload/patch.profile.payload';
import { IProfile } from './profile.model';
import { IGenericMessageBody, ProfileService } from './profile.service';

@ApiBearerAuth()
@ApiTags('profile')
@Controller('api/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':username')
  @UseGuards(AuthGuard('jwt'))
  @ApiResponse({ status: 200, description: 'Fetch Profile Request Received' })
  @ApiResponse({ status: 400, description: 'Fetch Profile Request Failed' })
  async getProfile(@Param('username') username: string): Promise<IProfile> {
    const profile = await this.profileService.getByUsername(username);
    if (!profile) {
      throw new BadRequestException(
        'The profile with that username could not be found.',
      );
    }
    return profile;
  }

  @Patch()
  @UseGuards(AuthGuard('jwt'), ACGuard)
  @UseRoles({ resource: 'profiles', action: 'update', possession: 'any' })
  @ApiResponse({ status: 200, description: 'Patch Profile Request Received' })
  @ApiResponse({ status: 400, description: 'Patch Profile Request Failed' })
  async patchProfile(@Body() payload: PatchProfilePayload): Promise<IProfile> {
    return this.profileService.edit(payload);
  }

  @Delete(':username')
  @UseGuards(AuthGuard('jwt'), ACGuard)
  @UseRoles({ resource: 'profiles', action: 'delete', possession: 'any' })
  @ApiResponse({ status: 200, description: 'Delete Profile Request Received' })
  @ApiResponse({ status: 400, description: 'Delete Profile Request Failed' })
  async delete(
    @Param('username') username: string,
  ): Promise<IGenericMessageBody> {
    return this.profileService.delete(username);
  }
}
