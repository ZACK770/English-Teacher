import { concat, downsample24kTo8k, FRAME_BYTES, wav } from './audio';

// Streaming WAV may advertise an intentionally huge RIFF/data size. Validate the
// format, consume only bytes actually received, and preserve chunk boundaries.
export async function* yiddishPcm(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader=stream.getReader();
  let buffer:Uint8Array=new Uint8Array(), riff=false, fmt=false, inData=false, remaining=0, received=0;
  let odd:Uint8Array=new Uint8Array();
  const label=(bytes:Uint8Array,offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      buffer=concat([buffer,value]);
      if(!riff){if(buffer.length<12)continue;if(label(buffer,0)!=='RIFF'||label(buffer,8)!=='WAVE')throw new Error('audio_format');buffer=buffer.slice(12);riff=true;}
      while(!inData&&buffer.length>=8){
        const type=label(buffer,0),size=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength).getUint32(4,true);
        if(type==='data'){
          if(!fmt)throw new Error('audio_format');inData=true;remaining=size>=0x7fffffff?Infinity:size;buffer=buffer.slice(8);break;
        }
        if(size>1024*1024)throw new Error('audio_format');
        const end=8+size+(size%2);if(buffer.length<end)break;
        if(type==='fmt '){
          if(size<16)throw new Error('audio_format');const v=new DataView(buffer.buffer,buffer.byteOffset+8,size);
          if(v.getUint16(0,true)!==1||v.getUint16(2,true)!==1||v.getUint32(4,true)!==24000||v.getUint16(14,true)!==16)throw new Error('audio_format');fmt=true;
        }
        buffer=buffer.slice(end);
      }
      if(!inData){if(buffer.length>1024*1024+8)throw new Error('audio_format');continue;}
      const count=Math.min(buffer.length,remaining);const bytes=concat([odd,buffer.subarray(0,count)]);remaining-=count;received+=count;
      if(received>8*1024*1024)throw new Error('audio_format');
      const aligned=bytes.length-(bytes.length%2);odd=bytes.slice(aligned);buffer=new Uint8Array();if(aligned)yield bytes.subarray(0,aligned);
      if(remaining===0)break;
    }
    if(!inData||!received||odd.length||(Number.isFinite(remaining)&&remaining>0))throw new Error('audio_format');
  }finally{await reader.cancel().catch(()=>{});}
}

export async function normalizedYiddishWav(stream:ReadableStream<Uint8Array>) {
  const parts:Uint8Array[]=[];for await(const pcm of yiddishPcm(stream))parts.push(pcm);const data=concat(parts);return {audio:wav(data,24000),durationSeconds:data.length/48000};
}

export async function* pcm24kTelephoneFrames(chunks:AsyncIterable<Uint8Array>):AsyncGenerator<Uint8Array>{
  let carry:Uint8Array=new Uint8Array(),pending:Uint8Array=new Uint8Array();
  for await(const chunk of chunks){
    const [pcm,remainder]=downsample24kTo8k(chunk,carry);carry=remainder;const combined=concat([pending,pcm]);let offset=0;
    while(offset+FRAME_BYTES<=combined.length){yield combined.slice(offset,offset+FRAME_BYTES);offset+=FRAME_BYTES;}
    pending=combined.slice(offset);
  }
  if(pending.length){const frame=new Uint8Array(FRAME_BYTES);frame.set(pending);yield frame;}
}

export function telephoneYiddishFrames(stream:ReadableStream<Uint8Array>){return pcm24kTelephoneFrames(yiddishPcm(stream));}
