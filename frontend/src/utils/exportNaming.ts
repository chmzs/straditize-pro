/**
 * Standardized export filename resolution and formatting.
 *
 * Requirements:
 * 1. Format: `{project_name}_stradpro_{suffix}_{YYYYMMDD_HHmm}.{ext}`
 * 2. Precedence:
 *    - User-configured `project_name` (session or method parameter)
 *    - Base image main filename (stripped of `upload://` / `archive://` and extension,
 *      ignoring generic names `original` and `diagram`)
 *    - Fallback: `"straditize"`
 * 3. Sanitization:
 *    - Replace illegal OS filename chars `[\\/*?:"<>|\s]+` with `_`
 *    - Collapse consecutive underscores
 *    - Remove leading/trailing dots and underscores
 * 4. Standardized Suffixes & Extensions:
 *    - Project package: `_project` (`.tar`) -> `_stradpro_project_...`
 *    - Data matrix: `_matrix` (`.csv`) -> `_stradpro_matrix_...`
 *    - Excel report: `_report` (`.xlsx`) -> `_stradpro_report_...`
 *    - Plot bundle: `_plot_bundle` (`.zip`) -> `_stradpro_plot_bundle_...`
 *    - LiPD container: `_lipd` (`.lpd`) -> `_stradpro_lipd_...`
 *    - Stratigraphic diagram: `_strat_diagram` (`.png/.svg`) -> `_stradpro_strat_diagram_...`
 */

export type ExportTypeSuffix =
  | '_project'
  | '_matrix'
  | '_report'
  | '_plot_bundle'
  | '_lipd'
  | '_strat_diagram';

/**
 * Sanitizes a filename stem by replacing illegal characters with underscores,
 * collapsing multiple underscores, and stripping leading/trailing dots and underscores.
 * Falls back to 'straditize' if the result is empty.
 */
export function sanitizeFilenameStem(stem: string | null | undefined): string {
  if (!stem) return 'straditize';
  const trimmed = stem.trim();
  if (!trimmed) return 'straditize';
  let cleaned = trimmed.replace(/[\\/*?:"<>|\s]+/g, '_');
  cleaned = cleaned.replace(/^[._]+|[._]+$/g, '');
  cleaned = cleaned.replace(/_+/g, '_');
  return cleaned || 'straditize';
}

/**
 * Formats a Date object into YYYYMMDD_HHmm (精简至分钟).
 */
export function formatExportTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

/**
 * 从导入的文件名中提取项目前缀名称。
 * 例如：
 * - "pollen_bars_riojaplot_stradpro_project_20261120_1200.tar" -> "pollen_bars_riojaplot"
 * - "pollen_bars_riojaplot_project_20261120_120034.tar" -> "pollen_bars_riojaplot"
 * - "my_lake_core.tar" -> "my_lake_core"
 * - "straditize_stradpro_project_20261120_1200.tar" -> null
 */
export function extractProjectNameFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  let clean = filename.trim().replace(/^.*[\\/]/, '');
  for (const ext of ['.tar.gz', '.tar', '.zip', '.json', '.csv', '.xlsx', '.lpd']) {
    if (clean.toLowerCase().endsWith(ext)) {
      clean = clean.substring(0, clean.length - ext.length);
      break;
    }
  }
  const matchProject = clean.match(/^(.*?)(?:_(?:stradpro_)?project(?:_\d{8}_(?:\d{4}|\d{6})|\d+)?)$/i);
  let stem = matchProject && matchProject[1] ? matchProject[1] : clean;
  const matchOther = stem.match(/^(.*?)(?:_(?:stradpro_)?(?:matrix|report|plot_bundle|lipd|strat_diagram)(?:_\d{8}_(?:\d{4}|\d{6})|\d+)?)$/i);
  if (matchOther && matchOther[1]) {
    stem = matchOther[1];
  }
  const matchTimestamp = stem.match(/^(.*?)(?:_\d{8}_(?:\d{4}|\d{6}))$/);
  if (matchTimestamp && matchTimestamp[1]) {
    stem = matchTimestamp[1];
  }
  const matchStradproTail = stem.match(/^(.*?)_stradpro$/i);
  if (matchStradproTail && matchStradproTail[1]) {
    stem = matchStradproTail[1];
  }
  const sanitized = sanitizeFilenameStem(stem);
  if (!sanitized || ['straditize', 'original', 'diagram'].includes(sanitized.toLowerCase())) {
    return null;
  }
  return sanitized;
}

/**
 * Resolves the project name following precedence:
 * 1. User-configured project_name
 * 2. Base image main filename (ignoring 'original' and 'diagram')
 * 3. Fallback: 'straditize'
 */
export function resolveProjectName(
  projectName?: string | null,
  imageSrcOrName?: string | null
): string {
  // 1. User-configured project_name
  if (projectName && projectName.trim()) {
    let cleaned = projectName.trim().replace(/[\\/*?:"<>|\s]+/g, '_');
    cleaned = cleaned.replace(/^[._]+|[._]+$/g, '');
    cleaned = cleaned.replace(/_+/g, '_');
    if (cleaned) {
      return cleaned;
    }
  }

  // 2. Base image main filename
  if (imageSrcOrName && imageSrcOrName.trim()) {
    let clean = imageSrcOrName.trim().replace(/^upload:\/\//, '').replace(/^archive:\/\//, '');
    if (!clean.startsWith('data:')) {
      clean = clean.split('?')[0].split('#')[0];
      const parts = clean.replace(/\\/g, '/').split('/');
      const basenameWithExt = parts[parts.length - 1];
      const lastDot = basenameWithExt.lastIndexOf('.');
      const base = lastDot > 0 ? basenameWithExt.substring(0, lastDot) : basenameWithExt;
      const baseTrimmed = base.trim();
      const lower = baseTrimmed.toLowerCase();
      if (baseTrimmed && lower !== 'original' && lower !== 'diagram') {
        let cleaned = baseTrimmed.replace(/[\\/*?:"<>|\s]+/g, '_');
        cleaned = cleaned.replace(/^[._]+|[._]+$/g, '');
        cleaned = cleaned.replace(/_+/g, '_');
        if (cleaned) {
          return cleaned;
        }
      }
    }
  }

  // 3. Fallback
  return 'straditize';
}

/**
 * Formats full export filename: `{project_name}_stradpro_{suffix}_{YYYYMMDD_HHmm}.{ext}`
 */
export function resolveExportFilename(
  projectName: string | null | undefined,
  imageSrcOrName: string | null | undefined,
  suffix: ExportTypeSuffix | string,
  ext: string,
  date: Date = new Date()
): string {
  const stem = resolveProjectName(projectName, imageSrcOrName);
  const cleanSuffix = suffix ? suffix.replace(/^_+/, '') : '';
  const cleanExt = ext.replace(/^\./, '');
  const timestamp = formatExportTimestamp(date);
  if (cleanSuffix) {
    return `${stem}_stradpro_${cleanSuffix}_${timestamp}.${cleanExt}`;
  }
  return `${stem}_stradpro_${timestamp}.${cleanExt}`;
}
