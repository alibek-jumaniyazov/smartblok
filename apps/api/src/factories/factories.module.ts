import { Module } from '@nestjs/common';
import { FactoriesService } from './factories.service';
import { FactoriesController } from './factories.controller';

@Module({ providers: [FactoriesService], controllers: [FactoriesController] })
export class FactoriesModule {}
