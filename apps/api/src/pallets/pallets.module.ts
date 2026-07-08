import { Module } from '@nestjs/common';
import { PalletsService } from './pallets.service';
import { PalletsController } from './pallets.controller';
@Module({ providers: [PalletsService], controllers: [PalletsController] })
export class PalletsModule {}
