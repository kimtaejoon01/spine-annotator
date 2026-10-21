// Restore only when the user has not selected a different model in the meantime.
export async function restoreSavedModels({readSaved,onSaved,canRestore,select,load,onMissing,onError}){
  try{
    const files=await readSaved()
    onSaved(files?.length?files:null)
    if(!canRestore())return 'manual'
    if(!files?.length){onMissing();return 'missing'}
    const selected=await select(files)
    if(!canRestore())return 'manual'
    if(!selected){onMissing();return 'invalid'}
    return await load()?'ready':'failed'
  }catch(error){
    if(canRestore())onError(error)
    return 'failed'
  }
}
