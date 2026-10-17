import {helicopterProfile,validateHelicopterProof} from './mumu-helicopter-proof.mjs';
import {trainLoadingProfile,validateTrainLoadingProof} from './mumu-train-loading-proof.mjs';
import {helicopterItemRegions,trainItemRegions,airportItemRegions} from './mumu-item-regions.mjs';
import {airportLoadingProfile,validateAirportLoadingProof,airportCase} from './mumu-airport-loading-proof.mjs';
// Generated from the current hash-bound program registration, never from an
// editable target's proposed mask. Legacy/GPT targets retain exact criticals.
export function itemRegionsForPreflight(frame,target){
 const r=frame.review;
 if(!r?.targets?.some(t=>JSON.stringify(t)===JSON.stringify(target)))return [];
 if(r.reviewedBy==='program-helicopter'&&['send_helicopter','delete_helicopter'].includes(target.kind)){
  validateHelicopterProof(frame);return helicopterItemRegions(helicopterProfile(frame).profile,r.data.order?.needs);
 }
 if(r.reviewedBy==='program-train-loading'&&(target.kind==='load_train'||target.kind==='inspect_item'&&target.trainDetail)){
  validateTrainLoadingProof(frame);return trainItemRegions(trainLoadingProfile(frame).profile,r.data.train,r.data.order?.needs,r.proof.slotReading?.slots);
 }
 if(r.reviewedBy==='program-airport-loading'&&(target.kind==='load_airport'||target.kind==='inspect_item'&&target.airportDetail)){
  validateAirportLoadingProof(frame);const reg=airportLoadingProfile(frame),c=airportCase(r.data.airport,reg);
  return c.regions.flatMap(s=>airportItemRegions(reg.profile,c,s.box));
 }
 return [];
}
