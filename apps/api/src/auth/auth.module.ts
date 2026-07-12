import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { requireJwtSecret } from '../common/jwt-secret';

@Module({
  imports: [
    PassportModule,
    // registerAsync so the secret is read AFTER ConfigModule loads .env (the old register() ran at
    // import time, before env was loaded, silently signing with the hardcoded dev fallback).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        // the runtime env + bootstrap script write JWT_EXPIRES; read that first (keep
        // JWT_EXPIRES_IN as a compat alias) and default to 12h — matching owner intent,
        // not the old silent 7d fallback that shipped when neither key matched.
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES') || config.get<string>('JWT_EXPIRES_IN') || '12h',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
