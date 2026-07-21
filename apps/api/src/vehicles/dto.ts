import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

/**
 * List query. `active` must be declared explicitly: main.ts runs the ValidationPipe with
 * forbidNonWhitelisted, so an undeclared ?active= would 400 instead of filtering.
 */
export class VehicleQueryDto extends PageQueryDto {
  /**
   * ⚠ Read `obj` (the RAW query object), never `value`. main.ts enables
   * enableImplicitConversion, which coerces the query string to the reflected type
   * FIRST — and Boolean('false') === true, so `value` would already be `true` here
   * and ?active=false would silently return only the ACTIVE vehicles.
   */
  @IsOptional()
  @Transform(({ obj }) => {
    const raw = (obj as Record<string, unknown>)?.active;
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return undefined;
  })
  @IsBoolean()
  active?: boolean;
}

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  // `| null` on the text fields: the web sends an explicit null to CLEAR a value.
  // @IsOptional() already skips null, so it validates and reaches the service, where
  // cleanPlate/cleanText turn ''/'   '/null into a real NULL column value.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  driver?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

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
  plate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  driver?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(40)
  capacityPallets?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
