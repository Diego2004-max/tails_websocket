/**
 * Integration event published inside the same Lua script that applies a sheet.
 * Sheets produces it; broadcast consumes it. Neither module calls the other.
 */
export interface SheetEvent {
  id: string;
  sheetId: string;
  table: number;
  station: number;
  municipality: number;
  version: number;
  correction: boolean;
  delta: Record<string, number>;
  at: number;
}
