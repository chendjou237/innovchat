import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IMPORT_KINDS, ImportKind } from '@innovcare/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { badRequest } from '../core/errors';
import { sendBuffer } from '../core/xlsx';
import { ImportsService } from './imports.service';

function kindOf(v: unknown): ImportKind {
  const k = String(v ?? 'STUDENTS').toUpperCase();
  if (!(IMPORT_KINDS as readonly string[]).includes(k)) throw badRequest('INVALID_KIND', 'Type d’import inconnu.');
  return k as ImportKind;
}

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  list() {
    return this.imports.list();
  }

  @Get('template')
  async template(@Query('kind') kind: string, @Res() res: Response) {
    const k = kindOf(kind);
    sendBuffer(res, k === 'STUDENTS' ? 'modele-import-eleves.xlsx' : 'modele-import-paiements.xlsx', await this.imports.template(k));
  }

  /** Multipart upload: field "file" (.xlsx or .csv), field "kind" (STUDENTS | PAYMENTS). */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@CurrentUser() me: SessionUser, @UploadedFile() file: Express.Multer.File | undefined, @Body('kind') kind: string) {
    if (!file) throw badRequest('NO_FILE', 'Aucun fichier reçu.');
    return this.imports.upload(kindOf(kind), file.originalname, file.buffer, me.id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.view(id);
  }

  @Post(':id/commit')
  @HttpCode(200)
  commit(@CurrentUser() me: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.commit(id, me.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await this.imports.cancel(id);
    return { ok: true };
  }

  @Get(':id/errors')
  async errors(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendBuffer(res, 'lignes-en-erreur.xlsx', await this.imports.errorFile(id));
  }
}
