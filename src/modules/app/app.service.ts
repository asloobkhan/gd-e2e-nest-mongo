import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class AppService {
  constructor(
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  root(): string {
    const appURL = this.config.get<string>('APP_URL') ?? '';
    this.logger.info(`Logging the APP_URL -> ${appURL}`);
    return appURL;
  }
}
