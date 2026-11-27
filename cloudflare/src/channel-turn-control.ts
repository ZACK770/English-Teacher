import type { PilotInterruption } from './env';
import type { TurnTuning } from './turn-tuning';

export type BargeAction='candidate'|'resumed'|'interrupted'|null;
/** Acoustic interruption control for turn-based ASR (no partial words are available). */
export class ChannelBargeIn {
  private loudMs=0;private quietMs=0;private candidateMs=0;private candidate=false;
  paused=false;
  constructor(private mode:PilotInterruption,private tuning:TurnTuning){}
  reset(){this.loudMs=0;this.quietMs=0;this.candidateMs=0;this.candidate=false;this.paused=false;}
  frame(loud:boolean,ms=20):BargeAction {
    if(loud){this.loudMs+=ms;this.quietMs=0;} else {this.quietMs+=ms;if(!this.candidate)this.loudMs=0;}
    if(this.mode==='legacy'&&this.loudMs>=100){this.reset();return 'interrupted';}
    if(!this.candidate&&this.loudMs>=this.tuning.minSoundMs){this.candidate=true;this.paused=this.mode!=='observe';this.candidateMs=0;return 'candidate';}
    if(!this.candidate)return null;
    this.candidateMs+=ms;
    if(this.quietMs>=this.tuning.resumeSilenceMs||this.candidateMs>=1100&&!loud){this.reset();return 'resumed';}
    if(this.mode!=='observe'&&loud&&this.candidateMs>=160){this.reset();return 'interrupted';}
    return null;
  }
}
