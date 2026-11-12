import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { FamilyDto } from '../families/families.module';

export class StudentDto {
  @IsString() @MinLength(2) fullName: string;
  @IsOptional() @IsString() nickname?: string;
  @IsIn(['L', 'P']) gender: 'L' | 'P';
  @IsString() @MinLength(2) birthPlace: string;
  @IsDateString() birthDate: string;
  @IsOptional() @IsString() school?: string;
  @IsInt() branchId: number;
  @IsInt() classId: number;
  @IsDateString() joinDate: string;
  @IsIn(['INDENT', 'AKTIF']) status: 'INDENT' | 'AKTIF';
  @IsOptional() @IsString() healthNotes?: string;
  @IsOptional() @IsString() registrationNote?: string; // keterangan pendaftaran
  @IsOptional() @IsInt() subsidyId?: number;          // kategori subsidi dari menu Pengaturan, sensitif (PJ)
  // salah satu: keluarga yang sudah ada, atau keluarga baru
  @IsOptional() @IsInt() familyId?: number;
  @IsOptional() @ValidateNested() @Type(() => FamilyDto) family?: FamilyDto;
}
export class UpdateStudentDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsIn(['L', 'P']) gender?: 'L' | 'P';
  @IsOptional() @IsString() birthPlace?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() school?: string;
  @IsOptional() @IsString() healthNotes?: string;
  @IsOptional() @IsString() registrationNote?: string;
  @IsOptional() @IsInt() classId?: number; // kenaikan jenjang dalam cabang yang sama (PJ)
  @IsOptional() @IsInt() sppRate?: number;          // tarif khusus (PJ)
  @IsOptional() @IsInt() subsidyId?: number | null;  // kategori subsidi (PJ); null = cabut subsidi
}
export class StatusDto {
  @IsIn(['CUTI', 'AKTIF', 'MULAI']) action: 'CUTI' | 'AKTIF' | 'MULAI'; // MULAI = Indent -> Aktif
  @IsDateString() effectiveDate: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() note?: string;
}
export class RequestDto {
  @IsIn(['KELUAR', 'MUTASI']) type: 'KELUAR' | 'MUTASI';
  @IsDateString() effectiveDate: string;
  @IsString() @MinLength(2) reason: string;
  @IsOptional() @IsInt() targetBranchId?: number;
  @IsOptional() @IsInt() targetClassId?: number;
  @IsOptional() @IsString() note?: string;
}
