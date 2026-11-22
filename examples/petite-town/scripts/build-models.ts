import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { buildModel } from '../src/build-model'
const args = process.argv.slice(2)
const ids = args.length
  ? args
  : (await readdir('atlases'))
      .filter((n) => n.endsWith('.png'))
      .map((n) => n.slice(0, -4))
await Promise.all(['models','verification'].map(dir=>mkdir(dir,{recursive:true})))
const reportFile = 'verification/models.json'
const report = JSON.parse(await readFile(reportFile, 'utf8').catch(() => '{}'))
for (const id of ids) {
  const { glb, report: info } = buildModel(
    id,
    await readFile('atlases/' + id + '.png'),
  )
  const out = 'models/' + id + '.glb',
    temp = out + '.' + process.pid + '.tmp'
  await writeFile(temp, glb)
  await rename(temp, out)
  report[id] = info
  console.log(id, info.layers, info.triangles, info.warnings.join(' '))
}
await writeFile(
  reportFile,
  JSON.stringify(
    Object.fromEntries(
      Object.entries(report).sort(([a], [b]) => a.localeCompare(b)),
    ),
    null,
    2,
  ) + '\n',
)
