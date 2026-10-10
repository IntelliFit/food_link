'use strict';
const $ = id => document.getElementById(id);
let config, file, previewURL, controller, clock, startTime, batch, running = false;
const statusNames = {answered:'已回答',upstream_notice:'上游提示',timeout:'超时',cancelled:'已停止',http_error:'上游报错',network_error:'网络失败',not_configured:'未配置',truncated:'输出截断',no_content:'无有效回答',invalid_envelope:'响应格式异常',request_error:'请求异常',response_too_large:'响应过大'};
function node(tag, text, cls) { const n=document.createElement(tag); if(text !== undefined) n.textContent=text; if(cls) n.className=cls; return n; }
function notice(text,error=false) { $('notice').textContent=text; $('notice').classList.toggle('error',error); }
function seconds(ms) { return ms == null ? '—' : (ms/1000).toFixed(1)+'s'; }
function detail(label,text,parent) { const d=node('details'); d.append(node('summary',label),node('pre',text)); parent.append(d); }
function providerSub(provider) { return provider.model+' · '+(provider.routing==='success_rate'?'成功率优先':'渠道默认路由')+' · 无回退'; }
function card(provider) {
  const el=node('article',undefined,'card'); el.id='card-'+provider.id;
  const head=node('div',undefined,'card-head'); head.append(node('h2',provider.name),node('span',provider.configured?'就绪':'未配置','badge'));
  el.append(head,node('div',providerSub(provider),'sub'),node('div','等待你提交问题或图片','idle'));
  return el;
}
function renderResult(result) {
  const el=$('card-'+result.provider);
  if(!el) throw new Error('收到未知对比栏的结果');
  el.replaceChildren();
  const provider=config.providers.find(p=>p.id===result.provider);
  const head=node('div',undefined,'card-head'); head.append(node('h2',provider.name),node('span',statusNames[result.status]||result.status,'badge '+(result.status==='answered'?'ok':'bad'))); el.append(head);
  el.append(node('div','请求 '+result.requested_model+' / 返回 '+(result.returned_model||'渠道未提供'),'sub'));
  const metrics=node('div',undefined,'metrics');
  for(const [label,value] of [['发送完成',result.timings.sent_ms],['首响应',result.timings.first_byte_ms],['总耗时',result.timings.total_ms]]) { const m=node('div',undefined,'metric'); m.append(node('span',label),node('strong',seconds(value))); metrics.append(m); }
  el.append(metrics);
  if(result.error) el.append(node('div',result.error,'failure'));
  if(result.text) el.append(node('pre',result.text,'answer'));
  detail('完整 API 响应',result.raw_response||'没有收到响应体',el);
  detail('实际请求格式（不含 Key / 图片内容）',JSON.stringify(result.request_preview||{},null,2),el);
  if(result.usage) detail('渠道自报用量',JSON.stringify(result.usage,null,2),el);
  el.append(node('div',(result.protocol==='native'?'Gemini原生':'OpenAI兼容')+' · HTTP '+(result.http_status||'未返回')+' · '+result.endpoint,'endpoint'));
}
function refreshSubmit() { $('repeat').disabled=!config||running||(!file&&!$('prompt').value.trim()); }
function setBusy(value) {
  running=value;
  for(const id of ['image','clear-image','prompt','protocol','original-path']) $(id).disabled=value||!config;
  $('cancel').disabled=!value; refreshSubmit();
}
async function run() {
  if(running||!config) return;
  if(!file&&!$('prompt').value.trim()) {notice('请填写问题或选择一张图片。',true);return;}
  setBusy(true); controller=new AbortController(); startTime=performance.now();
  batch={results:[],prompt:$('prompt').value,protocol:$('protocol').value,original_path_note:$('original-path').value.slice(0,1000)};
  $('export').disabled=true;
  for(const p of config.providers) { const el=$('card-'+p.id); el.replaceChildren(); const head=node('div',undefined,'card-head'); head.append(node('h2',p.name),node('span',p.model,'badge')); el.append(head,node('div',providerSub(p),'sub'),node('div',undefined,'spinner'),node('div','0.0s','clock')); }
  notice('');
  clock=setInterval(()=>document.querySelectorAll('.clock').forEach(el=>el.textContent=seconds(performance.now()-startTime)),100);
  try {
    const form=new FormData(); if(file)form.append('image',file); form.append('prompt',batch.prompt); form.append('protocol',batch.protocol); form.append('original_path',batch.original_path_note);
    const response=await fetch('/api/compare',{method:'POST',headers:{'X-Compare-Token':config.token},body:form,signal:controller.signal});
    if(!response.ok) throw new Error(await response.text());
    const reader=response.body.getReader(),decoder=new TextDecoder(); let pending='',doneEvent=false;
    function readLine(line) {
      if(!line.trim())return; const event=JSON.parse(line);
      if(event.type==='start') Object.assign(batch,event);
      if(event.type==='result') { batch.results.push(event.result); renderResult(event.result); }
      if(event.type==='done') doneEvent=true;
    }
    while(true) { const {value,done}=await reader.read(); if(done)break; pending+=decoder.decode(value,{stream:true}); let index; while((index=pending.indexOf('\n'))>=0) {readLine(pending.slice(0,index));pending=pending.slice(index+1);} }
    pending+=decoder.decode(); if(pending.trim())readLine(pending);
    if(!doneEvent||batch.results.length!==config.providers.length)throw new Error('连接提前结束，已收到的结果保留。');
    notice('本次完成。答案保持原样，你可以修改问题、换图或导出结果。');
  } catch(error) {
    const cancelled=error.name==='AbortError'; batch.incomplete=true;
    notice(cancelled?'本次已停止，已收到的结果保留。请求已发送时仍可能产生费用。':String(error.message),!cancelled);
    for(const p of config.providers) { const el=$('card-'+p.id); if(el.querySelector('.spinner')) {el.querySelector('.spinner').remove(); el.querySelector('.clock').textContent=cancelled?'已停止':'本次未完成';} }
  } finally {
    clearInterval(clock); controller=null; setBusy(false); $('export').disabled=!batch.results.length;
  }
}
function clearImage() {
  if(running)return;
  file=undefined; if(previewURL)URL.revokeObjectURL(previewURL); previewURL=undefined;
  $('image').value=''; $('preview').removeAttribute('src'); $('preview').hidden=true; $('empty').hidden=false; $('image-info').textContent=''; $('clear-image').hidden=true;
  refreshSubmit(); notice('已移除图片，可以只比较文字问题。');
}
function choose(candidate) {
  if(!config) {notice('服务尚未就绪，请稍后选择图片。',true);return;}
  if(running) {notice('先停止或等待本次完成，再换图。',true);return;}
  if(!candidate)return;
  if(!['image/jpeg','image/png','image/webp'].includes(candidate.type)||candidate.size>config.max_bytes||!candidate.size) {notice('请选择8MiB以内的JPEG、PNG或WebP图片。',true);$('image').value='';return;}
  file=candidate; if(previewURL)URL.revokeObjectURL(previewURL); previewURL=URL.createObjectURL(file); $('preview').src=previewURL; $('preview').hidden=false; $('empty').hidden=true; $('clear-image').hidden=false;
  $('image-info').textContent=file.name+' · '+(file.size/(1024*1024)).toFixed(2)+' MiB · 原始字节'; refreshSubmit(); notice('图片已选好。问题由你填写，点“开始对比”才发送。');
}
$('image').addEventListener('change',event=>choose(event.target.files[0])); $('repeat').addEventListener('click',run); $('cancel').addEventListener('click',()=>controller?.abort()); $('clear-image').addEventListener('click',clearImage); $('prompt').addEventListener('input',refreshSubmit);
$('drop').addEventListener('dragover',event=>{event.preventDefault();if(!running)$('drop').classList.add('drag');}); $('drop').addEventListener('dragleave',()=>$('drop').classList.remove('drag'));
$('drop').addEventListener('drop',event=>{event.preventDefault();$('drop').classList.remove('drag');if(event.dataTransfer.files.length!==1){notice('每次拖入一张图片。',true);return;}choose(event.dataTransfer.files[0]);});
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(batch,null,2)],{type:'application/json'})); const a=node('a'); a.href=url; a.download='六路对比-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('beforeunload',()=>{controller?.abort();if(previewURL)URL.revokeObjectURL(previewURL);});
(async()=>{try{const response=await fetch('/api/config');if(!response.ok)throw new Error('连接独立对比服务失败');config=await response.json();config.providers.forEach(p=>$('results').append(card(p)));setBusy(false);}catch(error){notice(String(error.message),true);$('image').disabled=true;}})();
