const fs = require('node:fs');
const path = require('node:path');

function writeSandboxFile(baseDir, relativePath, content, mode) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0') ||
      relativePath.includes('\\') || relativePath.includes(':') || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error('Invalid sandbox output path');
  }
  const parts = relativePath.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid sandbox output path');
  fs.mkdirSync(baseDir, {recursive: true});
  const root = fs.realpathSync(baseDir);
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    try {fs.mkdirSync(directory);} catch (error) {if (error.code !== 'EEXIST') throw error;}
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe sandbox output directory');
  }
  const destination = path.join(directory, parts.at(-1));
  const relative = path.relative(root, destination);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Invalid sandbox output path');
  let previous;
  try {previous = fs.lstatSync(destination);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (previous && (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1)) {
    throw new Error('Sandbox output must be a private regular file');
  }
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (previous && (previous.dev !== stat.dev || previous.ino !== stat.ino))) throw new Error('Sandbox output must be a private regular file');
    if (mode !== undefined) fs.fchmodSync(fd, mode);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function validateComponentName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid component name');
  return name;
}

module.exports = {writeSandboxFile, validateComponentName};
