import { Module } from '@nestjs/common';
import { PalletsModule } from '../pallets/pallets.module';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
@Module({ imports: [PalletsModule], providers: [AgentsService], controllers: [AgentsController] })
export class AgentsModule {}
