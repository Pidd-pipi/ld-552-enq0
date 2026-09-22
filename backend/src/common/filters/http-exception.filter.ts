import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const base = exception instanceof HttpException ? exception.getResponse() : null;
    const body = typeof base === 'object' && base !== null
      ? { ...(base as Record<string, unknown>) }
      : { message: exception instanceof HttpException ? exception.message : 'Internal server error' };
    response.status(status).json({ statusCode: status, ...body, path: request.url, timestamp: new Date().toISOString() });
  }
}
