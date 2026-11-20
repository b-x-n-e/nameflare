// One state machine per Flare. UI intent changes immediately; writes remain ordered.
export function createLikeController({send,onChange=()=>{},onError=()=>{},onSettled=()=>{},delay=160}) {
  const entries=new Map();let generation=0,revision=0;
  const snapshot=entry=>({id:entry.id,liked:entry.desired,count:Math.max(0,entry.count+Number(entry.desired)-Number(entry.confirmed)),pending:entry.pending});
  const emit=entry=>onChange(snapshot(entry));
  async function drain(entry,epoch) {
    if(entry.running || epoch!==generation)return;
    entry.running=true;let failure=null;
    try {
      while(entry.desired!==entry.confirmed && epoch===generation) {
        const target=entry.desired;
        const result=await send(entry.id,target);
        if(epoch!==generation)return;
        if(result.id!==entry.id || result.liked!==target || !Number.isInteger(result.like_count) || result.like_count<0)throw new Error('Invalid like response. Please try again.');
        entry.confirmed=target;entry.count=result.like_count;emit(entry);
      }
    } catch(error) {
      if(epoch!==generation)return;
      entry.desired=entry.confirmed;failure=error;onError(error,entry.id);
    } finally {
      if(epoch===generation) {
        entry.running=false;entry.pending=false;entry.revision=++revision;emit(entry);onSettled(snapshot(entry),failure);
      }
    }
  }
  return {
    get revision(){return revision;},
    get pending(){return [...entries.values()].some(entry=>entry.pending);},
    get(id){const entry=entries.get(id);return entry?snapshot(entry):null;},
    observe(id,count,liked,readRevision=revision) {
      let entry=entries.get(id);
      if(entry && (entry.pending || entry.revision>readRevision))return snapshot(entry);
      count=Number.isInteger(count)&&count>=0?count:0;
      if(!entry){entry={id,count,confirmed:Boolean(liked),desired:Boolean(liked),pending:false,running:false,revision:0,timer:null};entries.set(id,entry);}
      else {entry.count=count;entry.confirmed=entry.desired=Boolean(liked);}
      return snapshot(entry);
    },
    toggle(id) {
      const entry=entries.get(id);if(!entry)throw new Error('Load the Flare before liking it.');
      entry.desired=!entry.desired;entry.pending=true;entry.revision=++revision;emit(entry);
      clearTimeout(entry.timer);
      const epoch=generation;
      if(!entry.running)entry.timer=setTimeout(()=>{entry.timer=null;void drain(entry,epoch);},delay);
      return snapshot(entry);
    },
    flush(id) {const entry=entries.get(id);if(!entry)return Promise.resolve();clearTimeout(entry.timer);entry.timer=null;return drain(entry,generation);},
    reset(){generation++;for(const entry of entries.values())clearTimeout(entry.timer);entries.clear();revision++;}
  };
}
