import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireJwtSecret } from '../common/jwt-secret';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(config),
    });
  }

  // Re-validate against the DB on every request: a deactivated user or a bumped
  // tokenVersion (password change, forced logout) invalidates existing JWTs
  // immediately instead of after up to token-lifetime days.
  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, name: true, agentId: true, active: true, tokenVersion: true },
    });
    if (!user || !user.active || user.tokenVersion !== (payload.tv ?? 0)) {
      throw new UnauthorizedException('Sessiya bekor qilingan');
    }
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      agentId: user.agentId ?? null,
    };
  }
}
