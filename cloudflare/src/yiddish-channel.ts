import { b64encode, concat, FRAME_BYTES, meanSquare, wav } from './audio';
import { normalizedYiddishWav, telephoneYiddishFrames } from './yiddish-wav';
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
  const response=await fetch(api+'speech/stream',{method:'POST',headers:{...headers(env),'Content-Type':'application/json','Accept':'audio/wav','User-Agent':'SpeakCall/1.0'},body:JSON.stringify({text,voice}),signal});
  if(!response.ok) throw new Error('tts_failed_'+response.status);
  if(!response.body || !/audio\/(?:x-)?wav|application\/octet-stream/i.test(response.headers.get('Content-Type')||'')) throw new Error('audio_format');
  return response;
}
export async function yiddishPreview(env:Env,text:string,voice:string) {
  if(!env.YIDDISH_TOOLS_API_KEY) return json({error:'Yiddish Tools אינו מוגדר בשרת'},503);
  const start=Date.now(); const response=await yiddishSpeech(env,text,voice,AbortSignal.timeout(15000));
  const {audio,durationSeconds}=await normalizedYiddishWav(response.body!);
  return json({audio:b64encode(audio),mime:'audio/wav',ms:Date.now()-start,characters:Array.from(text).length,durationSeconds,bytes:audio.length});
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
export const DEFAULT_CHANNEL_PROMPT='You are a calm Hasidic Yiddish language teacher on SpeakCall for a Hebrew-speaking learner. Teach only everyday Yiddish, one short question or example at a time. Use short Hebrew explanations when helpful, and natural Hasidic Yiddish for practice. Do not discuss news, politics, dating, movies, ideological or unrelated topics. Redirect to language practice. Never claim progress you did not observe. Write only the words to be spoken, no markdown. Keep replies under 35 words.';
type Message={role:'system'|'user'|'assistant';content:string};
async function teach(env:Env,messages:Message[],signal:AbortSignal,config:Config) {
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.PBX_PILOT_OPENROUTER_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:config.model||YIDDISH_MODEL,max_tokens:120,messages:[{role:'system',content:config.prompt||DEFAULT_CHANNEL_PROMPT},...messages.slice(-12)]}),signal});
  if(!response.ok) throw new Error('model_failed');
  const result=await response.json<{choices?:{message?:{content?:string}}[]}>();const text=result.choices?.[0]?.message?.content?.trim().slice(0,600);if(!text)throw new Error('empty_model');return text;
}
type Config={voice:string; token?:string; speechKey?:string; modelKey?:string; model?:string; prompt?:string; greeting?:string};
const DEFAULT_GREETING='שלום עליכם! איך בין דיין ייִדיש לערער. ווי גייט עס דיר היינט?';
export const CHANNEL_MODELS=[YIDDISH_MODEL,'openai/gpt-4.1-mini','qwen/qwen3-235b-a22b-2507'];
export const channelId=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9-]{1,39}$/.test(value)&&!['pilot','router','registry'].includes(value);

export class YiddishChannel {
  private active=false;
  constructor(private state:DurableObjectState,private env:Env){}
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(path==='/registry') {
      const channels=await this.state.storage.get<{id:string;name:string}[]>('channels')??[{id:'yiddish',name:'יידיש'}];
      if(request.method==='POST') {
        const b=await request.json<{id?:unknown;name?:unknown}>().catch(()=>null);
        if(!b||!channelId(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>60)return json({error:'מזהה באנגלית ושם ערוץ נדרשים'},400);
        if(channels.some(c=>c.id===b.id)||channels.length>=30)return json({error:'מזהה קיים או הגעת למגבלת הערוצים'},409);
        channels.push({id:b.id,name:b.name.trim()});await this.state.storage.put('channels',channels);
      }
      return json({channels});
    }
    const id=(path.startsWith('/v1/technoline/')?path.split('/').at(-1):new URL(request.url).searchParams.get('channel'))||'yiddish';
    const config=await this.state.storage.get<Config>('config')??{voice:'avrumi'};
    const token=config.token||(id==='yiddish'?this.env.YIDDISH_CHANNEL_TOKEN:undefined);
    const effective=(c:Config)=>({...this.env,YIDDISH_TOOLS_API_KEY:c.speechKey||this.env.YIDDISH_TOOLS_API_KEY,PBX_PILOT_OPENROUTER_KEY:c.modelKey||this.env.PBX_PILOT_OPENROUTER_KEY});
    const publicConfig=async(c:Config)=>({voice:c.voice,model:c.model||YIDDISH_MODEL,prompt:c.prompt||DEFAULT_CHANNEL_PROMPT,greeting:c.greeting||DEFAULT_GREETING,tokenConfigured:!!(c.token||token),speechKeySaved:!!c.speechKey,modelKeySaved:!!c.modelKey,configured:!!(c.token||token)&&!!effective(c).YIDDISH_TOOLS_API_KEY&&!!effective(c).PBX_PILOT_OPENROUTER_KEY,wss:YIDDISH_WSS.replace(/yiddish$/,id),lastError:await this.state.storage.get('last_error')??null});
    if(path==='/settings') {
      if(request.method==='PUT') {
        const body=await request.json<Record<string,unknown>>().catch(()=>null);
        if(!body||!isYiddishVoice(body.voice)||(body.token!==undefined&&(typeof body.token!=='string'||body.token.length<8||body.token.length>256))||['speechKey','modelKey'].some(k=>body[k]!==undefined&&(typeof body[k]!=='string'||String(body[k]).length>512||String(body[k]).length<8))||(body.model!==undefined&&!CHANNEL_MODELS.includes(String(body.model)))||['prompt','greeting'].some(k=>body[k]!==undefined&&(typeof body[k]!=='string'||!String(body[k]).trim()||String(body[k]).length>(k==='prompt'?6000:500))))return json({error:'בדוק את הגדרות הערוץ'},400);
        const updated:Config={...config,voice:body.voice};for(const k of ['token','speechKey','modelKey','model','prompt','greeting'] as const)if(typeof body[k]==='string')updated[k]=body[k];
        await this.state.storage.put('config',updated);return json(await publicConfig(updated));
      }
      return json(await publicConfig(config));
    }
    if(path==='/preview'&&request.method==='POST') {
      const b=await request.json<{text?:unknown;voice?:unknown;speechKey?:unknown}>().catch(()=>null);
      if(!b||typeof b.text!=='string'||!b.text.trim()||b.text.length>1000||!isYiddishVoice(b.voice)||(b.speechKey!==undefined&&(typeof b.speechKey!=='string'||b.speechKey.length<8||b.speechKey.length>512)))return json({error:'הזן טקסט, קול ומפתח תקינים'},400);
      try{
        const result=await yiddishPreview(effective({...config,...(typeof b.speechKey==='string'?{speechKey:b.speechKey}:{})}),b.text,b.voice);
        if(result.ok){
          if(typeof b.speechKey==='string'){const speechKey=b.speechKey;await this.state.storage.transaction(async tx=>{const latest=await tx.get<Config>('config')??config;await tx.put('config',{...latest,speechKey});});}
          await this.state.storage.delete('last_error');
        }
        return result;
      }catch(error){const reason=error instanceof Error&&/^tts_failed_\d{3}$|^audio_format$/.test(error.message)?error.message:'provider_error';await this.state.storage.put('last_error',reason);return json({error:reason==='tts_failed_401'?'Yiddish Tools דחה את המפתח (401). הדבק את מפתח הספק עצמו ולחץ האזן או שמור.':reason==='audio_format'?'הספק החזיר שמע בפורמט לא נתמך':reason},502);}

    }
    if(!path.startsWith('/v1/technoline/')||!channelId(id))return new Response('Not found',{status:404});
    const callEnv=effective(config);
    if(!token||!callEnv.YIDDISH_TOOLS_API_KEY||!callEnv.PBX_PILOT_OPENROUTER_KEY)return new Response('Not configured',{status:503});
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected WebSocket',{status:426});
    const pair=new WebSocketPair();const socket=pair[1];socket.accept();socket.binaryType='arraybuffer';
    let started=false,closed=false,busy=false,ownsCall=false,parts:Uint8Array[]=[],silence=0,spoken=0,turns=0;
    const abort=new AbortController();const history:Message[]=[];
    const finish=()=>{if(closed)return;closed=true;abort.abort();clearTimeout(startTimer);clearTimeout(limitTimer);if(ownsCall)this.active=false;try{socket.close(1000,'Call ended');}catch{}};
    const startTimer=setTimeout(finish,5000),limitTimer=setTimeout(()=>{try{socket.send(JSON.stringify({type:'hangup'}));}finally{finish();}},300000);
    const speak=async(text:string)=>{
      const res=await yiddishSpeech(callEnv,text,config.voice,AbortSignal.any([abort.signal,AbortSignal.timeout(20000)]));let next=Date.now(),frames=0;
      for await(const frame of telephoneYiddishFrames(res.body!)){
        if(closed)break;await sleep(Math.max(0,next-Date.now()));if(closed)break;socket.send(frame);frames++;next=Math.max(next+20,Date.now());
      }
      if(!closed&&!frames)throw new Error('audio_format');
    };
    const fail=async(error?:unknown)=>{if(closed)return;const reason=error instanceof Error && /^(tts_failed_\d{3}|audio_format|stt_submit|stt_poll|stt_failed|stt_timeout|model_failed|empty_model)$/.test(error.message)?error.message:'provider_error';await this.state.storage.put('last_error',reason).catch(()=>{});try{await speak('אַנטשולדיקט, ס׳איז אַ טעכנישע פּראָבלעם. פּרוּווט ווידער שפּעטער.');}catch{}try{socket.send(JSON.stringify({type:'hangup',reason}));}finally{finish();}};
    const handle=async(pcm:Uint8Array)=>{busy=true;try{const text=await transcribe(callEnv,pcm,abort.signal);if(closed)return;if(!text){await speak('זאָג עס נאָך אַ מאָל, ביטע.');return;}history.push({role:'user',content:text});const reply=await teach(callEnv,history,abort.signal,config);history.push({role:'assistant',content:reply});await speak(reply);}catch(error){await fail(error);}finally{busy=false;}};
    socket.addEventListener('close',finish);socket.addEventListener('error',finish);
    socket.addEventListener('message',event=>{
      if(closed)return;
      if(!started){if(typeof event.data!=='string'){finish();return;}try{parseStartFrame(event.data,token);}catch{finish();return;}if(this.active){finish();return;}this.active=true;ownsCall=true;started=true;clearTimeout(startTimer);busy=true;this.state.waitUntil(speak(config.greeting||DEFAULT_GREETING).then(()=>this.state.storage.delete('last_error')).catch(error=>{return fail(error);}).finally(()=>{busy=false;}));return;}
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
