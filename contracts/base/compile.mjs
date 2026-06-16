import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, 'MemoryCommitment.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'MemoryCommitment.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
if (errs.length) { console.error('COMPILE ERRORS:\n' + errs.map((e) => e.formattedMessage).join('\n')); process.exit(1); }
const c = out.contracts['MemoryCommitment.sol']['MemoryCommitment'];
mkdirSync(resolve(__dirname, 'out'), { recursive: true });
writeFileSync(resolve(__dirname, 'out/MemoryCommitment.json'), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2));
console.log('✓ compiled. ABI methods:', c.abi.filter((x) => x.type === 'function').map((x) => x.name).join(', '));
console.log('  bytecode size:', (c.evm.bytecode.object.length / 2) + ' bytes');
console.log('  artifact: contracts/base/out/MemoryCommitment.json');
