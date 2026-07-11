import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Registered globally (APP_GUARD), after JwtAuthGuard.
 * DEFAULT-DENY: a route with no @Roles() metadata is ADMIN-only and logged —
 * forgetting the annotation must never silently open an endpoint to everyone
 * (the v2 fail-open guard was the root enabler of the IDOR findings).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Ruxsat yetarli emas');

    if (!required || required.length === 0) {
      if (user.role === 'ADMIN') {
        this.logger.warn(
          `Route ${context.getClass().name}.${context.getHandler().name} has no @Roles() — allowed for ADMIN only. Annotate it.`,
        );
        return true;
      }
      throw new ForbiddenException('Ruxsat yetarli emas');
    }
    if (required.includes(user.role)) return true;
    throw new ForbiddenException('Ruxsat yetarli emas');
  }
}
