// Private stdin/stdout bridge: page HTML and session URLs never enter CI logs.
import {parsePage,checkedPageUrl} from '../src/parse.ts';
import {validateSearchForm} from '../src/search.ts';
import {validateCollection} from '../src/collection.ts';
import {CollectionError,requireCondition,isRecord} from '../src/errors.ts';
let input='';
for await (const chunk of process.stdin) input+=chunk;
try {
  const data:unknown=JSON.parse(input);
  requireCondition(isRecord(data),'INVALID_BRIDGE_INPUT');
  if(data.command==='validate') {
    validateCollection(data.payload);
    console.log(JSON.stringify({ok:true}));
  } else {
    requireCondition(typeof data.url==='string' && typeof data.html==='string','INVALID_BRIDGE_INPUT');
    checkedPageUrl(data.url);
    if(data.command==='home') {
      validateSearchForm(data.html,data.url);
      console.log(JSON.stringify({ok:true}));
    } else {
      requireCondition(data.command==='page' && typeof data.number==='number' && Number.isInteger(data.number) && data.number>=1,'INVALID_BRIDGE_INPUT');
      console.log(JSON.stringify(parsePage(data.html,data.url,data.number)));
    }
  }
} catch(error) {
  console.log(JSON.stringify({error:error instanceof CollectionError?error.code:'BRIDGE_ERROR'}));
  process.exitCode=1;
}
