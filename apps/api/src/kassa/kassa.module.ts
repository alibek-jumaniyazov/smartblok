import { Module } from '@nestjs/common';
import { KassaService } from './kassa.service';
import { KassaController } from './kassa.controller';
@Module({ providers: [KassaService], controllers: [KassaController] })
export class KassaModule {}
