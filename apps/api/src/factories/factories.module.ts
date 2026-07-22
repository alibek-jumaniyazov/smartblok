import { Module } from '@nestjs/common';
import { FactoriesService } from './factories.service';
import { FactoriesController } from './factories.controller';
import { PalletsModule } from '../pallets/pallets.module';

// PalletsModule: the factory card reads pallet COUNTS from the one canonical formula
// instead of re-deriving them (the two used to disagree after an order cancel).
@Module({ imports: [PalletsModule], providers: [FactoriesService], controllers: [FactoriesController] })
export class FactoriesModule {}
