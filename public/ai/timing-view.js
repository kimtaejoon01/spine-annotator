const STAGES=[
  ['분할 + watershed','segmentation_seconds'],
  ['척추 번호','numbering_seconds'],
  ['꼭지점 v1/v2','corners_seconds'],
  ['S1 종판','s1_seconds'],
  ['대퇴골두','femoral_seconds'],
  ['전체 분석','total_seconds'],
]
export function renderTimings(container,timings){
  container.replaceChildren()
  container.hidden=!timings
  if(!timings)return
  const title=document.createElement('h3'),row=document.createElement('div')
  title.textContent='전체 분석 단계별 소요 시간'
  row.className='timing-grid'
  for(const [label,key] of STAGES){
    const item=document.createElement('div'),name=document.createElement('span'),value=document.createElement('strong')
    name.textContent=label
    const seconds=timings[key]
    value.textContent=Number.isFinite(seconds)&&seconds>=0?seconds.toFixed(2)+'초':'—'
    item.append(name,value);row.append(item)
  }
  container.append(title,row)
}
