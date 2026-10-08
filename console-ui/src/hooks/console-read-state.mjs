export function createReadState(data) { return { data, loaded: false, loading: false, error: null }; }
export function pendingRead(state) { return { ...state, loading: true, error: null }; }
export function successfulRead(data) { return { data, loaded: true, loading: false, error: null }; }
export function failedRead(state, error) { return { ...state, loading: false, error }; }
