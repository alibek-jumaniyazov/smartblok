import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class SvodQueryDto {
  /** 'YYYY-MM-DD' (Tashkent-local day) or full ISO datetime */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class OrdersRegisterQueryDto extends PageQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  factoryId?: string;
}
