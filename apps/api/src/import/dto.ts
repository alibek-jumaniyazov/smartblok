import { IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class PatchRowDto {
  @IsObject()
  patch!: Record<string, unknown>;
}

export class ResolveIssueDto {
  @IsIn(['ACCEPTED', 'EDITED', 'IGNORED'])
  status!: 'ACCEPTED' | 'EDITED' | 'IGNORED';

  @IsOptional()
  value?: unknown;
}

export class ResolveEntityDto {
  // The final canonical client name the owner chose/typed for this raw name.
  @IsString()
  @MinLength(1)
  name!: string;
}

export class CommitDto {
  @IsString()
  @MinLength(8)
  confirmToken!: string;
}
