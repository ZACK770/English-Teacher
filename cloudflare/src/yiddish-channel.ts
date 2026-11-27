import { b64encode, concat, downsample24kTo8k, FRAME_BYTES, meanSquare, wav, wavToPcm } from './audio';
import { parseStartFrame } from './technoline';
import type { Env } from './env';

export const YIDDISH_MODEL = 'google/gemini-2.5-flash';
export const YIDDISH_WSS = 'wss://english-teacher-pilot-888.a0527698420.workers.dev/v1/technoline/yiddish';
export const yiddishVoices = [
  ['avrumi','אברומי · שיחה, בינוני'], ['yanky','יענקי · שיחה, גבוה'], ['mottel','מאטל · שיחה, נמוך'], ['duvid','דוד · שיחה, גבוה'], ['lipa','ליפא · שיחה, בינוני'], ['reuven','ראובן · ליטאי'], ['itzik','איציק · ישראלי'], ['pinchas','פנחס · מספר רגוע'], ['rochel','רחל'], ['nachman','נחמן · מבוגר'], ['gitty','גיטי'], ['shimi','שימי · עמוק'], ['blimy','בלימי'], ['berel','בערל · מספר'], ['moishy','מוישי · נער'], ['hershel','הערשל · מבוגר וחם'], ['leiby','לייבי · צעיר ועמוק'], ['shloimy','שלוימי · יציב'], ['zalmen','זלמן · מבוגר ועמוק'],
].map(([id,name])=>({id,name}));
export const isYiddishVoice = (voice: unknown): voice is string => yiddishVoices.some(v=>v.id===voice);
const api='https://yiddish.tools/api/v1/';
const json=(data: unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const headers=(env:Env)=>({Authorization:'Bearer '+env.YIDDISH_TOOLS_API_KEY});
export async function yiddishSpeech(env:Env, text:string, voice:string, signal:AbortSignal) {
  const response=await fetch(api+'speech/stream',{method:'POST',headers:{...headers(env),'Content-Type':'application/json'},body:JSON.stringify({text,voice}),signal});
  if(!response.ok || !response.headers.get('Content-Type')?.includes('audio/wav')) throw new Error('tts_failed');
  return response;
}
export async function yiddishPreview(env:Env,text:string,voice:string) {
  if(!env.YIDDISH_TOOLS_API_KEY) return json({error:'Yiddish Tools אינו מוגדר בשרת'},503);
  const start=Date.now(); const response=await yiddishSpeech(env,text,voice,AbortSignal.timeout(15000));
  const data=new Uint8Array(await response.arrayBuffer());
  const pcm=wavToPcm(data); if(!pcm.length) throw new Error('empty_audio');
  return json({audio:b64encode(wav(pcm,24000)),mime:'audio/wav',ms:Date.now()-start,characters:Array.from(text).length});
}
async function transcribe(env:Env,pcm:Uint8Array,signal:AbortSignal) {
  const form=new FormData();form.set('audio',new Blob([wav(pcm,8000)],{type:'audio/wav'}),'turn.wav');form.set('enhance','0');
  const response=await fetch(api+'transcriptions',{method:'POST',headers:headers(env),body:form,signal});
  if(!response.ok) throw new Error('stt_submit');
  const result=await response.json<{data:{id:string}}>();
  for(let n=0;n<25;n++) {
    signal.throwIfAborted(); const check=await fetch(api+'generations/'+encodeURIComponent(result.data.id),{headers:headers(env),signal});
    if(!check.ok) throw new Error('stt_poll'); const {data}=await check.json<{data:{status:string;output?:{text:string}}}>();
    if(data.status==='completed') return data.output?.text?.trim().slice(0,1000)||'';
    if(data.status==='failed') throw new Error('stt_failed'); await sleep(750);
  } throw new Error('stt_timeout');
}
const prompt='You are a calm Hasidic Yiddish language teacher on SpeakCall for a Hebrew-speaking learner. Teach only everyday Yiddish, one short question or example at a time. Respond in natural Hasidic Yiddish, using simple words suitable for beginners. Do not discuss news, politics, dating, movies, ideological or unrelated topics. Redirect to language practice. Never claim progress you did not observe. Write only the words to be spoken, no markdown. Keep replies under 35 words.';
type Message={role:'system'|'user'|'assistant';content:string};
async function teach(env:Env,messages:Message[],signal:AbortSignal) {
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.PBX_PILOT_OPENROUTER_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:YIDDISH_MODEL,max_tokens:120,messages:[{role:'system',content:prompt},...messages.slice(-12)]}),signal});
  if(!response.ok) throw new Error('model_failed');
  const result=await response.json<{choices?:{message?:{content?:string}}[]}>();const text=result.choices?.[0]?.message?.content?.trim().slice(0,600);if(!text)throw new Error('empty_model');return text;
}
type Config={voice:string; token?:string};
export class YiddishChannel {
  private active=false;
  constructor(private state:DurableObjectState,private env:Env){}
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname;
    const config=await this.state.storage.get<Config>('config')??{voice:'avrumi'};
    const token=config.token||this.env.YIDDISH_CHANNEL_TOKEN;
    if(path==='/settings') {
      if(request.method==='PUT') {
        const body=await request.json<{voice?:unknown;token?:unknown}>().catch(()=>null);
        if(!body||!isYiddishVoice(body.voice)|| (body.token!==undefined&&(typeof body.token!=='string'||body.token.length<8||body.token.length>256)))return json({error:'בחר קול ואסימון תקין'},400);
        const updated={voice:body.voice,token:typeof body.token==='string'?body.token:config.token};await this.state.storage.put('config',updated);
        return json({voice:updated.voice,configured:!!(updated.token||token)&&!!this.env.YIDDISH_TOOLS_API_KEY&&!!this.env.PBX_PILOT_OPENROUTER_KEY,wss:YIDDISH_WSS,model:YIDDISH_MODEL});
      }
      return json({voice:config.voice,configured:!!token&&!!this.env.YIDDISH_TOOLS_API_KEY&&!!this.env.PBX_PILOT_OPENROUTER_KEY,wss:YIDDISH_WSS,model:YIDDISH_MODEL});
    }
    if(path!=='/v1/technoline/yiddish')return new Response('Not found',{status:404});
    if(!token||!this.env.YIDDISH_TOOLS_API_KEY||!this.env.PBX_PILOT_OPENROUTER_KEY)return new Response('Not configured',{status:503});
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected WebSocket',{status:426});
    const pair=new WebSocketPair();const socket=pair[1];socket.accept();socket.binaryType='arraybuffer';
    let started=false,closed=false,busy=false,ownsCall=false,parts:Uint8Array[]=[],silence=0,spoken=0,turns=0;
    const abort=new AbortController();const history:Message[]=[];
    const finish=()=>{if(closed)return;closed=true;abort.abort();clearTimeout(startTimer);clearTimeout(limitTimer);if(ownsCall)this.active=false;try{socket.close(1000,'Call ended');}catch{}};
    const startTimer=setTimeout(finish,5000),limitTimer=setTimeout(()=>{try{socket.send(JSON.stringify({type:'hangup'}));}finally{finish();}},300000);
    const speak=async(text:string)=>{
      const res=await yiddishSpeech(this.env,text,config.voice,abort.signal);const reader=res.body!.getReader();let pending:Uint8Array=new Uint8Array(),header:Uint8Array=new Uint8Array(),gotHeader=false,carry:Uint8Array=new Uint8Array(),odd:Uint8Array=new Uint8Array();let next=Date.now();
      try{while(!closed){const {done,value}=await reader.read();if(done)break;let chunk=value;if(!gotHeader){header=concat([header,chunk]);if(header.length<44)continue;const view=new DataView(header.buffer);if(String.fromCharCode(...header.subarray(0,4))!=='RIFF'||view.getUint32(24,true)!==24000||view.getUint16(22,true)!==1||view.getUint16(34,true)!==16||String.fromCharCode(...header.subarray(36,40))!=='data')throw new Error('audio_format');chunk=header.subarray(44);gotHeader=true;}
        const combined=concat([odd,chunk]);odd=combined.slice(combined.length-combined.length%2);const [pcm,remainder]=downsample24kTo8k(combined.subarray(0,combined.length-combined.length%2),carry);carry=remainder;pending=concat([pending,pcm]);while(pending.length>=FRAME_BYTES&&!closed){await sleep(Math.max(0,next-Date.now()));if(closed)break;socket.send(pending.slice(0,FRAME_BYTES));pending=pending.slice(FRAME_BYTES);next=Math.max(next+20,Date.now());}}
        if(pending.length&&!closed){await sleep(Math.max(0,next-Date.now()));if(!closed){const frame=new Uint8Array(FRAME_BYTES);frame.set(pending);socket.send(frame);}}}finally{await reader.cancel().catch(()=>{});}
    };
    const fail=async()=>{if(closed)return;try{await speak('אַנטשולדיקט, ס׳איז אַ טעכנישע פּראָבלעם. פּרוּווט ווידער שפּעטער.');}catch{}try{socket.send(JSON.stringify({type:'hangup'}));}finally{finish();}};
    const handle=async(pcm:Uint8Array)=>{busy=true;try{const text=await transcribe(this.env,pcm,abort.signal);if(closed)return;if(!text){await speak('זאָג עס נאָך אַ מאָל, ביטע.');return;}history.push({role:'user',content:text});const reply=await teach(this.env,history,abort.signal);history.push({role:'assistant',content:reply});await speak(reply);}catch{await fail();}finally{busy=false;}};
    socket.addEventListener('close',finish);socket.addEventListener('error',finish);
    socket.addEventListener('message',event=>{
      if(closed)return;
      if(!started){if(typeof event.data!=='string'){finish();return;}try{parseStartFrame(event.data,token);}catch{finish();return;}if(this.active){finish();return;}this.active=true;ownsCall=true;started=true;clearTimeout(startTimer);busy=true;this.state.waitUntil(speak('שלום עליכם! איך בין דיין ייִדיש לערער. ווי גייט עס דיר היינט?').catch(fail).finally(()=>{busy=false;}));return;}
      if(typeof event.data==='string'){try{if(['stop','hangup','end'].includes(JSON.parse(event.data).type))finish();}catch{}return;}
      if(busy||!(event.data instanceof ArrayBuffer)||event.data.byteLength!==FRAME_BYTES)return;
      const frame=new Uint8Array(event.data);const loud=meanSquare(frame)>550*550;
      if(loud){spoken+=20;silence=0;}else if(parts.length)silence+=20;
      if(loud||parts.length)parts.push(frame);
      if(parts.length&&(silence>=700||parts.length>=600)){const captured=concat(parts);parts=[];const valid=spoken>=160;spoken=0;silence=0;if(valid){if(++turns>25){finish();return;}this.state.waitUntil(handle(captured));}}
    });
    return new Response(null,{status:101,webSocket:pair[0]});
  }
}
