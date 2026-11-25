const fs = require('node:fs');
const path = require('node:path');
const validator = require('gltf-validator');

async function validate(directory) {
  const measurements = JSON.parse(fs.readFileSync(path.join(directory, 'measurements.json')));
  const results = {};
  for (const name of Object.keys(measurements)) {
    const uri = name + '.glb';
    const report = await validator.validateBytes(fs.readFileSync(path.join(directory, uri)), { uri });
    results[name] = { validator: report.validatorVersion, issues: report.issues };
    if (report.issues.numErrors) process.exitCode = 1;
  }
  fs.writeFileSync(path.join(directory, 'gltf-validation.json'), JSON.stringify(results, null, 2) + '\n');
}

validate(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
