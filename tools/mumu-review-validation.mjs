import {validateHelicopterProof} from './mumu-helicopter-proof.mjs';
import {validateHelicopterInfoProof} from './mumu-helicopter-info-proof.mjs';
import {validateTrainRewardProof} from './mumu-train-reward-proof.mjs';
import {validateTrainLoadingProof} from './mumu-train-loading-proof.mjs';
import {validateAirportLoadingProof} from './mumu-airport-loading-proof.mjs';
import {validateTransportNavigationProof} from './mumu-transport-navigation-proof.mjs';
import {validateMarketProof} from './mumu-market-proof.mjs';
import {validateBarnProof} from './mumu-barn-sale-proof.mjs';
const tail=[validateBarnProof,validateTrainRewardProof,validateTrainLoadingProof,validateAirportLoadingProof,validateTransportNavigationProof,validateMarketProof];
const admission=[validateHelicopterProof,...tail];
const review=[...admission,validateHelicopterInfoProof];
const preflight=[validateHelicopterProof,validateHelicopterInfoProof,...tail];
const phases=Object.freeze({admission,review,preflight});
export function validateFrameProofs(frame,phase){
  if(!Object.hasOwn(phases,phase))throw Error('REVIEW_VALIDATION_PHASE_INVALID');
  for(const validate of phases[phase])validate(frame);
}
