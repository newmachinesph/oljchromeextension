/**
 * Build the store zip: node scripts/package.mjs
 *
 * Run `npm run build` first - this packages what is on disk, it does not build.
 *
 * The zip is not a copy of the repo. Two things have to be true of it that are
 * not true here:
 *
 *   - the built options page moves from dist/options to options, because a
 *     shipped extension has no build directory, and every manifest path that
 *     named dist/ has to move with it;
 *   - src/options never ships. It is JSX, the bundle already contains it, and
 *     an unbuildable source tree inside the package is dead weight a reviewer
 *     has to read.
 *
 * Everything else is copied verbatim: the manifest, the icons, the content and
 * core scripts the manifest actually loads, and vendor/.
 *
 * The archive is written here rather than shelled out to a zip tool, so the
 * output does not depend on which shell happens to be on the machine.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');

/** Everything in the package, as [name in the zip, absolute source path]. */
function collect() {
  const files = [];

  const walk = (dir, prefix, skip = () => false) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const name = prefix ? `${prefix}/${entry}` : entry;
      if (skip(name)) continue;
      if (statSync(full).isDirectory()) walk(full, name, skip);
      else files.push([name, full]);
    }
  };

  walk(join(ROOT, 'icons'), 'icons');
  walk(join(ROOT, 'vendor'), 'vendor');
  // The JSX behind the options page is already in the bundle below.
  walk(join(ROOT, 'src'), 'src', (name) => name.startsWith('src/options'));
  walk(join(ROOT, 'dist', 'options'), 'options');

  return files;
}

/**
 * The manifest, with its build paths rewritten to shipped ones.
 *
 * A blunt string replace on purpose: the paths appear in options_ui, in
 * web_accessible_resources, and in the glob patterns beside them, and a
 * key-by-key rewrite would have to know all three and would silently miss the
 * fourth. Nothing else in the file reads "dist/options/".
 */
function shippedManifest() {
  const source = readFileSync(join(ROOT, 'manifest.json'), 'utf8');
  const shipped = source.replaceAll('dist/options/', 'options/');
  if (shipped.includes('dist/')) {
    throw new Error('manifest still points into dist/ after the rewrite');
  }
  return { text: shipped, version: JSON.parse(shipped).version };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * A zip of `entries`, each `{ name, data }`, deflated.
 *
 * Only what the format needs and Chrome reads: a local header per file, a
 * central directory, an end record. No zip64 - the package is a megabyte.
 */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Storing beats deflating when deflating made it bigger - tiny files do.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(sum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, directory, end]);
}

const manifest = shippedManifest();
const entries = [
  { name: 'manifest.json', data: Buffer.from(manifest.text, 'utf8') },
  ...collect().map(([name, path]) => ({ name, data: readFileSync(path) })),
];

const target = join(ROOT, `oljextension-${manifest.version}.zip`);
const archive = zip(entries);
writeFileSync(target, archive);

console.log(
  `${relative(ROOT, target).split(sep).join('/')} - ${entries.length} files, ` +
    `${(archive.length / 1024 / 1024).toFixed(2)} MB`,
);
