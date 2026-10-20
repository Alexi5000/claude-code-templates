const fs = require('fs');

async function withRegularFile(filepath, consume) {
  const handle = await fs.promises.open(filepath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('Expected a regular file');
    return await consume(handle, stats);
  } finally {
    await handle.close();
  }
}

module.exports = { withRegularFile };
