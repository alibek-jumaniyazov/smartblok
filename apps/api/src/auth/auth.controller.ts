import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, UpdateProfileDto } from './dto';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts/min per IP: brute-force brake
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.validateAndLogin(dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER')
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.auth.me(userId);
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT', 'CASHIER')
  @Put('me')
  updateProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(userId, dto);
  }
}
