import { Module } from '@nestjs/common';
import { PalletsModule } from '../pallets/pallets.module';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { AgentKpiService } from './agent-kpi.service';
@Module({ imports: [PalletsModule], providers: [AgentsService, AgentKpiService], controllers: [AgentsController], exports: [AgentKpiService] })
export class AgentsModule {}
