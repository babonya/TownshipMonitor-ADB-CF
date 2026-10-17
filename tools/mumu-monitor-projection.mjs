// Disposable indexes for one UI read. Freshness remains tied to that read's clock.
export function snapshotProjectionContext(state){
  const frames=Object.values(state.frames),actions=Object.values(state.actions),jobs={};
  for(const frame of frames)jobs[frame.job.status]=(jobs[frame.job.status]??0)+1;
  return {jobs,actions,orderedFrames:frames.sort((a,b)=>b.sequence-a.sequence),
    recentActions:[...actions].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,30)};
}
export function reservationTotals(reservations=[]){
  const totals=new Map();
  for(const row of reservations??[])totals.set(row.itemId,(totals.get(row.itemId)??0)+row.quantity);
  return totals;
}
