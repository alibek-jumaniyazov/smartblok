import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RegionsService } from './regions.service';
import { CreateRegionDto, UpdateRegionDto } from './dto';

@Controller('regions')
export class RegionsController {
  constructor(private service: RegionsService) {}

  @Get()
  @Roles('ADMIN', 'ACCOUNTANT', 'AGENT')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles('ADMIN', 'ACCOUNTANT')
  create(@Body() dto: CreateRegionDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRegionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ACCOUNTANT')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
