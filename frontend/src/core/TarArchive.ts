/**
 * 轻量纯原生 POSIX UStar (TAR) 打包与解包引擎
 * 无任何外部重型依赖，完全开放透明，兼容 WebPlotDigitizer 与 360Zip / 7-Zip / Linux tar / Python tarfile / R untar
 */

export interface TarFileEntry {
  name: string;
  data: Uint8Array;
}

export class TarArchive {
  /**
   * 将文件列表打包为标准 open .tar 二进制流
   */
  public static create(entries: TarFileEntry[]): Uint8Array {
    // 每个文件占用：1个512字节头部 + 向上取整到512字节的数据块 + 末尾2个512字节的全零EOF块
    let totalSize = 1024; // 2 EOF blocks
    for (const e of entries) {
      const paddedDataSize = Math.ceil(e.data.length / 512) * 512;
      totalSize += 512 + paddedDataSize;
    }

    const out = new Uint8Array(totalSize);
    let offset = 0;

    for (const e of entries) {
      // 1. 构造 512 字节的 UStar Header
      const header = new Uint8Array(512);

      // 文件名 (0..99)
      const nameBytes = new TextEncoder().encode(e.name);
      header.set(nameBytes.subarray(0, 100), 0);

      // file mode (100..107): 0000644\0
      header.set(new TextEncoder().encode('0000644\0'), 100);

      // uid & gid (108..123)
      header.set(new TextEncoder().encode('0000000\0'), 108);
      header.set(new TextEncoder().encode('0000000\0'), 116);

      // size (124..135): 11位八进制 + 零字节
      const sizeOctal = e.data.length.toString(8).padStart(11, '0') + ' ';
      header.set(new TextEncoder().encode(sizeOctal), 124);

      // mtime (136..147)
      const mtimeOctal = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
      header.set(new TextEncoder().encode(mtimeOctal), 136);

      // typeflag (156): '0' (Normal file)
      header[156] = 48; // ASCII '0'

      // magic (257..264): "ustar\0" + "00"
      header.set(new TextEncoder().encode('ustar\0'), 257);
      header.set(new TextEncoder().encode('00'), 263);

      // Checksum (148..155): 计算前先填 8 个空格 (ASCII 32)
      for (let i = 148; i < 156; i++) header[i] = 32;

      let chksum = 0;
      for (let i = 0; i < 512; i++) chksum += header[i];
      const chksumOctal = chksum.toString(8).padStart(6, '0') + '\0 ';
      header.set(new TextEncoder().encode(chksumOctal), 148);

      // 写入 Header
      out.set(header, offset);
      offset += 512;

      // 写入数据
      out.set(e.data, offset);
      offset += Math.ceil(e.data.length / 512) * 512;
    }

    return out;
  }

  /**
   * 解包读取标准 .tar 归档文件
   */
  public static extract(tarBuffer: ArrayBuffer): TarFileEntry[] {
    const bytes = new Uint8Array(tarBuffer);
    const entries: TarFileEntry[] = [];
    let offset = 0;

    while (offset + 512 <= bytes.length) {
      const header = bytes.subarray(offset, offset + 512);

      // 检查是否全零 EOF 块
      let isEof = true;
      for (let i = 0; i < 512; i++) {
        if (header[i] !== 0) {
          isEof = false;
          break;
        }
      }
      if (isEof) break;

      // 提取文件名 (trim null bytes)
      let nameEnd = 0;
      while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
      const name = new TextDecoder().decode(header.subarray(0, nameEnd)).trim();

      // 提取大小 (八进制字符串)
      let sizeEnd = 124;
      while (sizeEnd < 136 && header[sizeEnd] !== 0 && header[sizeEnd] !== 32) sizeEnd++;
      const sizeStr = new TextDecoder().decode(header.subarray(124, sizeEnd)).trim();
      const size = parseInt(sizeStr, 8) || 0;

      offset += 512;

      if (name && size > 0 && offset + size <= bytes.length) {
        const fileData = new Uint8Array(bytes.subarray(offset, offset + size));
        entries.push({ name, data: fileData });
      }

      offset += Math.ceil(size / 512) * 512;
    }

    return entries;
  }
}
