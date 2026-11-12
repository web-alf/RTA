import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, ProfileDto } from './auth.dto';
import { CurrentUser, Public } from '../../common/auth';
import type { AuthUser } from '../../common/auth';

const COOKIE = 'rta_refresh';
// IP dari req.ip (mengikuti TRUST_PROXY di main.ts), sama dengan yang dipakai pembatas login; header X-Forwarded-For mentah bisa dipalsukan
const meta = (req: Request) => ({ ua: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? req.socket?.remoteAddress ?? '' });
const cookieOpts = () => ({
  httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/',
  maxAge: Number(process.env.REFRESH_TTL_DAYS ?? 14) * 86400_000,
});

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // batas per IP: 10 percobaan / menit
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(dto.email, dto.password, meta(req));
    res.cookie(COOKIE, r.refreshToken, cookieOpts());
    return { user: r.user, accessToken: r.accessToken };
  }

  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.refresh(req.cookies?.[COOKIE], meta(req));
    res.cookie(COOKIE, r.refreshToken, cookieOpts());
    return { user: r.user, accessToken: r.accessToken };
  }

  @Public() @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me') me(@CurrentUser() user: AuthUser) { return user; }

  /** Ganti password: semua sesi lama dicabut, sesi saat ini diterbitkan ulang. */
  @Post('change-password') @HttpCode(200)
  async change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword);
    const fresh = await this.auth.buildAuthUser(user.id);
    res.cookie(COOKIE, await this.auth.issueRefresh(user.id, null, meta(req)), cookieOpts());
    return { user: fresh, accessToken: await this.auth.signAccess(fresh) };
  }

  // ---------- Profil & perangkat ----------
  @Get('profile') profile(@CurrentUser() u: AuthUser) { return this.auth.profile(u.id); }
  @Patch('profile') updateProfile(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) { return this.auth.updateProfile(u.id, dto); }
  @Patch('prefs') prefs(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) { return this.auth.updatePrefs(u.id, body ?? {}); }
  @Get('sessions') sessions(@CurrentUser() u: AuthUser, @Req() req: Request) { return this.auth.sessions(u.id, req.cookies?.[COOKIE]); }
  @Post('sessions/:sid/revoke') @HttpCode(200) revoke(@CurrentUser() u: AuthUser, @Param('sid') sid: string) { return this.auth.revokeSession(u.id, sid); }
  @Post('logout-all') @HttpCode(200)
  async logoutAll(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) { res.clearCookie(COOKIE, { path: '/' }); return this.auth.logoutAll(u.id); }
}
