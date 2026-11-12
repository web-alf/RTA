import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

/** Format error seragam: { message, details? } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('HTTP');
  catch(exception: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body: any = exception instanceof HttpException ? exception.getResponse() : { message: 'Terjadi kesalahan di server' };
    if (status >= 500) this.log.error(exception?.stack ?? exception);
    const message = Array.isArray(body?.message) ? 'Periksa kembali isian Anda' : body?.message ?? body;
    res.status(status).json({ message, details: Array.isArray(body?.message) ? body.message : undefined });
  }
}
