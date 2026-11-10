/**
 * 极简 ZIP 写入器：只用 STORE（不压缩）+ CRC32。
 *
 * ## 为什么自己写
 *
 * 诊断导出只需要把十几个小文件装进一个容器，压缩率毫无意义；而为此新增
 * `jszip` / `fflate` 这类依赖，等于为了一个只在 `?diag=1` 时才跑一次的调试
 * 功能，永久拉高生产包体积与供应链面。STORE 模式的 ZIP 格式本身只有三段
 * 定长头（本地文件头 / 中央目录项 / 目录结束标记），CRC32 是一张 256 项查表，
 * 加起来不到 100 行，且零依赖。
 *
 * ## 与「压缩 ZIP」唯一的语义差别
 *
 * `method = 0`（不压缩）。所有主流解压器（含 `unzip -l`、Windows 资源管理器、
 * 7-Zip）都支持；只是这些文件不会被压小。
 *
 * 文件名固定走 UTF-8 标志位（通用标志位 bit 11 = 0x0800），中文名也不会乱码。
 */

export interface ZipEntry {
  /** 条目路径。使用 `/` 作为分隔符，且不得以 `/` 开头。 */
  name: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 标准 CRC-32（IEEE 802.3，多项式 0xEDB88320）。 */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS 时间戳（ZIP 头里的 16 位日期/时间对）。 */
function dosDateTime(when: Date): { dtime: number; ddate: number } {
  const year = Math.max(1980, when.getFullYear());
  const dtime =
    (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2);
  const ddate = ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  return { dtime: dtime & 0xffff, ddate: ddate & 0xffff };
}

/**
 * 把条目列表打成 ZIP 字节流（STORE + CRC32）。
 *
 * 中央目录的 `offset` 必须在写本地头的同时累加，所以这里不用「先拼再扫」的写法，
 * 而是顺序生成三段各自独立的缓冲区，最后一次性合并。
 */
export function buildStoreZip(entries: ZipEntry[], when: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { dtime, ddate } = dosDateTime(when);

  const blocks: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 本地文件头签名
    lv.setUint16(4, 20, true); // 解压所需版本 2.0
    lv.setUint16(6, 0x0800, true); // bit 11：文件名 UTF-8
    lv.setUint16(8, 0, true); // 压缩方法 0 = STORE
    lv.setUint16(10, dtime, true);
    lv.setUint16(12, ddate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // 压缩后大小
    lv.setUint32(22, size, true); // 未压缩大小
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra 字段长度
    local.set(nameBytes, 30);

    blocks.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // 中央目录项签名
    cv.setUint16(4, 20, true); // 创建版本
    cv.setUint16(6, 20, true); // 解压所需版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dtime, true);
    cv.setUint16(14, ddate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // 起始磁盘号
    cv.setUint16(36, 0, true); // 内部属性
    cv.setUint32(38, 0, true); // 外部属性
    cv.setUint32(42, offset, true); // 本地头偏移
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length + size;
  }

  const centralSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // 目录结束签名
  ev.setUint16(4, 0, true); // 本磁盘号
  ev.setUint16(6, 0, true); // 目录所在磁盘号
  ev.setUint16(8, entries.length, true); // 本磁盘条目数
  ev.setUint16(10, entries.length, true); // 总条目数
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // 注释长度

  const total =
    blocks.reduce((sum, b) => sum + b.length, 0) + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }
  for (const header of centralHeaders) {
    out.set(header, cursor);
    cursor += header.length;
  }
  out.set(eocd, cursor);
  return out;
}
