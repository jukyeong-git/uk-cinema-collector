import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Temporary compatibility fix matching upstream PR #339:
// https://github.com/apify/camoufox-js/pull/339
// Only library-generated properties are filtered. Explicit config still validates.
const marker='// collector compatibility: generated properties follow installed schema';
export function patchCamoufox(source:string) {
  if(source.includes(marker))return source;
  const replacements:[string,string][]=[
    ['    mergeInto(config, fromBrowserforge(fingerprint, ff_version_str));',
     `    ${marker}
    const knownProperties = loadProperties(executable_path);
    const generatedConfig = fromBrowserforge(fingerprint, ff_version_str);
    for (const key of Object.keys(generatedConfig)) {
        if (!(key in knownProperties)) delete generatedConfig[key];
    }
    mergeInto(config, generatedConfig);`],
    ['    const randint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;\n    const knownProperties = loadProperties(executable_path);',
     '    const randint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;'],
    ['    setInto(config, "window.history.length", Math.floor(Math.random() * 5) + 1);',
     '    if ("window.history.length" in knownProperties) setInto(config, "window.history.length", Math.floor(Math.random() * 5) + 1);'],
    [`    mergeInto(config, {
        "canvas:aaOffset": Math.floor(Math.random() * 101) - 50, // nosec
        "canvas:aaCapOffset": true,
    });`,
     `    const generatedCanvas = {
        "canvas:aaOffset": Math.floor(Math.random() * 101) - 50,
        "canvas:aaCapOffset": true,
    };
    for (const [key, value] of Object.entries(generatedCanvas)) {
        if (key in knownProperties) setInto(config, key, value);
    }`],
  ];
  for(const [before,after] of replacements) {
    if(source.split(before).length!==2)throw new Error('CAMOUFOX_PATCH_SOURCE_CHANGED');
    source=source.replace(before,after);
  }
  return source;
}
async function main() {
  const packageUrl=new URL('../node_modules/camoufox-js/package.json',import.meta.url);
  const pkg=JSON.parse(await readFile(packageUrl,'utf8')) as {version:string};
  if(pkg.version!=='0.12.0')throw new Error('CAMOUFOX_PATCH_VERSION_CHANGED');
  const target=new URL('../node_modules/camoufox-js/dist/utils.js',import.meta.url);
  const source=await readFile(target,'utf8');
  await writeFile(target,patchCamoufox(source));
  console.log(JSON.stringify({event:'camoufox-compatibility-patched',version:pkg.version}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
