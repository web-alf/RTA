import { IsEmail, IsOptional, IsString, MinLength, Matches } from 'class-validator';
export class LoginDto { @IsEmail() email: string; @IsString() @MinLength(1) password: string; }
export class ChangePasswordDto {
  @IsString() oldPassword: string;
  @IsString() @MinLength(8, { message: 'Password minimal 8 karakter' })
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'Password harus memuat huruf dan angka' })
  newPassword: string;
}
export class ProfileDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @Matches(/^(\+62|62|0)8[0-9]{7,12}$/, { message: 'Nomor WA harus diawali 08 atau +62' }) phone?: string;
}
