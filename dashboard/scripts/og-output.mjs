import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { join } from 'node:path';
import safeOutput from '../../cli-tool/components/sandbox/cloudflare/safe-output.cjs';

export function readManifest(outDir) {
  let fd;
  try {
    fd = openSync(join(outDir, '.manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) throw new Error('Unsafe OG manifest');
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length === bytes.length) throw new Error('Unsafe OG manifest');
    const manifest = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Invalid OG manifest');
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function writeOutput(outDir, relativePath, content) {
  safeOutput.writeSandboxFile(outDir, relativePath, content);
}
