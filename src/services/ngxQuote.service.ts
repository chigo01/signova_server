import { NGX_SPEC, fallbackBoard, quotesFromBoardRows } from "./boardQuote.service";
import type { BoardScannerPayload } from "./boardQuote.service";

export { BOARD_SCAN_COLUMNS as NGX_SCAN_COLUMNS } from "./boardQuote.service";
export type { BoardListing as NgxListing, BoardQuote as NgxQuote } from "./boardQuote.service";

/** @deprecated Use quotesFromBoardRows(NGX_SPEC, payload). Kept for existing tests. */
export function quotesFromScannerRows(payload: BoardScannerPayload) {
  return quotesFromBoardRows(NGX_SPEC, payload);
}

export function fallbackNgxBoard() {
  return fallbackBoard(NGX_SPEC);
}
