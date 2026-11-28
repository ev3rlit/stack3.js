import { runBenchmark } from '../010.010-resolution-baseline/benchmark.mjs'

const destination = process.argv[2]
const flag = process.argv[3]
if (!destination || (flag !== undefined && flag !== '--glb') || process.argv.length > 4) {
  throw new Error('Usage: tsx benchmark.mts <output-directory> [--glb]')
}

runBenchmark([
  { name: 'baseline', resolution: 96, layers: 48 },
  { name: 'xy-only', resolution: 176, layers: 48 },
  { name: 'layers-only', resolution: 96, layers: 96 },
  { name: 'both', resolution: 176, layers: 96 },
], destination, flag === '--glb')
