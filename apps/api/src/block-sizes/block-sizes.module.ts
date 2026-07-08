import { Module } from '@nestjs/common';
import { BlockSizesService } from './block-sizes.service';
import { BlockSizesController } from './block-sizes.controller';
@Module({ providers: [BlockSizesService], controllers: [BlockSizesController] })
export class BlockSizesModule {}
