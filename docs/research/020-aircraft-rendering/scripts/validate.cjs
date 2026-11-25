const fs = require('node:fs');
const path = require('node:path');
const validator = require('gltf-validator');
async function main() {
  const root=path.join(__dirname,'..');
  const result={};
  for (const file of fs.readdirSync(path.join(root,'models')).filter(f=>f.endsWith('.glb'))) {
    const report=await validator.validateBytes(new Uint8Array(fs.readFileSync(path.join(root,'models',file))), {uri:file});
    result[file]={validator:report.validatorVersion,issues:report.issues};
  }
  fs.writeFileSync(path.join(root,'gltf-validation.json'),JSON.stringify(result,null,2)+'\n');
  if (Object.values(result).some(r=>r.issues.numErrors>0)) process.exitCode=1;
}
main().catch(err=>{console.error(err);process.exitCode=1});
