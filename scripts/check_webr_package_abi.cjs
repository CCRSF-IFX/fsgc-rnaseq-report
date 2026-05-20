#!/usr/bin/env node

const fs = require('fs');
const zlib = require('zlib');

const VAL_TYPES = new Map([
  [0x7f, 'i32'],
  [0x7e, 'i64'],
  [0x7d, 'f32'],
  [0x7c, 'f64'],
  [0x7b, 'v128'],
  [0x70, 'funcref'],
  [0x6f, 'externref'],
]);

function readModule(file) {
  let bytes = fs.readFileSync(file);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = zlib.gunzipSync(bytes);
  }
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`${file} is not a WebAssembly module`);
  }
  return bytes;
}

function parseWasm(file) {
  const bytes = readModule(file);
  let pos = 8;

  function readU8() {
    return bytes[pos++];
  }

  function readBytes(length) {
    const out = bytes.subarray(pos, pos + length);
    pos += length;
    return out;
  }

  function readVarUint() {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = readU8();
      result += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  function readName() {
    return Buffer.from(readBytes(readVarUint())).toString('utf8');
  }

  function readLimits() {
    const flags = readU8();
    readVarUint();
    if (flags & 1) readVarUint();
  }

  const types = [];
  const imports = [];
  const exports = [];
  const functionTypes = [];

  while (pos < bytes.length) {
    const sectionId = readU8();
    const sectionSize = readVarUint();
    const sectionEnd = pos + sectionSize;

    if (sectionId === 1) {
      const count = readVarUint();
      for (let i = 0; i < count; i += 1) {
        const form = readU8();
        if (form !== 0x60) {
          throw new Error(`${file} has an unexpected function type form 0x${form.toString(16)} at type ${i}`);
        }
        const paramCount = readVarUint();
        const params = [];
        for (let j = 0; j < paramCount; j += 1) {
          params.push(VAL_TYPES.get(readU8()) || 'unknown');
        }
        const resultCount = readVarUint();
        const results = [];
        for (let j = 0; j < resultCount; j += 1) {
          results.push(VAL_TYPES.get(readU8()) || 'unknown');
        }
        types.push({ params, results });
      }
    } else if (sectionId === 2) {
      const count = readVarUint();
      for (let i = 0; i < count; i += 1) {
        const module = readName();
        const name = readName();
        const kind = readU8();
        let typeIndex = null;
        if (kind === 0) typeIndex = readVarUint();
        else if (kind === 1) readLimits();
        else if (kind === 2) {
          readU8();
          readLimits();
        } else if (kind === 3) {
          readU8();
          readU8();
        }
        imports.push({ module, name, kind, type: typeIndex === null ? null : types[typeIndex] });
      }
    } else if (sectionId === 3) {
      const count = readVarUint();
      for (let i = 0; i < count; i += 1) functionTypes.push(readVarUint());
    } else if (sectionId === 7) {
      const count = readVarUint();
      for (let i = 0; i < count; i += 1) {
        exports.push({ name: readName(), kind: readU8(), index: readVarUint() });
      }
    }

    pos = sectionEnd;
  }

  const importedFunctionCount = imports.filter((entry) => entry.kind === 0).length;
  return { types, imports, exports, functionTypes, importedFunctionCount };
}

function signature(type) {
  return `${type.params.join(',') || 'void'} -> ${type.results.join(',') || 'void'}`;
}

function exportedFunctionSignatures(module) {
  const signatures = new Map();
  for (const entry of module.exports) {
    if (entry.kind !== 0) continue;
    const typeIndex = module.functionTypes[entry.index - module.importedFunctionCount];
    if (typeIndex !== undefined) signatures.set(entry.name, module.types[typeIndex]);
  }
  return signatures;
}

function main() {
  const [runtimePath, ...sideModulePaths] = process.argv.slice(2);
  if (!runtimePath || sideModulePaths.length === 0) {
    console.error('Usage: node scripts/check_webr_package_abi.cjs <R.wasm> <package.so> [...]');
    process.exit(2);
  }

  const runtimeExports = exportedFunctionSignatures(parseWasm(runtimePath));
  const failures = [];

  for (const sideModulePath of sideModulePaths) {
    const sideModule = parseWasm(sideModulePath);
    for (const entry of sideModule.imports) {
      if (entry.kind !== 0 || entry.module !== 'env') continue;
      const runtimeType = runtimeExports.get(entry.name);
      if (!runtimeType) continue;
      if (signature(entry.type) !== signature(runtimeType)) {
        failures.push(`${sideModulePath}: ${entry.name} imports ${signature(entry.type)} but runtime exports ${signature(runtimeType)}`);
      }
    }
  }

  if (failures.length) {
    console.error('webR package ABI mismatch detected:');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }

  console.log(`webR ABI check passed for ${sideModulePaths.length} package module(s).`);
}

main();
