import { b64decode, b64encode, concat, FRAME_BYTES, meanSquare, upsample8kTo16k, wav } from './audio';
import { normalizedYiddishWav, pcm24kTelephoneFrames, yiddishPcm } from './yiddish-wav';
import { googleStandardVoices, synthesizeGoogleStandard } from './pbx-pilot-google';
import { parseStartFrame } from './technoline';
import type { Env, PilotInterruption } from './env';
import { resolveTurnTuning, TurnTuningSchema, type TurnTuning } from './turn-tuning';
import { ChannelBargeIn } from './channel-turn-control';

export const YIDDISH_MODEL = 'google/gemini-2.5-flash';
export const YIDDISH_WSS = 'wss://english-teacher-pilot-888.a0527698420.workers.dev/v1/technoline/yiddish';
export const yiddishVoices = [
  ['avrumi','אברומי · שיחה, בינוני'], ['yanky','יענקי · שיחה, גבוה'], ['mottel','מאטל · שיחה, נמוך'], ['duvid','דוד · שיחה, גבוה'], ['lipa','ליפא · שיחה, בינוני'], ['reuven','ראובן · ליטאי'], ['itzik','איציק · ישראלי'], ['pinchas','פנחס · מספר רגוע'], ['rochel','רחל'], ['nachman','נחמן · מבוגר'], ['gitty','גיטי'], ['shimi','שימי · עמוק'], ['blimy','בלימי'], ['berel','בערל · מספר'], ['moishy','מוישי · נער'], ['hershel','הערשל · מבוגר וחם'], ['leiby','לייבי · צעיר ועמוק'], ['shloimy','שלוימי · יציב'], ['zalmen','זלמן · מבוגר ועמוק'],
].map(([id,name])=>({id,name}));
const SPEECH_MODES=['yiddish','inworld','google'] as const;
type SpeechMode=typeof SPEECH_MODES[number];
const isSpeechMode=(v:unknown):v is SpeechMode=>typeof v==='string'&&SPEECH_MODES.includes(v as SpeechMode);
const voiceValid=(mode:SpeechMode,voice:unknown)=>mode==='yiddish'?isYiddishVoice(voice):mode==='google'?googleStandardVoices.some(v=>v.id===voice):voice==='Amos';
const defaultVoice=(mode:SpeechMode)=>mode==='yiddish'?'avrumi':mode==='google'?'he-IL-Standard-B':'Amos';
const LANGUAGE_CODES=['auto','ydd','yi','he','en'];
const INWORLD_MODELS=['inworld-tts-2-flash','inworld-tts-2'];
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
async function* channelPcm(env:Env,config:Config,text:string,signal:AbortSignal):AsyncGenerator<Uint8Array>{
  const speech=config.speech||'yiddish';
  if(speech==='yiddish'){const response=await yiddishSpeech(env,text,config.voice,signal);yield* yiddishPcm(response.body!);return;}
  if(speech==='google'){if(!env.PBX_PILOT_GOOGLE_TTS_KEY)throw new Error('google_tts_missing_key');yield await synthesizeGoogleStandard(fetch,env.PBX_PILOT_GOOGLE_TTS_KEY,config.voice,text,signal);return;}
  if(!env.PBX_PILOT_INWORLD_KEY)throw new Error('inworld_missing_key');
  const response=await fetch('https://api.inworld.ai/tts/v1/voice:stream',{method:'POST',signal,headers:{Authorization:'Basic '+env.PBX_PILOT_INWORLD_KEY,'Content-Type':'application/json'},body:JSON.stringify({text,voiceId:config.voice,modelId:config.inworldModel||'inworld-tts-2-flash',...(config.speechLanguage&&config.speechLanguage!=='auto'?{language:config.speechLanguage}:{}),audioConfig:{audioEncoding:'PCM',sampleRateHertz:24000}})});
  if(!response.ok||!response.body)throw new Error('inworld_'+response.status);const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const pcm=(line:string)=>{const event=JSON.parse(line);if(event.error||event.result?.error)throw new Error('inworld_stream');return event.result?.audioContent?b64decode(event.result.audioContent):null;};
  try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let pos;while((pos=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,pos).trim();buffer=buffer.slice(pos+1);if(line){const audio=pcm(line);if(audio)yield audio;}}if(buffer.length>2000000)throw new Error('inworld_stream');if(done)break;}if(buffer.trim()){const audio=pcm(buffer.trim());if(audio)yield audio;}}finally{await reader.cancel().catch(()=>{});}
}
async function channelSpeechPreview(env:Env,config:Config,text:string){if((config.speech||'yiddish')==='yiddish')return yiddishPreview(env,text,config.voice);const start=Date.now(),parts:Uint8Array[]=[];for await(const part of channelPcm(env,config,text,AbortSignal.timeout(18000)))parts.push(part);const data=concat(parts);if(!data.length||data.length%2)throw new Error('audio_format');const audio=wav(data,24000);return json({audio:b64encode(audio),mime:'audio/wav',ms:Date.now()-start,durationSeconds:data.length/48000,bytes:audio.length});}
export async function transcribeYiddishTools(env:Env,pcm:Uint8Array,signal:AbortSignal) {
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
export async function transcribeGemini(env:Env,pcm:Uint8Array,signal:AbortSignal){
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.PBX_PILOT_OPENROUTER_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:YIDDISH_MODEL,max_tokens:240,temperature:0,reasoning:{effort:'none'},messages:[{role:'system',content:'You are a speech-to-text transcriber. Transcribe the audible words verbatim in Hebrew script. The speaker may alternate between modern Hebrew and Hasidic Yiddish within a sentence. Preserve the language and words actually spoken; do not translate, correct, complete, or answer. For silence or unintelligible sound output only [NO_SPEECH]. Return only the transcript.'},{role:'user',content:[{type:'input_audio',input_audio:{data:b64encode(wav(upsample8kTo16k(pcm),16000)),format:'wav'}},{type:'text',text:'Transcribe this audio exactly.'}]}]}),signal});
  if(!response.ok){const raw=await response.json<{error?:{message?:string}}>().catch(()=>null);const msg=raw?.error?.message||'';const reason=response.status===402?(/max_tokens|maximum tokens|fewer tokens/i.test(msg)?'token_budget':/credit|balance|payment|limit|fund/i.test(msg)?'credit_limit':'billing_required'):'provider_rejected';throw new Error('gemini_stt_'+response.status+':'+reason);}
  const result=await response.json<{choices?:{message?:{content?:string}}[]}>();const value=result.choices?.[0]?.message?.content?.trim().slice(0,1000);if(!value)throw new Error('gemini_stt_empty');return value==='[NO_SPEECH]'?'':value;
}
export const STT_MODES=['yiddish-tools','gemini'] as const;
type SttMode=typeof STT_MODES[number];
export const isSttMode=(v:unknown):v is SttMode=>typeof v==='string'&&STT_MODES.includes(v as SttMode);
async function transcribeTurn(env:Env,pcm:Uint8Array,signal:AbortSignal,mode:SttMode){
  if(mode==='gemini')return transcribeGemini(env,pcm,AbortSignal.any([signal,AbortSignal.timeout(10000)]));
  return transcribeYiddishTools(env,pcm,signal);
}
export const DEFAULT_CHANNEL_PROMPT='You are a calm Hasidic Yiddish language teacher on SpeakCall for a Hebrew-speaking learner. Teach only everyday Yiddish, one short question or example at a time. Use short Hebrew explanations when helpful, and natural Hasidic Yiddish for practice. Do not discuss news, politics, dating, movies, ideological or unrelated topics. Redirect to language practice. Never claim progress you did not observe. Write only the words to be spoken, no markdown. Keep replies under 35 words.';
type Message={role:'system'|'user'|'assistant';content:string};
async function teach(env:Env,messages:Message[],signal:AbortSignal,config:Config) {
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.PBX_PILOT_OPENROUTER_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:config.model||YIDDISH_MODEL,max_tokens:120,...((config.model||YIDDISH_MODEL)===YIDDISH_MODEL?{reasoning:{effort:'none'}}:{}),messages:[{role:'system',content:config.prompt||DEFAULT_CHANNEL_PROMPT},...messages.slice(-12)]}),signal});
  if(!response.ok) throw new Error('model_failed');
  const result=await response.json<{choices?:{message?:{content?:string}}[];usage?:{prompt_tokens?:number;completion_tokens?:number;cost?:number}}>();const text=result.choices?.[0]?.message?.content?.trim().slice(0,600);if(!text)throw new Error('empty_model');return {text,usage:result.usage};
}
type ChannelEvent={atMs:number;name:string;detail?:string};
type ChannelTranscript={atMs:number;direction:'input'|'output';text:string};
type ChannelMetrics={inputTokens:number;outputTokens:number;modelUsd:number|null;estimatedSpeechUsd:number;estimatedSttUsd:number};
const INTERRUPTION_MODES: PilotInterruption[]=['legacy','observe','adaptive','adaptive_clear'];
type TurnTiming={sttMs:number|null;modelMs:number|null;ttsFirstMs:number|null;totalMs:number|null;stt:SttMode};
type ChannelCall={startedAt:string;durationSeconds:number;firstAudioMs:number|null;outcome:string;voice:string;model:string;turns:number;timings?:TurnTiming[];id?:string;capture?:boolean;transcript?:ChannelTranscript[];events?:ChannelEvent[];metrics?:ChannelMetrics;tuning?:TurnTuning;endpointMs?:number;interruption?:PilotInterruption;stt?:SttMode};
type Config={voice:string;speech?:SpeechMode;inworldKey?:string;googleKey?:string;speechLanguage?:string;inworldModel?:string;stt?:SttMode;capture?:boolean;tuning?:TurnTuning;endpointMs?:number;interruption?:PilotInterruption; token?:string; speechKey?:string; modelKey?:string; model?:string; prompt?:string; greeting?:string};
const teacherConfig=(c:Config)=>({voice:c.voice,speech:c.speech||'yiddish',speechLanguage:c.speechLanguage||'auto',inworldModel:c.inworldModel||'inworld-tts-2-flash',stt:c.stt||'yiddish-tools',model:c.model||YIDDISH_MODEL,prompt:c.prompt||DEFAULT_CHANNEL_PROMPT,greeting:c.greeting||DEFAULT_GREETING,capture:c.capture!==false,tuning:resolveTurnTuning(c.tuning),endpointMs:c.endpointMs??700,interruption:c.interruption||'adaptive'});
const DEFAULT_GREETING='שלום עליכם! איך בין דיין ייִדיש לערער. ווי גייט עס דיר היינט?';
export const CHANNEL_MODELS=[YIDDISH_MODEL,'openai/gpt-4.1-mini','qwen/qwen3-235b-a22b-2507'];
export const channelId=(value:unknown):value is string=>typeof value==='string'&&/^[a-z][a-z0-9-]{1,39}$/.test(value)&&!['pilot','router','registry'].includes(value);

export class YiddishChannel {
  private active=false;
  private liveCall:ChannelCall|null=null;
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
    const saved=await this.state.storage.get<Config>('config');const config:Config={voice:'avrumi',stt:id==='yiddish'?'gemini':'yiddish-tools',...saved};
    const token=config.token||(id==='yiddish'?this.env.YIDDISH_CHANNEL_TOKEN:undefined);
    const effective=(c:Config)=>({...this.env,YIDDISH_TOOLS_API_KEY:c.speechKey||this.env.YIDDISH_TOOLS_API_KEY,PBX_PILOT_OPENROUTER_KEY:c.modelKey||this.env.PBX_PILOT_OPENROUTER_KEY,PBX_PILOT_INWORLD_KEY:c.inworldKey||this.env.PBX_PILOT_INWORLD_KEY,PBX_PILOT_GOOGLE_TTS_KEY:c.googleKey||this.env.PBX_PILOT_GOOGLE_TTS_KEY});
    const ready=(c:Config)=>{const e=effective(c),speech=c.speech||'yiddish';return !!e.PBX_PILOT_OPENROUTER_KEY&&((c.stt||'yiddish-tools')==='gemini'||!!e.YIDDISH_TOOLS_API_KEY)&&(speech==='google'?!!e.PBX_PILOT_GOOGLE_TTS_KEY:speech==='inworld'?!!e.PBX_PILOT_INWORLD_KEY:!!e.YIDDISH_TOOLS_API_KEY);};
    const publicConfig=async(c:Config)=>({...teacherConfig(c),tokenConfigured:!!(c.token||token),speechKeySaved:!!c.speechKey,modelKeySaved:!!c.modelKey,inworldKeySaved:!!c.inworldKey,googleKeySaved:!!c.googleKey,configured:!!(c.token||token)&&ready(c),wss:YIDDISH_WSS.replace(/yiddish$/,id),lastError:await this.state.storage.get('last_error')??null,previousAvailable:!!await this.state.storage.get('previous_teacher')});
    if(path==='/settings') {
      if(request.method==='PUT') {
        const body=await request.json<Record<string,unknown>>().catch(()=>null);
        const speech=isSpeechMode(body?.speech)?body.speech:config.speech||'yiddish';
        if(!body||(body.speech!==undefined&&!isSpeechMode(body.speech))||(body.voice!==undefined&&!voiceValid(speech,body.voice))||(body.speechLanguage!==undefined&&!LANGUAGE_CODES.includes(String(body.speechLanguage)))||(body.inworldModel!==undefined&&!INWORLD_MODELS.includes(String(body.inworldModel)))||(body.stt!==undefined&&!isSttMode(body.stt))||(body.token!==undefined&&(typeof body.token!=='string'||body.token.length<8||body.token.length>256))||['speechKey','modelKey','inworldKey','googleKey'].some(k=>body[k]!==undefined&&(typeof body[k]!=='string'||String(body[k]).length>512||String(body[k]).length<8))||(body.model!==undefined&&!CHANNEL_MODELS.includes(String(body.model)))||['prompt','greeting'].some(k=>body[k]!==undefined&&(typeof body[k]!=='string'||!String(body[k]).trim()||String(body[k]).length>(k==='prompt'?6000:500)))||(body.capture!==undefined&&typeof body.capture!=='boolean')||(body.tuning!==undefined&&!TurnTuningSchema.safeParse(body.tuning).success)||(body.endpointMs!==undefined&&![500,700,1000,1500].includes(Number(body.endpointMs)))||(body.interruption!==undefined&&!INTERRUPTION_MODES.includes(body.interruption as PilotInterruption)))return json({error:'בדוק את הגדרות הערוץ'},400);
        const updated:Config={...config,speech,voice:typeof body.voice==='string'?body.voice:voiceValid(speech,config.voice)?config.voice:defaultVoice(speech),...(isSttMode(body.stt)?{stt:body.stt}:{})};for(const k of ['token','speechKey','modelKey','inworldKey','googleKey','model','prompt','greeting','speechLanguage','inworldModel'] as const)if(typeof body[k]==='string')updated[k]=body[k];
        if(typeof body.capture==='boolean')updated.capture=body.capture;if(body.tuning!==undefined)updated.tuning=TurnTuningSchema.parse(body.tuning);if(body.endpointMs!==undefined)updated.endpointMs=Number(body.endpointMs);if(body.interruption!==undefined)updated.interruption=body.interruption as PilotInterruption;
        if(body.rollback===true){const previous=await this.state.storage.get<ReturnType<typeof teacherConfig>>('previous_teacher');if(!previous)return json({error:'אין גרסה קודמת'},409);Object.assign(updated,previous);}
        if(JSON.stringify(teacherConfig(updated))!==JSON.stringify(teacherConfig(config)))await this.state.storage.put('previous_teacher',teacherConfig(config));
        await this.state.storage.put('config',updated);return json(await publicConfig(updated));
      }
      return json(await publicConfig(config));
    }
    if(path==='/model-status'&&request.method==='GET'){
      const e=effective(config);if(!e.PBX_PILOT_OPENROUTER_KEY)return json({configured:false});
      try{const r=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+e.PBX_PILOT_OPENROUTER_KEY},signal:AbortSignal.timeout(6000)});if(!r.ok)return json({configured:true,status:r.status});const result=await r.json<{data?:Record<string,unknown>}>();const d=result.data||{};const fields=['limit','limit_remaining','usage','usage_daily','usage_weekly','usage_monthly','is_free_tier','limit_reset'];return json({configured:true,status:r.status,...Object.fromEntries(fields.filter(k=>['number','boolean','string'].includes(typeof d[k])||d[k]===null).map(k=>[k,d[k]]))});}catch{return json({configured:true,error:'connection_failed'});}
    }
    if(path==='/stt-test'&&request.method==='POST'){
      const b=await request.json<{pcm?:string}>().catch(()=>null);if(!b||typeof b.pcm!=='string'||b.pcm.length>260000)return json({error:'נדרש שמע PCM קצר'},400);
      let pcm:Uint8Array;try{pcm=Uint8Array.from(atob(b.pcm),c=>c.charCodeAt(0));}catch{return json({error:'שמע לא תקין'},400);}if(pcm.length<1600||pcm.length>192000||pcm.length%2)return json({error:'שמע לא תקין'},400);
      const e=effective(config);const results=await Promise.all(STT_MODES.map(async mode=>{const start=Date.now();try{const text=await transcribeTurn(e,pcm,AbortSignal.timeout(30000),mode);return {mode,ms:Date.now()-start,text};}catch(error){return {mode,ms:Date.now()-start,error:error instanceof Error&&/^(gemini_stt_\d{3}(?::[a-z_]+)?|gemini_stt_empty|stt_submit|stt_poll|stt_failed|stt_timeout)$/.test(error.message)?error.message:'transcription_error'};}}));return json({results});
    }
    if(path==='/calls'&&request.method==='GET')return json({calls:await this.state.storage.get<ChannelCall[]>('call_history')??[],active:this.active,liveCall:this.liveCall});
    if(path==='/preview'&&request.method==='POST') {
      const b=await request.json<{text?:unknown;voice?:unknown;speechKey?:unknown;speech?:unknown;speechLanguage?:unknown;inworldModel?:unknown}>().catch(()=>null);
      const speech=isSpeechMode(b?.speech)?b.speech:config.speech||'yiddish';
      if(!b||typeof b.text!=='string'||!b.text.trim()||b.text.length>1000||!voiceValid(speech,b.voice)||(b.speech!==undefined&&!isSpeechMode(b.speech))||(b.speechLanguage!==undefined&&!LANGUAGE_CODES.includes(String(b.speechLanguage)))||(b.inworldModel!==undefined&&!INWORLD_MODELS.includes(String(b.inworldModel)))||(b.speechKey!==undefined&&(typeof b.speechKey!=='string'||b.speechKey.length<8||b.speechKey.length>512)))return json({error:'הזן טקסט, קול ומפתח תקינים'},400);
      try{
        const previewConfig:Config={...config,speech,voice:String(b.voice),...(typeof b.speechKey==='string'?{speechKey:b.speechKey}:{}),...(typeof b.speechLanguage==='string'?{speechLanguage:b.speechLanguage}:{}),...(typeof b.inworldModel==='string'?{inworldModel:b.inworldModel}:{})};const result=await channelSpeechPreview(effective(previewConfig),previewConfig,b.text);
        if(result.ok){
          if(typeof b.speechKey==='string'){const speechKey=b.speechKey;await this.state.storage.transaction(async tx=>{const latest=await tx.get<Config>('config')??config;await tx.put('config',{...latest,speechKey});});}
          await this.state.storage.delete('last_error');
        }
        return result;
      }catch(error){const reason=error instanceof Error&&/^tts_failed_\d{3}$|^audio_format$/.test(error.message)?error.message:'provider_error';await this.state.storage.put('last_error',reason);return json({error:reason==='tts_failed_401'?'Yiddish Tools דחה את המפתח (401). הדבק את מפתח הספק עצמו ולחץ האזן או שמור.':reason==='audio_format'?'הספק החזיר שמע בפורמט לא נתמך':reason},502);}

    }
    if(!path.startsWith('/v1/technoline/')||!channelId(id))return new Response('Not found',{status:404});
    const callEnv=effective(config);
    if(!token||!ready(config))return new Response('Not configured',{status:503});
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Expected WebSocket',{status:426});
    const pair=new WebSocketPair();const socket=pair[1];socket.accept();socket.binaryType='arraybuffer';
    const settings=teacherConfig(config);const sttMode=settings.stt;const timings:TurnTiming[]=[],events:ChannelEvent[]=[],transcript:ChannelTranscript[]=[];const metrics:ChannelMetrics={inputTokens:0,outputTokens:0,modelUsd:null,estimatedSpeechUsd:0,estimatedSttUsd:0};
    let started=false,closed=false,busy=false,ownsCall=false,parts:Uint8Array[]=[],silence=0,spoken=0,turns=0,startedAt=0,firstAudioMs:number|null=null,outcome='caller_disconnected';
    let playback:{controller:AbortController;interrupted:boolean;gate:ChannelBargeIn;candidate:Uint8Array[];candidateSpoken:number}|null=null;
    const abort=new AbortController();const history:Message[]=[];const callId=crypto.randomUUID();
    const snapshot=():ChannelCall=>({id:callId,startedAt:new Date(startedAt).toISOString(),durationSeconds:Math.round((Date.now()-startedAt)/1000),firstAudioMs,outcome,voice:settings.voice,model:settings.model,turns,timings:[...timings],capture:settings.capture,transcript:[...transcript],events:[...events],metrics:{...metrics},tuning:settings.tuning,endpointMs:settings.endpointMs,interruption:settings.interruption,stt:sttMode});
    const update=()=>{if(started&&!closed)this.liveCall=snapshot();};
    const event=(name:string,detail?:string)=>{if(!started||closed)return;events.push({atMs:Date.now()-startedAt,name,...(detail?{detail}:{})});if(events.length>200)events.shift();update();};
    const recordText=(direction:'input'|'output',text:string)=>{if(settings.capture){transcript.push({atMs:Date.now()-startedAt,direction,text:text.slice(0,1000)});if(transcript.length>60)transcript.shift();}update();};
    const finish=()=>{if(closed)return;if(ownsCall)event('call_ended',outcome);closed=true;abort.abort();playback?.controller.abort();clearTimeout(startTimer);clearTimeout(limitTimer);if(ownsCall){this.active=false;const record=snapshot();this.liveCall=null;this.state.waitUntil(this.state.storage.transaction(async tx=>{const calls=await tx.get<ChannelCall[]>('call_history')??[];await tx.put('call_history',[record,...calls].slice(0,30));}).catch(()=>{}));}try{socket.close(1000,'Call ended');}catch{}};
    const startTimer=setTimeout(finish,5000),limitTimer=setTimeout(()=>{outcome='time_limit';try{socket.send(JSON.stringify({type:'hangup'}));}finally{finish();}},300000);
    const speak=async(text:string,onFirst?:()=>void)=>{
      const current={controller:new AbortController(),interrupted:false,gate:new ChannelBargeIn(settings.interruption,settings.tuning),candidate:[] as Uint8Array[],candidateSpoken:0};playback=current;
      let next=Date.now(),frames=0;let pausedPreviously=false;
      try{
        const signal=AbortSignal.any([abort.signal,current.controller.signal,AbortSignal.timeout(25000)]);const chars=Array.from(text).length;metrics.estimatedSpeechUsd+=settings.speech==='yiddish'?Math.ceil(chars/100)*0.002:chars*(settings.speech==='google'?4:15)/1000000;recordText('output',text);
        for await(const frame of pcm24kTelephoneFrames(channelPcm(callEnv,config,text,signal))){
          while(current.gate.paused&&!closed&&!current.interrupted){pausedPreviously=true;await sleep(20);}
          if(closed||current.interrupted)break;if(pausedPreviously){next=Date.now();pausedPreviously=false;}
          await sleep(Math.max(0,next-Date.now()));if(closed||current.interrupted)break;socket.send(frame);if(!frames){onFirst?.();if(firstAudioMs===null){firstAudioMs=Date.now()-startedAt;event('first_audio',firstAudioMs+' ms');}}frames++;next=Math.max(next+20,Date.now());
        }
        if(!closed&&!current.interrupted&&!frames)throw new Error('audio_format');
      }catch(error){if(!current.interrupted&&!closed)throw error;}finally{if(playback===current)playback=null;update();}
    };
    const fail=async(error?:unknown)=>{if(closed)return;const reason=error instanceof Error && /^(tts_failed_\d{3}|gemini_stt_\d{3}(?::[a-z_]+)?|gemini_stt_empty|audio_format|stt_submit|stt_poll|stt_failed|stt_timeout|model_failed|empty_model)$/.test(error.message)?error.message:'provider_error';outcome=reason;event('provider_error',reason);await this.state.storage.put('last_error',reason).catch(()=>{});try{await speak('אַנטשולדיקט, ס׳איז אַ טעכנישע פּראָבלעם. פּרוּווט ווידער שפּעטער.');}catch{}try{socket.send(JSON.stringify({type:'hangup',reason}));}finally{finish();}};
    const handle=async(pcm:Uint8Array)=>{busy=true;const start=Date.now();const metric:TurnTiming={sttMs:null,modelMs:null,ttsFirstMs:null,totalMs:null,stt:sttMode};timings.push(metric);event('transcription_started',sttMode);try{
      let text:string;try{text=await transcribeTurn(callEnv,pcm,abort.signal,sttMode);}catch(error){if(sttMode!=='gemini'||abort.signal.aborted||!callEnv.YIDDISH_TOOLS_API_KEY||(error instanceof Error&&error.message.startsWith('gemini_stt_402')))throw error;metric.stt='yiddish-tools';event('stt_fallback','Yiddish Tools');text=await transcribeTurn(callEnv,pcm,abort.signal,'yiddish-tools');}metric.sttMs=Date.now()-start;if(metric.stt==='yiddish-tools')metrics.estimatedSttUsd+=Math.ceil(pcm.length/16000/60*10)*0.001;event('transcription_finished',metric.sttMs+' ms');if(closed)return;
      if(!text){const at=Date.now();await speak('זאָג עס נאָך אַ מאָל, ביטע.',()=>{metric.ttsFirstMs=Date.now()-at;metric.totalMs=Date.now()-start;event('reply_audio_started',metric.totalMs+' ms');});return;}
      recordText('input',text);history.push({role:'user',content:text});const modelAt=Date.now();const reply=await teach(callEnv,history,abort.signal,config);metric.modelMs=Date.now()-modelAt;metrics.inputTokens+=reply.usage?.prompt_tokens||0;metrics.outputTokens+=reply.usage?.completion_tokens||0;if(typeof reply.usage?.cost==='number')metrics.modelUsd=(metrics.modelUsd??0)+reply.usage.cost;event('model_finished',metric.modelMs+' ms');history.push({role:'assistant',content:reply.text});const ttsAt=Date.now();await speak(reply.text,()=>{metric.ttsFirstMs=Date.now()-ttsAt;metric.totalMs=Date.now()-start;event('reply_audio_started',metric.totalMs+' ms');});
    }catch(error){await fail(error);}finally{busy=false;update();}};
    const captureFrame=(frame:Uint8Array,loud:boolean)=>{if(loud){spoken+=20;silence=0;}else if(parts.length)silence+=20;if(loud||parts.length)parts.push(frame);if(!busy&&parts.length&&(silence>=settings.endpointMs||parts.length>=600)){const captured=concat(parts);parts=[];const valid=spoken>=160;spoken=0;silence=0;if(valid){if(++turns>25){outcome='turn_limit';finish();return;}event('learner_turn_ended');this.state.waitUntil(handle(captured));}}};
    socket.addEventListener('close',finish);socket.addEventListener('error',finish);
    socket.addEventListener('message',eventMessage=>{
      if(closed)return;
      if(!started){if(typeof eventMessage.data!=='string'){finish();return;}try{parseStartFrame(eventMessage.data,token);}catch{finish();return;}if(this.active){finish();return;}this.active=true;ownsCall=true;started=true;startedAt=Date.now();clearTimeout(startTimer);busy=true;event('call_started',settings.voice+' / '+settings.model);this.state.waitUntil(speak(settings.greeting).then(()=>this.state.storage.delete('last_error')).catch(error=>fail(error)).finally(()=>{busy=false;update();}));return;}
      if(typeof eventMessage.data==='string'){try{if(['stop','hangup','end'].includes(JSON.parse(eventMessage.data).type))finish();}catch{}return;}
      if(!(eventMessage.data instanceof ArrayBuffer)||eventMessage.data.byteLength!==FRAME_BYTES)return;
      const frame=new Uint8Array(eventMessage.data),energy=meanSquare(frame);const loud=energy>550**2;
      if(busy&&playback&&!playback.interrupted){const current=playback;const bargeLoud=energy>settings.tuning.energyThreshold**2;
        if(bargeLoud||current.candidate.length){current.candidate.push(frame);if(bargeLoud)current.candidateSpoken+=20;if(current.candidate.length>120)current.candidate.shift();}
        const action=current.gate.frame(bargeLoud);
        if(!bargeLoud&&!current.gate.paused&&action===null){current.candidate=[];current.candidateSpoken=0;}
        if(action==='candidate')event('pilot_interruption_candidate');
        else if(action==='resumed'){event('pilot_interruption_resumed');current.candidate=[];current.candidateSpoken=0;}
        else if(action==='interrupted'){event('tutor_interrupted');parts=current.candidate;spoken=current.candidateSpoken;silence=0;current.interrupted=true;current.controller.abort();if(settings.interruption==='adaptive_clear'){try{socket.send(JSON.stringify({type:'clear_audio'}));}catch{}}}
        return;
      }
      if(busy&&!playback)return;captureFrame(frame,loud);
    });
    return new Response(null,{status:101,webSocket:pair[0]});
  }
}
