/**
 * Standardized export filename resolution and formatting.
 *
 * Requirements:
 * 1. Format: `{project_name}{suffix}_{YYYYMMDD_HHmmss}.{ext}`
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
 *    - Project package: `_project` (`.tar`)
 *    - Data matrix: `_matrix` (`.csv`)
 *    - Excel report: `_report` (`.xlsx`)
 *    - Plot bundle: `_plot_bundle` (`.zip`)
 *    - LiPD container: `_lipd` (`.lpd`)
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
 * Formats a Date object into YYYYMMDD_HHmmss.
 */
export function formatExportTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
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
 * Formats full export filename: `{project_name}{suffix}_{YYYYMMDD_HHmmss}.{ext}`
 */
export function resolveExportFilename(
  projectName: string | null | undefined,
  imageSrcOrName: string | null | undefined,
  suffix: ExportTypeSuffix | string,
  ext: string,
  date: Date = new Date()
): string {
  const stem = resolveProjectName(projectName, imageSrcOrName);
  const cleanSuffix = suffix ? (suffix.startsWith('_') ? suffix : `_${suffix}`) : '';
  const cleanExt = ext.replace(/^\./, '');
  const timestamp = formatExportTimestamp(date);
  return `${stem}${cleanSuffix}_${timestamp}.${cleanExt}`;
}
