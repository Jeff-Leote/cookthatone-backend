import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller()
export class AppController {
  @Get('health')
  @SkipThrottle()
  getHealth() {
    return { status: 'ok' };
  }
}
