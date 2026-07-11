import { Module } from '@nestjs/common';
import { PalletsController } from './pallets.controller';
import { PalletService } from './pallets.service';

@Module({
  controllers: [PalletsController],
  providers: [PalletService],
  exports: [PalletService],
})
export class PalletsModule {}
