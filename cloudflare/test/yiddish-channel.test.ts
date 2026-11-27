import { describe,it,expect,vi } from 'vitest';
import { YiddishChannel, yiddishPreview, yiddishVoices } from '../src/yiddish-channel';
import { wav } from '../src/audio';
import type { Env } from '../src/env';
import pilot from '../src/pbx-pilot-entry';
const env={YIDDISH_TOOLS_API_KEY:'test-secret',PBX_PILOT_OPENROUTER_KEY:'test-model',YIDDISH_CHANNEL_TOKEN:'test-token'} as Env;
describe('isolated Yiddish channel',()=>{
 it('has all nineteen voice choices',()=>expect(yiddishVoices).toHaveLength(19));
 it('persists only channel settings without returning the token',async()=>{
  const values=new Map();const channel=new YiddishChannel({storage:{get:async(k:string)=>values.get(k),put:async(k:string,v:unknown)=>values.set(k,v)}} as unknown as DurableObjectState,env);
  const result=await channel.fetch(new Request('https://internal.invalid/settings',{method:'PUT',body:JSON.stringify({voice:'mottel',token:'new-secret-token'})}));expect(result.status).toBe(200);expect(await result.json()).toMatchObject({voice:'mottel',configured:true});
  const read=await channel.fetch(new Request('https://internal.invalid/settings'));expect(await read.text()).not.toContain('new-secret-token');
  expect((await channel.fetch(new Request('https://internal.invalid/settings',{method:'PUT',body:JSON.stringify({voice:'unknown'})}))).status).toBe(400);
 });
 it('requires the admin session for configuration',async()=>{const response=await pilot.fetch(new Request('https://speakcall.app/dashboard/pilot-888/yiddish-settings'),{ADMIN_DB:{} as D1Database} as unknown as Env);expect(response.status).toBe(401);});
 it('returns browser-playable WAV without embedding provider credentials',async()=>{
  const mock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(wav(new Uint8Array(480),24000),{headers:{'Content-Type':'audio/wav'}}));
  try{const response=await yiddishPreview(env,'שלום עליכם','avrumi');const text=await response.json();expect(text).toMatchObject({mime:'audio/wav'});expect(JSON.stringify(text)).not.toContain('test-secret');expect(mock).toHaveBeenCalledOnce();}finally{mock.mockRestore();}
 });
});
