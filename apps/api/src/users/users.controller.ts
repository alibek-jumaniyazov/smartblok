import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}
  @Get() findAll() { return this.service.findAll(); }
  @Post() create(@Body() d: any) { return this.service.create(d); }
  @Put(':id') update(@Param('id') id: string, @Body() d: any) { return this.service.update(id, d); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
