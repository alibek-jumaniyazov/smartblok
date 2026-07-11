import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  driver?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** pallets per truck; schema default 19 when omitted */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  capacityPallets?: number;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  driver?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  capacityPallets?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
