import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : undefined;
    if (status >= 500) this.logger.error((exception as Error)?.message ?? exception);
    const body =
      typeof payload === 'object' && payload !== null
        ? ({ ...(payload as Record<string, unknown>) } as Record<string, unknown>)
        : { message: exception instanceof HttpException ? exception.message : 'Internal server error' };
    response.status(status).json({
      statusCode: status,
      message: body.message ?? body.error ?? 'Internal server error',
      error: body.error,
      failureReason: body.failureReason,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
