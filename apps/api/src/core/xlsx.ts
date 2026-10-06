import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface Column {
  header: string;
  key: string;
  width?: number;
}

export async function buildXlsx(sheetName: string, columns: Column[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function sendBuffer(res: Response, filename: string, buf: Buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

export async function sendXlsx(res: Response, filename: string, sheetName: string, columns: Column[], rows: Record<string, unknown>[]) {
  sendBuffer(res, filename, await buildXlsx(sheetName, columns, rows));
}
