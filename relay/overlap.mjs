// Suppress byte-identical ADTS overlap only at upstream reconnect boundaries.
// Never deduplicate repeated words/silence inside an uninterrupted broadcast.
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
const join = frames => {
  const result = new Uint8Array(frames.reduce((n,f) => n+f.length,0));
  let at=0; for(const f of frames){result.set(f,at);at+=f.length;} return result;
};
export class ReconnectOverlap {
  constructor(){this.history=[];this.pending=[];this.previous=[];this.searching=false;this.cursor=-1;this.skippedFrames=0;}
  begin(){this.previous=this.history.slice();this.pending=[];this.searching=this.previous.length>=8;this.cursor=-1;}
  remember(frame,out){
    const copy=frame.slice();this.history.push(copy);out.push(frame);
    // About 80 seconds at 48 kHz; bounded per listener. Trim in batches.
    if(this.history.length>4096)this.history.splice(0,256);
  }
  push(bytes){
    const out=[];
    for(let at=0;at+7<=bytes.length;){
      const size=((bytes[at+3]&3)<<11)|(bytes[at+4]<<3)|(bytes[at+5]>>5);
      if(size<7 || at+size>bytes.length)throw new Error('Expected complete ADTS frames');
      const frame=bytes.subarray(at,at+size);at+=size;
      if(this.searching){
        this.pending.push(frame.slice());
        if(this.pending.length<8)continue;
        let match=-1;
        for(let i=this.previous.length-8;i>=0;i--){
          if(this.pending.every((f,j)=>same(f,this.previous[i+j]))){match=i;break;}
        }
        this.searching=false;
        if(match>=0){this.cursor=match+8;this.skippedFrames+=8;}
        else for(const f of this.pending)this.remember(f,out);
        this.pending=[];continue;
      }
      if(this.cursor>=0 && this.cursor<this.previous.length && same(frame,this.previous[this.cursor])){
        this.cursor++;this.skippedFrames++;continue;
      }
      this.cursor=-1;this.remember(frame,out);
    }
    return join(out);
  }
  finish(){
    // A short response lacks the eight-frame proof: preserve it, don't guess.
    const out=[];for(const f of this.pending)this.remember(f,out);
    this.pending=[];this.searching=false;return join(out);
  }
}
