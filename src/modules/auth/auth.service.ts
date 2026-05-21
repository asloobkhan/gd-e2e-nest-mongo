import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { IProfile } from '../profile/profile.model';
import { ProfileService } from '../profile/profile.service';
import { LoginPayload } from './payload/login.payload';

export interface ITokenReturnBody {
  expires: number;
  expiresPrettyPrint: string;
  token: string;
}

@Injectable()
export class AuthService {
  private readonly expiration: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly profileService: ProfileService,
  ) {
    this.expiration = Number(
      this.configService.get<number>('WEBTOKEN_EXPIRATION_TIME') ?? 1800,
    );
  }

  async createToken({
    _id,
    username,
    email,
    avatar,
  }: IProfile): Promise<ITokenReturnBody> {
    return {
      expires: this.expiration,
      expiresPrettyPrint: AuthService.prettyPrintSeconds(this.expiration),
      token: await this.jwtService.signAsync({ _id, username, email, avatar }),
    };
  }

  private static prettyPrintSeconds(time: number): string {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor((time % 3600) % 60);
    return [
      hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
      minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
      seconds > 0 ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  async validateUser(payload: LoginPayload): Promise<IProfile> {
    const user = await this.profileService.getByUsernameAndPass(
      payload.username,
      payload.password,
    );
    if (!user) {
      throw new UnauthorizedException(
        'Could not authenticate. Please try again.',
      );
    }
    return user;
  }
}
