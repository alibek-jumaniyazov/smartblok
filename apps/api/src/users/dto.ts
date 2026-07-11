import { Role } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9]+$/, { message: "username faqat lotin harflari va raqamlardan iborat bo'lishi kerak" })
  username!: string;

  @IsString()
  @MinLength(8, { message: "parol kamida 8 belgidan iborat bo'lishi kerak" })
  @MaxLength(128)
  password!: string;

  @IsString()
  @Length(1, 128)
  name!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  /** required when role = AGENT */
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-zA-Z0-9]+$/, { message: "username faqat lotin harflari va raqamlardan iborat bo'lishi kerak" })
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: "parol kamida 8 belgidan iborat bo'lishi kerak" })
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsUUID()
  agentId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
