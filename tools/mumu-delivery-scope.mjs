// Session preference, separate from management authorization and input ownership.
export const helicopterOnly = state => state.settings?.helicopterOnly === true;
export const transportEnabled = (state, kind) => !helicopterOnly(state) || kind === 'helicopter';
export const deliveryScopeCutoff = state => state.settings?.deliveryScopeAfterSequence ?? -1;
