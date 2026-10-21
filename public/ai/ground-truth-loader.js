import {selectGroundTruthRecord} from './ground-truth.js'

// Only the filename goes to the existing label API. X-ray bytes are never sent.
export async function fetchSavedGroundTruth(filename,readLabel,listMeta){
  const exact=await readLabel(filename)
  if(exact.exists)return {...exact,filename:exact.filename||filename}
  const match=selectGroundTruthRecord(await listMeta(),filename)
  if(!match)return null
  const saved=await readLabel(match.filename??match.file_name)
  return saved.exists?{...saved,filename:saved.filename??match.filename??match.file_name}:null
}

// A slow request for the previous image must never replace the current GT.
export function createGroundTruthLoader(readLabel,listMeta,onState){
  let generation=0
  return {
    clear(){generation++;onState({status:'idle',data:null,error:null})},
    async load(filename){
      const request=++generation;onState({status:'loading',data:null,error:null})
      try{
        const data=await fetchSavedGroundTruth(filename,readLabel,listMeta)
        if(request===generation)onState({status:data?'found':'missing',data,error:null})
      }catch(error){if(request===generation)onState({status:'error',data:null,error:error.message})}
    }
  }
}
