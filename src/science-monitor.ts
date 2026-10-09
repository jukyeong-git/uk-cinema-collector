import {collect} from './science-collector.ts';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {setTimeout as sleep} from 'node:timers/promises';
const deadline=Number(process.env.COLLECTOR_END_AT);if(!Number.isFinite(deadline)||deadline<=Date.now())throw Error('INVALID_DEADLINE');
await mkdir('work',{recursive:true});let success=0,lastHash='',pending=false;
try{
 while(Date.now()<deadline-25000){const start=Date.now();try{
  const payload=await collect();const hash=createHash('sha256').update(JSON.stringify({films:payload.films,rows:payload.rows})).digest('hex');
  let sent=0;
  if(process.env.DELIVER==='true'&&(hash!==lastHash||pending)){
   if(!process.env.SCIENCE_RECEIVER_FUNCTION)throw Error('MISSING_RECEIVER');
   await writeFile('work/science-payload.json',JSON.stringify(payload));
   const meta=JSON.parse(execFileSync('aws',['lambda','invoke','--function-name',process.env.SCIENCE_RECEIVER_FUNCTION,'--invocation-type','RequestResponse','--payload','fileb://work/science-payload.json','work/science-response.json','--no-cli-pager'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000}));
   const response=JSON.parse(await readFile('work/science-response.json','utf8'));if(meta.FunctionError||response.accepted!==true)throw Error('RECEIVER_REJECTED');pending=response.pending>0;sent=response.sent;lastHash=hash;
  }
  success++;console.log(JSON.stringify({event:'science-cycle-complete',films:payload.films.length,rows:payload.rows.length,sent,pending}));
 }catch(e){const message=e instanceof Error?e.message:'';console.log(JSON.stringify({event:'science-cycle-failed',code:/^[A-Z][A-Z0-9_]{0,80}$/.test(message)?message:'EXECUTION_ERROR'}));}
 const delay=Math.min(Math.max(0,60000-(Date.now()-start)),Math.max(0,deadline-Date.now()));if(delay)await sleep(delay);
 }
 if(!success)process.exitCode=1;
 console.log(JSON.stringify({event:'science-monitor-complete',success}));
}finally{await rm('work/science-payload.json',{force:true});await rm('work/science-response.json',{force:true});}
