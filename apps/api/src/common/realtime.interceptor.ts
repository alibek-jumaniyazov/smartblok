import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RealtimeEntity, RealtimeService } from './realtime.service';

/** controller class → broadcast entity (+ whether cashiers care) */
const ENTITY_BY_CONTROLLER: Record<string, { entity: RealtimeEntity; cashier?: boolean }> = {
  OrdersController: { entity: 'order' },
  PaymentsController: { entity: 'payment', cashier: true },
  KassaController: { entity: 'kassa', cashier: true },
  ExpensesController: { entity: 'expense', cashier: true },
  BonusController: { entity: 'bonus', cashier: true },
  PalletsController: { entity: 'pallet' },
  ClientsController: { entity: 'client' },
};

/**
 * Global write-broadcast: any successful non-GET handler on a financial
 * controller emits a thin change event AFTER the handler resolved — i.e. after
 * its transaction committed. Handlers stay oblivious; new endpoints on these
 * controllers are covered automatically.
 */
@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    if (req.method === 'GET') return next.handle();

    const spec = ENTITY_BY_CONTROLLER[context.getClass().name];
    if (!spec) return next.handle();

    const action = `${req.method.toLowerCase()}:${context.getHandler().name}`;
    return next.handle().pipe(
      tap((result: any) => {
        this.realtime.emit({
          entity: spec.entity,
          action,
          id: typeof result?.id === 'string' ? result.id : (req.params?.id ?? undefined),
          agentId: typeof result?.agentId === 'string' ? result.agentId : undefined,
          cashier: spec.cashier,
        });
      }),
    );
  }
}
