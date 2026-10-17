// Event-specific immutable evidence validation. Called under the store's existing boundary.
import {isUnresolvedAction,hasUnresolvedActions} from './mumu-input-state.mjs';
import {atomic} from './mumu-persistence.mjs';
import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {digest,decodePng} from './adb.mjs';
import {WINDOWS_PROVIDER,compareWindowsGeometry,targetIdentity} from './windows-device.mjs';
import {validateManagement,validateMayorsCupClaim,MAYORS_CUP_ACTIVATION,MAYORS_CUP_CLAIM_GEOMETRY,mayorsCupBindingHash,MAYORS_CUP_POLICY_REVISION,validateMayorsCupGrant} from './mumu-management.mjs';
import {readContinuity,continuityRelease} from './mumu-continuity-record.mjs';
import {readInventoryRecord} from './mumu-inventory-record.mjs';
import {rejectedPreflight} from './mumu-rejected-preflight.mjs';
import {compareReviewedTarget} from './mumu-verification.mjs';
import {assertOrderStartupComplete} from './mumu-order-demand.mjs';
import {resultCaptureDueAt} from './mumu-timing.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {MAYORS_CUP_READER,validateProgramMayorsCupProof} from './mumu-mayors-cup-proof.mjs';
import {validateProgramMayorsCupSource} from './mumu-mayors-cup.mjs';
import {cupActionStage} from './mumu-cup-ocr.mjs';
const fail=code=>{throw Error(code);};
const id=s=>typeof s==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const clone=v=>structuredClone(v);

export function mayorsCupClaimSource(store,state,frame,review,{pending=false}={}){
    if(review?.reviewedBy===MAYORS_CUP_READER){
      assertOrderStartupComplete(state);validateManagement(state.session,review.targets?.[0]);
      return validateProgramMayorsCupSource(store,state,frame,review,{pending});
    }
    const reject=()=>fail('MAYORS_CUP_CLAIM_SOURCE_REQUIRED'),facts=review?.data?.mayorsCupClaim;
    const action=state.actions[state.input],now=store.clock();
    if(review?.reviewedBy!=='GPT'||review.actualKind!=='mayors_cup_result'||review.actualEntityId!==null||
        review.quality?.gameVisible!==true||review.quality.occluded!==false||review.targets?.length!==1||
        Object.keys(review.data??{}).length!==1||!facts||facts.title!=="MAYOR'S CUP"||facts.status!=='Finished'||facts.rank!==2||
        facts.rewardLabel!=='REWARD'||facts.claimText!=='CLAIM'||facts.rewardContents!=='undisclosed'||
        facts.priceVisible!==false||facts.advertisementVisible!==false||facts.couponVisible!==false||facts.selectionRequired!==false)reject();
    const keys=['title','status','rank','rewardLabel','claimText','rewardContents','priceVisible','advertisementVisible','couponVisible','selectionRequired','frameId','evidenceHash','epoch'];
    if(Object.keys(facts).length!==keys.length||Object.keys(facts).some(k=>!keys.includes(k)))reject();
    validateMayorsCupClaim(review.targets[0]);validateManagement(state.session,review.targets[0]);
    if(!frame||state.latestFrameId!==frame.id||frame.kind!=='mayors_cup_result'||frame.sceneId!==state.scene.id||
        frame.epoch!==(pending?state.scene.epoch-1:state.scene.epoch)||facts.frameId!==frame.id||facts.evidenceHash!==frame.evidenceHash||facts.epoch!==frame.epoch||
        !Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>now||now-Date.parse(frame.observedAt)>120000||
        !inputEvidenceValid(frame,now,state)||frame.width!==1578||frame.height!==1268||frame.provider!==WINDOWS_PROVIDER||
        state.session.provider!==WINDOWS_PROVIDER||frame.serial!==state.session.serial||frame.packageName!==state.session.packageName||
        JSON.stringify(targetIdentity(frame.captureTarget))!==JSON.stringify(targetIdentity(state.session.windowsTarget)))reject();
    if(pending?(action?.status!=='pending'||action.frameId!==frame.id||action.target.kind!=='claim_mayors_cup_reward'):
        (!!state.input||hasUnresolvedActions(state.actions)))reject();
    if(['capture.lock','helicopter-runner.lock','.management/runner.lock'].some(p=>existsSync(join(store.root,p)))||
        Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))fail('MAYORS_CUP_EXCLUSIVE_OWNER_REQUIRED');
    assertOrderStartupComplete(state);store.evidence(frame.id);return true;
}

export function mayorsCupReallocation(store,state,target,{pendingActionId=null}={}){
    validateMayorsCupClaim(target);
    const grant=target.management.reallocation?.grant,reject=()=>fail('MAYORS_CUP_REALLOCATION_PROOF_REQUIRED');
    if(!grant)reject();
    const attempts=Object.values(state.actions).filter(a=>a.target?.kind==='claim_mayors_cup_reward'||a.target?.management?.activationId===MAYORS_CUP_ACTIVATION);
    const revision=grant.id===MAYORS_CUP_POLICY_REVISION;
    // Exactly the two named failures under the explicit superseding policy;
    // never a caller-selected quota or an unbounded predecessor list.
    const proofs=revision?[grant,{...grant.secondFailure,predecessorActionId:grant.secondFailure.actionId,predecessorActionHash:grant.secondFailure.actionHash}]:[grant];
    const priors=proofs.map(p=>state.actions[p.predecessorActionId]),current=pendingActionId?state.actions[pendingActionId]:null;
    if(attempts.length!==priors.length+(pendingActionId?1:0)||priors.some(p=>!p||!attempts.includes(p))||
        (pendingActionId&&(!attempts.includes(current)||state.input!==current.id||current.status!=='pending'||current.management!==true||
          mayorsCupBindingHash(current.target)!==mayorsCupBindingHash(target)))||
        (!pendingActionId&&state.input!==null))fail('MAYORS_CUP_ATTEMPT_CAP_REACHED');
    const potential=attempts.filter(a=>Object.hasOwn(a,'inputReservedAt')||Object.hasOwn(a,'issuedAt')||Object.hasOwn(a,'deviceReceipt')||
      a.inputAttempted===true||['issued','captured','unknown','verified'].includes(a.status));
    if(potential.some(a=>a!==current)||potential.length>1)fail('MAYORS_CUP_POTENTIAL_INPUT_CAP_REACHED');
    if(Object.values(state.actions).some(a=>isUnresolvedAction(a)&&a!==current))fail('INPUT_UNRESOLVED');
    const forbidden=['inputReservedAt','issuedAt','deviceReceipt','deviceRejectionProof','resultFrameId','resultProof','resultCaptureNotBeforeAt',
      'effect','effects','actionResult','inventoryDeltas','inventoryInvalidated','capacityDelta','coinDelta','accounted','accountedAt','accountedRevision','receipt','receiptId'];
    if(revision){
      const second=priors[1],r=second.target?.management?.reallocation,old=r?.grant;
      validateMayorsCupGrant(r,{historical:true});
      if(r.grantHash!==grant.supersedesGrantHash||
          ['predecessorActionId','predecessorActionHash','sourceFrameId','sourceHash','preflightId','preflightHash'].some(k=>old[k]!==grant[k])||
          old.correctedGeometryHash!==mayorsCupBindingHash({box:second.target.box,verification:second.target.verification}))reject();
      // The superseded release/hash remain historical facts. Only the new
      // revision grant is bound to the currently loaded/adopted release below.
    }
    for(let i=0;i<priors.length;i++){
      const prior=priors[i],proof=proofs[i];
      if(prior.id!==proof.predecessorActionId||prior.status!=='rejected_before_input'||prior.error!=='NAVIGATION_TARGET_CHANGED'||prior.inputAttempted!==false||
          prior.management!==true||prior.target?.kind!=='claim_mayors_cup_reward'||prior.target.management.activationId!==MAYORS_CUP_ACTIVATION||
          prior.target.management.maxAttempts!==1||(i===0&&prior.target.management.reallocation!==undefined)||forbidden.some(k=>Object.hasOwn(prior,k))||
          mayorsCupBindingHash(prior)!==proof.predecessorActionHash||state.visits[prior.nextVisit?.visitId])reject();
    }
    const record=readContinuity(store),release=continuityRelease();
    if(grant.candidateRelease!==release||record.releaseId!==release||record.policyHash!==digest(Buffer.from(JSON.stringify(state.session.management)))||
        grant.correctedGeometryHash!==mayorsCupBindingHash(MAYORS_CUP_CLAIM_GEOMETRY))fail('MAYORS_CUP_REALLOCATION_RELEASE_CHANGED');
    const config=Object.fromEntries(['managementId','sourceRoot','sessionId','inventoryRoot','endCondition','policyHash','releaseId'].map(k=>[k,record[k]]));
    if(record.configHash!==digest(Buffer.from(JSON.stringify(config)))||!existsSync(join(record.inventoryRoot??'','inventory.json')))reject();
    // beginAction holds the source lock. beforeInput separately rechecks the
    // atomic saved inventory; normal inventory commits also require source lock.
    const inventory=readInventoryRecord(record.inventoryRoot,store.root,state);
    for(let i=0;i<priors.length;i++){
      const prior=priors[i],proof=proofs[i];
      if(inventory.effects.some(e=>e.actionId===prior.id)||inventory.operations.some(e=>e.actionId===prior.id)||
          Object.values(state.frames).some(f=>f.review?.data?.actionResult?.actionId===prior.id)||
          Object.values(state.transportMissions??{}).some(m=>m.waitingActionId===prior.id||m.receipts?.some(r=>r.actionId===prior.id)))reject();
      const source=store.evidence(prior.frameId),f=source.frame,p=prior.preflightEvidence;
      if(!p||f.id!==proof.sourceFrameId||f.evidenceHash!==proof.sourceHash||p.id!==proof.preflightId||p.evidenceHash!==proof.preflightHash||
          f.provider!==WINDOWS_PROVIDER||f.serial!==state.session.serial||f.packageName!==state.session.packageName||
          JSON.stringify(targetIdentity(f.captureTarget))!==JSON.stringify(targetIdentity(state.session.windowsTarget))||
          f.review?.status!=='accepted'||f.review.reviewedBy!=='GPT'||f.review.actualKind!=='mayors_cup_result'||
          digest(Buffer.from(JSON.stringify(f.review)))!==prior.rewardClaimSourceProof?.reviewHash||
          prior.rewardClaimSourceProof.bridgeHash!==state.session.windowsBridgeHash||prior.rewardClaimSourceProof.sessionId!==state.session.id||
          mayorsCupBindingHash(f.review.targets.find(t=>t.id===prior.targetId))!==mayorsCupBindingHash(prior.target)||
          prior.epoch!==f.epoch+1||prior.command.type!=='tap'||prior.command.x!==Math.floor(prior.target.box.x+prior.target.box.width/2)||
          prior.command.y!==Math.floor(prior.target.box.y+prior.target.box.height/2))reject();
      const request={actionId:prior.id,frameId:prior.frameId,targetId:prior.targetId,nextVisit:prior.nextVisit,swipe:null,management:true};
      if(prior.requestDigest!==digest(Buffer.from(JSON.stringify(request))))reject();
      rejectedPreflight(store,prior,f);compareWindowsGeometry(f,p);
      const preflight=decodePng(readFileSync(join(store.root,'preflight',p.id+'.png')));
      let changed=false;try{compareReviewedTarget(source.image,preflight,prior.target,{management:true});}
      catch(e){if(e.message!=='NAVIGATION_TARGET_CHANGED')throw e;changed=true;}
      if(!changed)reject();
      // Prove the specific correction on the preserved failed pair, without a
      // new capture, threshold relaxation, input, or modification of the prior.
      compareReviewedTarget(source.image,preflight,{...prior.target,...MAYORS_CUP_CLAIM_GEOMETRY},{management:true});
    }
    return {grantHash:target.management.reallocation.grantHash,predecessorActionHash:grant.predecessorActionHash};
}

export function mayorsCupClaimResult(store,state,action,frame,{historical=false}={}){
    // This proves only that the first-claim UI finished into an unobscured town.
    // Reward contents, quantities and accounting remain explicitly unresolved.
    const r=frame.review,opening=['open_result','claim_result','continue_result','complete_result'].includes(r?.proof?.role),nextStage=r?.data?.mayorsCupOcr?.stage;
    const facts=opening?r.data?.mayorsCupOcr:r?.data?.mayorsCupClaimResult;
    if(!opening&&(r?.actualKind!=='town'||!facts))return null;
    if(opening){
      validateProgramMayorsCupProof(frame,store.evidence(frame.id).image);
      if(action.target?.kind!=='claim_mayors_cup_reward'||nextStage===cupActionStage(action)||r.targets.length)fail('CUP_RESULT_STAGE_MISMATCH');
      if(nextStage==='complete'&&cupActionStage(action)!=='claim')fail('CUP_FINAL_CLAIM_REQUIRED');
    }
    if(historical&&(!opening||!state.stopCapture||!state.stopReader))fail('CUP_HISTORICAL_SETTLEMENT_ONLY');
    const reject=()=>fail('MAYORS_CUP_TOWN_RESULT_REQUIRED'),source=state.frames[action.frameId],p=action.preflightEvidence,d=action.deviceReceipt;
    const keys=['actionId','frameId','evidenceHash','epoch','sourceFrameId','sourceHash','townHudVisible','claimPanelAbsent','rewardOverlayAbsent'];
    if(!opening&&(r.reviewedBy!=='GPT'||r.actualEntityId!==null||r.quality?.gameVisible!==true||r.quality.occluded!==false||r.targets.length||
        Object.keys(r.data).length!==1||Object.keys(facts).length!==keys.length||Object.keys(facts).some(k=>!keys.includes(k))||
        facts.townHudVisible!==true||facts.claimPanelAbsent!==true||facts.rewardOverlayAbsent!==true||
        facts.actionId!==action.id||facts.frameId!==frame.id||facts.evidenceHash!==frame.evidenceHash||facts.epoch!==frame.epoch||
        facts.sourceFrameId!==source?.id||facts.sourceHash!==source?.evidenceHash))reject();
    if(frame.evidenceHash===source?.evidenceHash||
        state.input!==action.id||!['issued','captured'].includes(action.status)||action.management!==true||
        frame.id!==state.latestFrameId||frame.sceneId!==action.nextVisit.visitId||frame.epoch!==action.epoch||frame.epoch!==state.scene.epoch||
        source.epoch+1!==action.epoch||frame.sequence<=source.sequence||action.target.management.activationId!==MAYORS_CUP_ACTIVATION||
        JSON.stringify(source.review?.targets?.find(t=>t.id===action.targetId))!==JSON.stringify(action.target)||
        action.rewardClaimSourceProof?.reviewHash!==digest(Buffer.from(JSON.stringify(source.review)))||
        action.rewardClaimSourceProof?.bridgeHash!==state.session.windowsBridgeHash||
        action.rewardClaimSourceProof?.sessionId!==state.session.id||
        Object.values(state.actions).filter(isUnresolvedAction).length!==1)reject();
    const now=store.clock(),started=Date.parse(frame.captureStartedAt),observed=Date.parse(frame.observedAt),due=resultCaptureDueAt(action);
    if(!Number.isFinite(started)||!Number.isFinite(observed)||started>observed||observed>now||due===null||started<due||
      (!historical&&(now-observed>120000||!inputEvidenceValid(frame,now,state))))reject();
    if(!p||!id(p.id)||p.actionId!==action.id||p.sourceFrameId!==source.id||p.epoch!==action.epoch||p.provider!==WINDOWS_PROVIDER||
        !d||d.actionId!==action.id||d.status!=='issued'||d.commandIssued!==true||d.gameResultVerified!==false||d.error!==null||
        !Number.isSafeInteger(d.attempted)||d.attempted<=0||d.inserted!==d.attempted||action.inputAttempted!==true||
        !Number.isFinite(Date.parse(d.startedAt))||!Number.isFinite(Date.parse(d.completedAt))||Date.parse(d.startedAt)>Date.parse(d.completedAt)||
        !Number.isFinite(Date.parse(p.observedAt))||!Number.isFinite(Date.parse(action.issuedAt))||
        Date.parse(d.completedAt)>Date.parse(action.issuedAt)||Date.parse(p.observedAt)>Date.parse(d.startedAt)||
        action.command.type!=='tap'||action.command.x!==Math.floor(action.target.box.x+action.target.box.width/2)||action.command.y!==Math.floor(action.target.box.y+action.target.box.height/2))reject();
    if(frame.provider!==WINDOWS_PROVIDER||frame.serial!==source.serial||frame.packageName!==source.packageName||
        JSON.stringify(targetIdentity(frame.captureTarget))!==JSON.stringify(targetIdentity(state.session.windowsTarget)))reject();
    compareWindowsGeometry(source,frame);compareWindowsGeometry(source,p);store.evidence(source.id);store.evidence(frame.id);
    const dir=realpathSync(join(store.root,'preflight')),file=realpathSync(join(dir,p.id+'.png')),rel=relative(dir,file);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||digest(readFileSync(file))!==p.evidenceHash)reject();
    return {schema:1,kind:opening?(nextStage==='complete'?'mayors_cup_completed':'mayors_cup_'+nextStage+'_ready'):'mayors_cup_first_claim_dismissed',activationId:MAYORS_CUP_ACTIVATION,actionId:action.id,
      sourceFrameId:source.id,sourceHash:source.evidenceHash,frameId:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch,
      preflightHash:p.evidenceHash,receiptHash:digest(Buffer.from(JSON.stringify(d))),facts:clone(facts),rewardAccounting:opening&&action.target?.management?.source==='mayors_cup_first_claim'?'not_opened':'unresolved'};
}

export function mayorsCupResultProof(store,state,frame,review){
    // Limited observation-only maintenance: no worker, input, reward claim,
    // stop changes, release adoption or unknown-action recovery is performed.
    const failResult=()=>fail('MAYORS_CUP_RESULT_EVIDENCE_REQUIRED');
    if(state.stopCapture!==true||state.stopReader!==true||
        ['capture.lock','helicopter-runner.lock','.management/runner.lock'].some(p=>existsSync(join(store.root,p))))fail('MAYORS_CUP_MAINTENANCE_BOUNDARY_REQUIRED');
    assertOrderStartupComplete(state);
    if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
        Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))fail('MAYORS_CUP_MAINTENANCE_BOUNDARY_REQUIRED');
    const unresolved=Object.values(state.actions??{}).filter(isUnresolvedAction);
    const action=state.actions[state.input],source=state.frames[action?.frameId],facts=review.data?.mayorsCupResult;
    if(unresolved.length!==1||unresolved[0]!==action||action?.id!==state.input||!['issued','captured'].includes(action.status)||action.management!==false||action.lifecycle||
        action.target?.kind!=='close_panel'||action.target.transportNavigation||action.target.helicopterSelection||action.command?.type!=='tap'||
        action.nextVisit?.kind!=='town'||!source||source.review?.status!=='accepted'||source.review.actualKind!=='helicopter')failResult();
    if(review.reviewedBy!=='GPT'||review.actualKind!=='mayors_cup_result'||review.actualEntityId!==null||
        review.quality?.gameVisible!==true||review.quality.occluded!==false||!Array.isArray(review.targets)||review.targets.length||
        Object.keys(review.data??{}).length!==1||!facts||facts.title!=="MAYOR'S CUP"||facts.status!=='Finished'||facts.rank!==2||facts.claimText!=='CLAIM'||facts.claimVisible!==true)failResult();
    const factKeys=['title','status','rank','claimText','claimVisible','actionId','frameId','evidenceHash','epoch','sourceFrameId','sourceHash'];
    if(Object.keys(facts).length!==factKeys.length||Object.keys(facts).some(k=>!factKeys.includes(k)))failResult();
    if(!frame||state.latestFrameId!==frame.id||frame.kind!=='town'||frame.sceneId!==action.nextVisit.visitId||state.scene.id!==frame.sceneId||state.scene.kind!=='town'||
        frame.epoch!==state.scene.epoch||frame.epoch!==action.epoch||source.epoch+1!==action.epoch||frame.sequence<=source.sequence||
        facts.actionId!==action.id||facts.frameId!==frame.id||facts.evidenceHash!==frame.evidenceHash||facts.epoch!==frame.epoch||
        facts.sourceFrameId!==source.id||facts.sourceHash!==source.evidenceHash)failResult();
    const now=store.clock(),observed=Date.parse(frame.observedAt),started=Date.parse(frame.captureStartedAt),due=resultCaptureDueAt(action);
    // This explicitly bounded maintenance result cannot extend freshness with
    // untilChange metadata. The original capture clock is never rewritten.
    if(!Number.isFinite(observed)||!Number.isFinite(started)||started>observed||observed>now||now-observed>120000||
        due===null||started<due||!inputEvidenceValid(frame,now,state))failResult();
    const receipt=action.deviceReceipt,p=action.preflightEvidence;
    if(!receipt||receipt.actionId!==action.id||receipt.status!=='issued'||receipt.commandIssued!==true||receipt.gameResultVerified!==false||
        receipt.error!==null||!Number.isSafeInteger(receipt.attempted)||receipt.attempted<=0||receipt.inserted!==receipt.attempted||
        action.inputAttempted!==true||!Number.isFinite(Date.parse(receipt.completedAt))||Date.parse(receipt.completedAt)>Date.parse(action.issuedAt)||
        !p||!id(p.id)||p.actionId!==action.id||p.sourceFrameId!==source.id||p.epoch!==action.epoch||p.provider!==WINDOWS_PROVIDER)failResult();
    if(!Number.isFinite(Date.parse(receipt.startedAt))||Date.parse(receipt.startedAt)>Date.parse(receipt.completedAt)||
        !Number.isFinite(Date.parse(p.observedAt))||Date.parse(p.observedAt)>Date.parse(receipt.startedAt)||
        JSON.stringify(source.review.targets?.find(t=>t.id===action.targetId))!==JSON.stringify(action.target)||
        action.command.x!==Math.floor(action.target.box.x+action.target.box.width/2)||action.command.y!==Math.floor(action.target.box.y+action.target.box.height/2))failResult();
    if(frame.provider!==WINDOWS_PROVIDER||source.provider!==WINDOWS_PROVIDER||state.session.provider!==WINDOWS_PROVIDER||
        frame.serial!==state.session.serial||source.serial!==frame.serial||frame.packageName!==source.packageName||frame.packageName!==state.session.packageName||
        JSON.stringify(targetIdentity(frame.captureTarget))!==JSON.stringify(targetIdentity(state.session.windowsTarget))||
        frame.width!==1578||frame.height!==1268||source.width!==frame.width||source.height!==frame.height||p.width!==frame.width||p.height!==frame.height)failResult();
    compareWindowsGeometry(source,frame);compareWindowsGeometry(source,p);
    store.evidence(source.id);store.evidence(frame.id);
    const preflightRoot=realpathSync(join(store.root,'preflight')),file=realpathSync(join(preflightRoot,p.id+'.png')),rel=relative(preflightRoot,file);
    if(!rel||rel.startsWith('..')||isAbsolute(rel)||digest(readFileSync(file))!==p.evidenceHash)failResult();
    return {schema:1,kind:'mayors_cup_result',sessionId:state.session.id,bridgeHash:state.session.windowsBridgeHash,actionId:action.id,sourceFrameId:source.id,sourceHash:source.evidenceHash,
      actionBindingHash:digest(Buffer.from(JSON.stringify({frameId:action.frameId,target:action.target,command:action.command,nextVisit:action.nextVisit,epoch:action.epoch,issuedAt:action.issuedAt}))),
      preflightId:p.id,preflightHash:p.evidenceHash,receiptHash:digest(Buffer.from(JSON.stringify(receipt))),
      frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,
      captureStartedAt:frame.captureStartedAt,observedAt:frame.observedAt,facts:clone(facts),rewardClaimed:false};
}
