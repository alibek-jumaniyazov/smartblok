import { Module } from '@nestjs/common';
import { LegalEntitiesService } from './legal-entities.service';
import { LegalEntitiesController } from './legal-entities.controller';

@Module({ providers: [LegalEntitiesService], controllers: [LegalEntitiesController] })
export class LegalEntitiesModule {}
