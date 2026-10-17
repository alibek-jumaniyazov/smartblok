import { Module } from '@nestjs/common';
import { PalletsController } from './pallets.controller';
import { PalletService } from './pallets.service';
import { FactoryPalletShipmentService } from './factory-pallet-shipment.service';

@Module({
  controllers: [PalletsController],
  providers: [PalletService, FactoryPalletShipmentService],
  exports: [PalletService],
})
export class PalletsModule {}
