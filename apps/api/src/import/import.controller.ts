import { BadRequestException, Controller, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ACCOUNTANT')
@Controller('import')
export class ImportController {
  constructor(private service: ImportService) {}

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async excel(@UploadedFile() file: any, @Query('replace') replace?: string) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuborilmadi');
    return this.service.importWorkbook(file.buffer, replace === 'true' || replace === '1');
  }
}
