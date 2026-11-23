export const GRID_COLS = 8;
export const GRID_ROWS = 6;
export const TILE_COUNT = GRID_COLS * GRID_ROWS;
export const TILE_GUTTER = 2;

export interface HfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Tile {
  index: number;
  col: number;
  row: number;
  scale: number;
  protectedByHf: boolean;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  error: number;
  edgeError: number;
  edgeDensity: number;
  seamError: number;
}

export interface TileLayout {
  width: number;
  height: number;
  gaze: readonly [number, number];
  cells: Tile[];
  baseCellWidth: number;
  baseCellHeight: number;
  cellWidth: number;
  cellHeight: number;
  atlasWidth: number;
  atlasHeight: number;
  sampledPixels: number;
  fullPixels: number;
  ratio: number;
  scalesChanged: number;
}

function intersects(a: HfRect, b: HfRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function computeTileLayout(
  width: number,
  height: number,
  gaze: readonly [number, number],
  hfRects: readonly HfRect[],
  previous?: TileLayout | null,
): TileLayout {
  const baseCellWidth = Math.ceil(width / GRID_COLS);
  const baseCellHeight = Math.ceil(height / GRID_ROWS);
  const cellWidth = baseCellWidth + TILE_GUTTER * 2;
  const cellHeight = baseCellHeight + TILE_GUTTER * 2;
  const cells: Tile[] = [];
  let sampledPixels = 0;
  let scalesChanged = 0;

  const retinaX = Math.max(height * 0.155, width * 0.105);
  const retinaY = height * 0.155;

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const index = row * GRID_COLS + col;
      const cell: HfRect = {
        x0: col / GRID_COLS,
        y0: row / GRID_ROWS,
        x1: (col + 1) / GRID_COLS,
        y1: (row + 1) / GRID_ROWS,
      };
      const protectedByHf = hfRects.some((rect) => intersects(cell, rect));
      const centerX = (cell.x0 + cell.x1) * 0.5;
      const centerY = (cell.y0 + cell.y1) * 0.5;
      const dx = (centerX - gaze[0]) * width;
      const dy = (centerY - gaze[1]) * height;
      const distance = Math.hypot(dx / retinaX, dy / retinaY);
      let scale = 0.25;
      if (distance <= 1.0) scale = 1;
      else if (distance <= 1.9) scale = 0.5;
      if (protectedByHf) scale = 1;

      const targetWidth = Math.max(1, Math.round((width / GRID_COLS) * scale));
      const targetHeight = Math.max(1, Math.round((height / GRID_ROWS) * scale));
      const previousTile = previous?.cells[index];
      if (previousTile && previousTile.scale !== scale) scalesChanged += 1;

      cells.push({
        index,
        col,
        row,
        scale,
        protectedByHf,
        width: width / GRID_COLS,
        height: height / GRID_ROWS,
        targetWidth,
        targetHeight,
        error: previousTile?.error ?? 0,
        edgeError: previousTile?.edgeError ?? 0,
        edgeDensity: previousTile?.edgeDensity ?? 0,
        seamError: previousTile?.seamError ?? 0,
      });
      sampledPixels += targetWidth * targetHeight;
    }
  }

  const fullPixels = width * height;
  return {
    width,
    height,
    gaze,
    cells,
    baseCellWidth,
    baseCellHeight,
    cellWidth,
    cellHeight,
    atlasWidth: cellWidth * GRID_COLS,
    atlasHeight: cellHeight * GRID_ROWS,
    sampledPixels,
    fullPixels,
    ratio: sampledPixels / fullPixels,
    scalesChanged,
  };
}

export function tileScreenBounds(tile: Tile, layout: TileLayout): HfRect {
  return {
    x0: (tile.col / GRID_COLS) * layout.width,
    y0: (tile.row / GRID_ROWS) * layout.height,
    x1: ((tile.col + 1) / GRID_COLS) * layout.width,
    y1: ((tile.row + 1) / GRID_ROWS) * layout.height,
  };
}
