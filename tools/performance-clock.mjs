export async function installCanvasClock(page){
 await page.evaluateOnNewDocument(()=>{
  window.__firstCanvasFrame=new Promise(resolve=>{
   let scheduled=false,frame=0,finished=false
   const check=()=>{
    frame=0
    if(finished)return
    const canvas=document.querySelector('.heat-canvas'),root=document.getElementById('root')
    if(canvas?.dataset.layoutReady==='true'&&canvas.querySelector('.heat-card')&&root&&Number(getComputedStyle(root).opacity)===1){
     if(!scheduled){scheduled=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{finished=true;observer.disconnect();document.removeEventListener('transitionend',schedule,true);resolve(performance.now())}))}
    }
   }
   const schedule=()=>{if(!frame&&!finished)frame=requestAnimationFrame(check)}
   const observer=new MutationObserver(schedule)
   observer.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-startup','data-layout-ready']})
   document.addEventListener('transitionend',schedule,true)
   schedule()
  })
 })
}
export const canvasFrameTime=page=>page.evaluate(async()=>Math.round(await window.__firstCanvasFrame))
