import { ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

export type AuthUser = {
  id: number; name: string; email: string; role: string; perms: string[];
  branchIds: number[] | null; // null = semua cabang
  mustChangePassword: boolean;
};

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const PERMS = 'perms';
export const Perm = (...perms: string[]) => SetMetadata(PERMS, perms);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Silakan masuk terlebih dahulu');
    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Sesi berakhir, silakan masuk lagi');
    }
    const need = this.reflector.getAllAndOverride<string[]>(PERMS, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const has = need.every((p) => req.user.perms.includes(p));
    if (!has) throw new ForbiddenException('Anda tidak punya akses ke data ini');
    return true;
  }
}

/** Pastikan user boleh mengakses cabang tertentu; lempar 404 (bukan 403) agar tidak membocorkan keberadaan data. */
export function assertBranch(user: AuthUser, branchId: number) {
  if (user.branchIds && !user.branchIds.includes(branchId)) throw new ForbiddenException('Anda tidak punya akses ke data ini');
}
