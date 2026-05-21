import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';

import { IProfile } from '../profile/profile.model';
import { ProfileService } from '../profile/profile.service';

interface JwtTokenPayload {
  _id: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly profileService: ProfileService,
  ) {
    const secret = configService.get<string>('WEBTOKEN_SECRET_KEY');
    if (!secret) {
      throw new Error('WEBTOKEN_SECRET_KEY is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    } satisfies StrategyOptionsWithoutRequest);
  }

  async validate({ _id }: JwtTokenPayload): Promise<IProfile> {
    const user = await this.profileService.get(_id);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
