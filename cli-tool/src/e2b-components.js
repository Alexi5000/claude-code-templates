const {createHash} = require('node:crypto');

const E2B_BASE = 'https://raw.githubusercontent.com/Alexi5000/claude-code-templates/eca1bb598be9c3cb36293356f8bc220bbabb6fd4/cli-tool/components/sandbox/e2b';
const hashes = {
  "e2b-launcher.py": "7ed2385dc58e4354c65b61a93556fe7849a99f13f6902bfc796bb82fd2fd00eb",
  "requirements.txt": "bd28954a932cf0e0f696fc04f520f00c1ae57a69f6295dbc8a9f828a15c0807e",
  ".env.example": "f34f8f43c92e04f699f5596c5e206a6ef03f490e16d2f1903d12af9ea05521af"
};

async function downloadE2BComponent(name) {
  if (!Object.hasOwn(hashes, name)) throw new Error('Unknown E2B component');
  const response = await fetch(`${E2B_BASE}/${name}`);
  if (!response.ok) throw new Error(`Failed to download ${name}: HTTP ${response.status}`);
  const content = await response.text();
  if (createHash('sha256').update(content, 'utf8').digest('hex') !== hashes[name]) {
    throw new Error(`E2B component integrity check failed: ${name}`);
  }
  return content;
}

module.exports = {downloadE2BComponent};
