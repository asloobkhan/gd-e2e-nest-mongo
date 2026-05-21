import {
  BadRequestException,
  Injectable,
  NotAcceptableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import { url as gravatarUrl } from 'gravatar';
import { Model } from 'mongoose';

import { RegisterPayload } from '../auth/payload/register.payload';
import { AppRoles } from '../app/app.roles';
import { PatchProfilePayload } from './payload/patch.profile.payload';
import { IProfile, PROFILE_MODEL_NAME } from './profile.model';

export interface IGenericMessageBody {
  message: string;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(PROFILE_MODEL_NAME)
    private readonly profileModel: Model<IProfile>,
  ) {}

  get(id: string): Promise<IProfile | null> {
    return this.profileModel.findById(id).exec();
  }

  getByUsername(username: string): Promise<IProfile | null> {
    return this.profileModel.findOne({ username }).exec();
  }

  list(limit = 25): Promise<IProfile[]> {
    return this.profileModel
      .find()
      .limit(Math.max(1, Math.min(limit, 200)))
      .exec();
  }

  getByUsernameAndPass(
    username: string,
    password: string,
  ): Promise<IProfile | null> {
    return this.profileModel
      .findOne({
        username,
        password: crypto.createHmac('sha256', password).digest('hex'),
      })
      .exec();
  }

  async create(payload: RegisterPayload): Promise<IProfile> {
    const existing = await this.getByUsername(payload.username);
    if (existing) {
      throw new NotAcceptableException(
        'The account with the provided username currently exists. Please choose another one.',
      );
    }
    const created = new this.profileModel({
      ...payload,
      password: crypto.createHmac('sha256', payload.password).digest('hex'),
      avatar: gravatarUrl(payload.email, {
        protocol: 'http',
        s: '200',
        r: 'pg',
        d: '404',
      }),
      roles: [AppRoles.ADMIN],
    });
    return created.save();
  }

  async edit(payload: PatchProfilePayload): Promise<IProfile> {
    const { username } = payload;
    const updates: Partial<PatchProfilePayload> & { password?: string } = {
      ...payload,
    };
    if (payload.password && payload.password.length > 0) {
      updates.password = crypto
        .createHmac('sha256', payload.password)
        .digest('hex');
    } else {
      delete updates.password;
    }
    const result = await this.profileModel
      .updateOne({ username }, updates)
      .exec();
    if (result.matchedCount !== 1) {
      throw new BadRequestException(
        'The profile with that username does not exist in the system. Please try another username.',
      );
    }
    const updated = await this.getByUsername(username);
    if (!updated) {
      throw new BadRequestException(
        'Profile was edited but could not be re-read.',
      );
    }
    return updated;
  }

  async delete(username: string): Promise<IGenericMessageBody> {
    const result = await this.profileModel.deleteOne({ username }).exec();
    if (result.deletedCount === 1) {
      return { message: `Deleted ${username} from records` };
    }
    throw new BadRequestException(
      `Failed to delete a profile by the name of ${username}.`,
    );
  }
}
