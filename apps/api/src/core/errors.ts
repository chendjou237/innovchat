import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Application error rendered as {"error": {"code", "message"}} (SRS §8.5). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const notFound = (message = 'Élément introuvable') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'INTERNAL_ERROR',
      message: 'Une erreur interne est survenue.',
    };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        body = { code: 'DUPLICATE', message: 'Cet élément existe déjà.', details: exception.meta };
      } else if (exception.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Élément introuvable' };
      } else if (exception.code === 'P2003') {
        status = 409;
        body = { code: 'IN_USE', message: 'Élément utilisé ailleurs : suppression impossible.' };
      } else {
        this.logger.error(exception);
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string }).message ?? exception.message);
      body = { code: status === 404 ? 'NOT_FOUND' : `HTTP_${status}`, message: String(message) };
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    res.status(status).json({ error: body });
  }
}
