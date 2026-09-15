/* Consignments remain in this worker. This worker never sends them over a network. */
importScripts('./rgb_engine.js');
const ready=wasm_bindgen('./rgb_engine_bg.wasm');
self.onmessage=async event=>{try{await ready;self.postMessage(JSON.parse(wasm_bindgen.validate_rgb(JSON.stringify(event.data))));}catch{self.postMessage({status:'unresolved',reason:'The isolated RGB engine could not complete validation.'});}};
