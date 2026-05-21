import { Body, Controller, Post } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

import { ProfileService } from '../profile/profile.service';
import { AuthService, ITokenReturnBody } from './auth.service';
import { LoginPayload } from './payload/login.payload';
import { RegisterPayload } from './payload/register.payload';

@Controller('api/auth')
@ApiTags('authentication')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly profileService: ProfileService,
  ) {}

  @Post('login')
  @ApiResponse({ status: 201, description: 'Login Completed' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Body() payload: LoginPayload): Promise<ITokenReturnBody> {
    const user = await this.authService.validateUser(payload);
    return this.authService.createToken(user);
  }

  @Post('register')
  @ApiResponse({ status: 201, description: 'Registration Completed' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async register(@Body() payload: RegisterPayload): Promise<ITokenReturnBody> {
    const user = await this.profileService.create(payload);
    return this.authService.createToken(user);
  }
}
