import { LegalEntityKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLegalEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEnum(LegalEntityKind)
  kind!: LegalEntityKind;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateLegalEntityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(LegalEntityKind)
  kind?: LegalEntityKind;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
