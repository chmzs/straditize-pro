/**
 * 导出表格数据矩阵变换纯函数：处理用户微调覆盖、浮点精度格式化、按深度/原始多模式升降序。
 */

export interface TransformOptions {
  digits?: number | null;
  sortBy?: 'depth' | 'raw';
  sortOrder?: 'asc' | 'desc';
}

export interface TransformedMatrix {
  headers: string[];
  rows: string[][];
  rowOrigIndices: number[];
}

export function transformMatrix(
  rawHeaders: string[],
  rawRows: string[][],
  userEdits: Map<string, string>,
  options: TransformOptions = {}
): TransformedMatrix {
  const headers = [...rawHeaders];
  const digits =
    options.digits !== undefined && options.digits !== null && !isNaN(options.digits)
      ? Math.max(0, Math.min(6, options.digits))
      : 2;

  // 1. 合并用户编辑与浮点精度格式化
  const formattedRows = rawRows.map((row, origIdx) => {
    const cells = row.map((rawCell, cIdx) => {
      const editKey = `${origIdx}_${cIdx}`;
      if (userEdits.has(editKey)) {
        return userEdits.get(editKey)!;
      }
      if (rawCell !== '' && !isNaN(Number(rawCell))) {
        const num = Number(rawCell);
        return Number.isFinite(num) ? num.toFixed(digits) : rawCell;
      }
      return rawCell;
    });
    return { origIdx, cells };
  });

  // 2. 排序
  const sortBy = options.sortBy || 'depth';
  const sortOrder = options.sortOrder || 'asc';

  if (sortBy === 'depth') {
    const depthIdx = headers.findIndex((h) => {
      const lower = h.toLowerCase();
      return lower === 'depth' || lower === 'age';
    });
    const sortCol = depthIdx >= 0 ? depthIdx : 0;
    formattedRows.sort((a, b) => {
      const valA = parseFloat(a.cells[sortCol]);
      const valB = parseFloat(b.cells[sortCol]);
      const numA = Number.isFinite(valA) ? valA : 0;
      const numB = Number.isFinite(valB) ? valB : 0;
      return sortOrder === 'desc' ? numB - numA : numA - numB;
    });
  } else if (sortBy === 'raw') {
    if (sortOrder === 'desc') {
      formattedRows.reverse();
    }
  }

  return {
    headers,
    rows: formattedRows.map((r) => r.cells),
    rowOrigIndices: formattedRows.map((r) => r.origIdx),
  };
}
