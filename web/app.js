"use strict";
const $ = (id) => document.getElementById(id);
const state = { images: [], image: null, bitmap: null, runs: [], a: null, b: null, plan: null,
  job: null, threshold: .25, iou: .5, comparison: null, selected: null, busy: false, overlay: false, comparisonSequence: 0 };
const escapeHTML = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const number = (v, digits = 2) => v == null ? "—" : Number(v).toFixed(digits);
const sourceNames = {inference: "本机真实推理", recorded_inference: "样例 · 真实推理记录", imported: "外部导入"};
let toastTimer, pollTimer, jsonAction = "import";

function toast(message) {
  $("toast").textContent = message; $("toast").classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 5500);
}
async function api(path, data) {
  const response = await fetch(`/api${path}`, data === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json", "X-PromptScope": "1"}, body: JSON.stringify(data)
  });
  const body = await response.json().catch(() => ({detail: "服务器返回无效响应"}));
  if (!response.ok) throw new Error(Array.isArray(body.detail) ? body.detail.map(x => x.msg).join("; ") : body.detail || "请求失败");
  return body;
}
function guarded(fn) { return async (...args) => { try { await fn(...args); } catch (e) { toast(e.message); } }; }
function modal(title, html) { $("modalTitle").textContent = title; $("modalBody").innerHTML = html; $("modal").showModal(); }
function showTab(tab) {
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("hidden", el.id !== tab));
  document.querySelectorAll(".nav").forEach(el => el.classList.toggle("active", el.dataset.tab === tab));
  $("pageName").textContent = {workbench: "实验工作台", history: "实验记录", guide: "使用与方法"}[tab];
  if (tab === "history") loadHistory().catch(e => toast(e.message));
  if (tab === "workbench") drawAll();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function refreshImages() {
  state.images = await api("/images");
  $("imageList").innerHTML = state.images.map(img => `<button class="image-item ${state.image?.id === img.id ? "active" : ""}" data-image="${img.id}" title="${escapeHTML(img.name)}" aria-label="选择图片 ${escapeHTML(img.name)}"><img src="/api/images/${img.id}/file" alt="" width="42" height="42"><span>${escapeHTML(img.name)}</span></button>`).join("");
}
let imageSequence = 0;
async function selectImage(id) {
  const sequence = ++imageSequence;
  const meta = state.images.find(x => x.id === id);
  if (!meta) return;
  const image = new Image();
  image.src = `/api/images/${id}/file`;
  await image.decode();
  if (sequence !== imageSequence) return;
  state.image = meta; state.bitmap = image; state.selected = null;
  $("sceneTitle").textContent = meta.name.replace(/\.[a-z]+$/i, "");
  $("imageMeta").textContent = `${meta.width} × ${meta.height} px`;
  document.querySelectorAll(".image-item").forEach(el => el.classList.toggle("active", el.dataset.image === id));
  try { localStorage.setItem("promptscope.image", id); } catch (_) { /* optional preference */ }
  await refreshRuns();
}
async function refreshRuns(preferredIds) {
  if (!state.image) return drawAll();
  const imageId = state.image.id;
  const runs = await api(`/runs?image_id=${imageId}`);
  if (imageId !== state.image?.id) return;
  state.runs = runs;
  const oldA = state.a?.id, oldB = state.b?.id;
  state.a = runs.find(r => r.id === (preferredIds?.[0] || oldA)) || runs.at(-1) || null;
  state.b = runs.find(r => r.id === (preferredIds?.[1] || oldB)) || runs[0] || null;
  for (const side of ["A", "B"]) {
    const select = $("run" + side);
    select.innerHTML = runs.length ? runs.map((r, i) => `<option value="${r.id}">${escapeHTML(r.prompt)} · ${escapeHTML(r.model)} #${runs.length-i}</option>`).join("") : "<option>还没有检测结果</option>";
    if (state[side.toLowerCase()]) select.value = state[side.toLowerCase()].id;
  }
  renderResults(); await updateComparison();
}
function visible(run) { return (run?.detections || []).filter(d => d.score >= state.threshold); }
function drawAll() { draw("A"); draw("B"); }
function draw(side, canvas = $("canvas" + side), exportMode = false) {
  const run = state[side.toLowerCase()];
  let detections = visible(run).map((d,index)=>({d,index,origin:side}));
  if (side === "A" && state.overlay) detections.push(...visible(state.b).map((d,index)=>({d,index,origin:"B"})));
  const rect = canvas.getBoundingClientRect();
  const w = exportMode ? state.image.width : Math.max(1, rect.width);
  const h = exportMode ? state.image.height : Math.max(1, rect.height);
  const ratio = exportMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--canvas").trim();
  ctx.fillRect(0, 0, w, h);
  if (!exportMode) $("empty" + side).classList.toggle("hidden", !!state.bitmap);
  if (!state.bitmap) return;
  const scale = Math.min(w / state.bitmap.width, h / state.bitmap.height) * (exportMode ? 1 : .92);
  const iw = state.bitmap.width * scale, ih = state.bitmap.height * scale;
  const ox = (w - iw) / 2, oy = (h - ih) / 2;
  canvas.dataset.projection = JSON.stringify({ox, oy, iw, ih});
  ctx.drawImage(state.bitmap, ox, oy, iw, ih);
  detections.forEach(({d,index,origin}) => {
    const [x1, y1, x2, y2] = d.box;
    const x = ox+x1*iw, y = oy+y1*ih, bw = (x2-x1)*iw, bh = (y2-y1)*ih;
    const selected = state.selected?.side === origin && state.selected.index === index;
    const color = origin === "A" ? "#75dae4" : "#f4bd82";
    ctx.strokeStyle = color; ctx.lineWidth = selected ? 3.5 : 1.7;
    ctx.shadowColor = "#0005"; ctx.shadowBlur = 2;
    ctx.setLineDash(state.overlay && origin === "B" ? [5,3] : []);
    ctx.strokeRect(x, y, bw, bh); ctx.shadowBlur = 0; ctx.setLineDash([]);
    if (selected) { ctx.fillStyle = origin === "A" ? "#75dae41c" : "#f4bd821c"; ctx.fillRect(x,y,bw,bh); }
    if ($("showLabels").checked) {
      const font = exportMode ? Math.max(12, w/45) : 11;
      ctx.font = `600 ${font}px 'Segoe UI', sans-serif`;
      let label = `${state.overlay ? origin+" / " : ""}${d.label}  ${d.score.toFixed(2)}`;
      const maxWidth = Math.max(24, w-14);
      while (ctx.measureText(label).width+12 > maxWidth && label.length > 3) label = label.slice(0,-4)+"…";
      const width = ctx.measureText(label).width+12, height = font+9;
      const tx = Math.min(w-width, Math.max(0,x)), ty = Math.max(0,Math.min(h-height,state.overlay && origin === "B" ? y+2 : y-height));
      ctx.fillStyle = color; ctx.fillRect(tx,ty,width,height);
      ctx.fillStyle = "#182126"; ctx.fillText(label,tx+6,ty+font+2);
    }
  });
}
function renderResults() {
  drawAll();
  let rows = "";
  for (const side of ["A","B"]) {
    const run = state[side.toLowerCase()], ds = visible(run);
    $("count"+side).textContent = `${ds.length} boxes`;
    $("source"+side).textContent = run ? `${sourceNames[run.source] || run.source} · ${run.elapsed_ms == null ? "未记录耗时" : (run.elapsed_ms/1000).toFixed(1)+"s"}` : "等待实验";
    rows += ds.map((d,i) => `<tr data-side="${side}" data-index="${i}" class="${state.selected?.side === side && state.selected.index === i ? "selected" : ""}"><td><span class="letter ${side.toLowerCase()}">${side}</span></td><td><button class="detection-button" aria-label="检查 ${side} ${escapeHTML(d.label)} ${i+1}">${escapeHTML(d.label)}</button></td><td>${d.score.toFixed(3)}<span class="score-bar"><i style="width:${d.score*100}%"></i></span></td><td>${d.box.map(x => x.toFixed(3)).join(" · ")}</td></tr>`).join("");
  }
  $("detections").innerHTML = rows || '<tr><td colspan="4" class="empty-state">当前阈值下没有检测框。可降低阈值，或尝试新的提示词。</td></tr>';
  $("detectionTotal").textContent = visible(state.a).length + visible(state.b).length;
}
async function updateComparison() {
  const sequence = ++state.comparisonSequence;
  if (!state.a || !state.b) {
    state.comparison = null;
    for (const id of ["matched","onlyA","onlyB","meanScores"]) $(id).textContent = "—";
    return;
  }
  const result = await api("/compare", {run_a:state.a.id,run_b:state.b.id,threshold:state.threshold,iou_threshold:state.iou});
  if (sequence !== state.comparisonSequence) return;
  state.comparison = result;
  $("matched").textContent = result.matched;
  $("onlyA").textContent = result.only_a.length;
  $("onlyB").textContent = result.only_b.length;
  $("meanScores").textContent = `${number(result.mean_score_a)} / ${number(result.mean_score_b)}`;
}
function chooseDetection(side,index) {
  const d = visible(state[side.toLowerCase()])[index]; if (!d) return;
  state.selected = {side,index};
  $("inspection").textContent = `${side} / ${d.label} · score ${d.score.toFixed(4)} · xyxy [${d.box.map(x=>x.toFixed(4)).join(", ")}]`;
  renderResults();
}
async function uploadFile(file) {
  if (!file) return;
  if (file.size > 8*1024*1024) throw new Error("请选择不超过 8 MiB 的图片。");
  const data = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror=reject; reader.readAsDataURL(file);
  });
  const image = await api("/images", {name:file.name,data});
  await refreshImages(); await selectImage(image.id); toast("图片已保存到本机。");
}
function requestConfig() {
  if (!state.image) throw new Error("请先上传图片或加载样例。");
  const prompts = $("prompts").value.split("\n").map(x=>x.trim()).filter(Boolean);
  if (!prompts.length || prompts.length > 6) throw new Error("请输入 1–6 行提示词，每行一组实验。");
  const textThreshold = Number($("textThreshold").value);
  if (!Number.isFinite(textThreshold) || textThreshold < .05 || textThreshold > .9) throw new Error("文本阈值范围是 0.05–0.90。");
  return {image_id:state.image.id,prompts,model:$("model").value,text_threshold:textThreshold};
}
function setBusy(busy) {
  state.busy = busy; $("run").disabled = busy;
  const execute = $("executePlan"); if (execute) execute.disabled = busy;
  $("run").innerHTML = busy ? "实验运行中…" : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 8 5-8 5z"/></svg>运行检测';
  $("cancel").classList.toggle("hidden", !busy);
}
async function submitJob(planId) {
  if (state.busy) return toast("请等待当前实验完成。");
  const config = requestConfig();
  setBusy(true);
  try {
    state.job = await api(planId ? `/agent/execute/${planId}` : "/jobs",config);
    await pollJob();
  } catch (e) { setBusy(false); throw e; }
}
function renderJob(job) {
  $("jobBadge").textContent = job.status.toUpperCase();
  $("jobBadge").className = "badge " + (job.status === "failed" ? "failed" : ["running","queued"].includes(job.status) ? "working" : "neutral");
  $("jobStatus").textContent = job.message;
  $("trace").innerHTML = job.events.map(e => `<div class="trace-event"><b>${escapeHTML(e.stage)}</b><p>${escapeHTML(e.message)}</p></div>`).join("");
  if (job.report) {
    $("trace").innerHTML += `<div class="report-text"><b>${job.report.source === "llm" ? "LLM 分析 · 请复核" : "规则报告"}</b><p>${escapeHTML(job.report.summary)}</p><p>${escapeHTML(job.report.next_step)}</p>${job.report.llm_error ? `<p>LLM 报告未生成：${escapeHTML(job.report.llm_error)}</p>` : ""}</div>`;
  }
}
async function pollJob() {
  clearTimeout(pollTimer);
  if (!state.job) return;
  try {
    const job = await api(`/jobs/${state.job.id}`); state.job = job; renderJob(job);
    if (["queued","running"].includes(job.status)) {
      setBusy(true); pollTimer = setTimeout(pollJob,1600);
    } else {
      setBusy(false);
      if (job.request.image_id === state.image?.id) await refreshRuns(job.run_ids);
      await refreshStatus();
      toast(job.status === "complete" ? "实验已完成，结果与轨迹已保存。" : job.message);
    }
  } catch (e) {
    $("jobStatus").textContent = "连接暂时中断，正在重试。任务仍可能在服务器运行。";
    pollTimer = setTimeout(pollJob,4000);
  }
}
async function refreshStatus() {
  const status = await api("/status");
  const d = status.detector;
  $("modelState").textContent = d.loaded ? `${d.loaded.toUpperCase()} · ${d.device.toUpperCase()}` : d.installed ? "模型按需加载" : "需安装模型依赖";
  $("llmStatus").textContent = status.llm_configured ? `已配置：${status.llm_model}。仅发送文本和检测结果。` : "未配置 LLM；可先使用本地模板，或在使用说明中查看配置方式。";
  $("agentMode").options[1].disabled = !status.llm_configured;
}
async function createPlan() {
  const button = $("plan"); button.disabled = true; button.textContent = "正在规划…";
  try {
    const plan = await api("/agent/plan",{goal:$("goal").value,target:$("target").value,mode:$("agentMode").value});
    state.plan = plan;
    $("planResult").innerHTML = `<div class="eyebrow">${plan.mode === "template" ? "TEMPLATE PLAN" : "LLM PLAN"} / ${plan.experiments.length} RUNS</div>` + plan.experiments.map((e,i) => `<div class="plan-item"><span class="plan-index">0${i+1}</span><b>${escapeHTML(e.prompt)}</b><p>${escapeHTML(e.rationale)}</p></div>`).join("") + `<p class="plan-caveat">${escapeHTML(plan.caveat)}</p><button id="executePlan" class="button primary full" ${state.busy?"disabled":""}>执行这组实验 →</button><button id="editPlan" class="text-button">复制到提示词框，手动编辑</button>`;
    $("executePlan").onclick = guarded(() => submitJob(plan.id));
    $("editPlan").onclick = () => { $("prompts").value = plan.experiments.map(e=>e.prompt).join("\n"); $("prompts").oninput(); inspectorTab(false); $("prompts").focus(); toast("已复制。编辑后通过「运行检测」执行手动实验。"); };
  } finally { button.disabled = false; button.textContent = '生成实验计划'; }
}
async function loadHistory() {
  const [runs,jobs] = await Promise.all([api("/runs"),api("/jobs")]);
  $("historyCount").textContent = runs.length;
  const html = runs.map(r=>{
    const image=state.images.find(x=>x.id===r.image_id);
    return `<article class="panel history-card"><img src="/api/images/${r.image_id}/file" alt=""><div class="history-body"><h2>${escapeHTML(r.prompt)}</h2><p>${escapeHTML(image?.name || "image")} · ${escapeHTML(r.model)} · ${sourceNames[r.source] || escapeHTML(r.source)} · ${r.detections.length} 候选框</p><p>${escapeHTML(new Date(r.created_at).toLocaleString())} · revision ${escapeHTML(r.revision?.slice(0,10) || "未提供")}</p></div><button class="button secondary" data-open-run="${r.id}" data-image="${r.image_id}">查看结果 ↗</button></article>`;
  }).join("");
  $("historyList").innerHTML = html || '<div class="panel empty-state">还没有实验。回到工作台，加载样例或运行一次检测。</div>';
  if (jobs.length) {
    const section = document.createElement("section");section.className="panel prose";
    section.innerHTML = "<h2>任务与 Agent 轨迹</h2>" + jobs.map(j=>`<p><button class="text-button" data-job="${j.id}">${escapeHTML(j.status.toUpperCase())} · ${escapeHTML(j.created_at.slice(0,19))} · ${j.completed}/${j.request.prompts.length} 组</button> ${escapeHTML(j.plan?.goal || "手动实验")}</p>`).join("");
    $("historyList").append(section);
  }
}
function reportBundle() {
  return {schema_version:1,exported_at:new Date().toISOString(),image:state.image,runs:state.runs,
    comparison:state.comparison ? {run_a:state.a.id,run_b:state.b.id,threshold:state.threshold,iou_threshold:state.iou,...state.comparison} : null,
    job:state.job?.request.image_id === state.image?.id ? state.job : null,
    limitations:["Model confidence is not accuracy.","Spatial correspondence is class-agnostic greedy IoU matching.","No ground-truth metrics are inferred without annotations."]};
}
function csvCell(value) {
  let text=String(value ?? ""); if (/^[=+\-@\t\r]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function exportDialog() {
  if (!state.image || !state.runs.length) return toast("请先运行实验，或加载带结果的样例。");
  modal("导出实验", '<p>导出当前图片的全部实验，包含模型版本、提示词、参数和检测框。图片文件与权重不包含在报告中。</p><button class="button primary" id="exportJSON">JSON · 完整记录</button><button class="button secondary" id="exportCSV">CSV · 检测明细</button><button class="button secondary" id="exportMD">Markdown · 对比报告</button>');
  $("exportJSON").onclick=()=>download("promptscope-experiment.json",JSON.stringify(reportBundle(),null,2),"application/json");
  $("exportCSV").onclick=()=>{
    const rows=[["run_id","prompt","model","source","label","score","x1","y1","x2","y2"]];
    state.runs.forEach(r=>r.detections.forEach(d=>rows.push([r.id,r.prompt,r.model,r.source,d.label,d.score,...d.box])));
    download("promptscope-detections.csv","\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n"),"text/csv;charset=utf-8");
  };
  $("exportMD").onclick=()=>{
    const clean=v=>String(v).replaceAll("|","\\|").replace(/[\r\n]/g," ");
    const bundle=reportBundle();
    let md=`# PromptScope experiment report\n\nImage: ${clean(state.image.name)} (${state.image.width} × ${state.image.height})\n\nImage SHA-256: ${state.image.sha256}\n\n## Runs\n\n| Prompt | Model | Source | Candidates | Revision |\n|---|---|---|---:|---|\n`;
    state.runs.forEach(r=>md+=`| ${clean(r.prompt)} | ${clean(r.model)} | ${clean(r.source)} | ${r.detections.length} | ${r.revision||"not supplied"} |\n`);
    if (bundle.comparison) md+=`\n## A/B spatial correspondence\n\nA: ${clean(state.a.prompt)}\n\nB: ${clean(state.b.prompt)}\n\nDisplay threshold: ${state.threshold}; matching IoU: ${state.iou}. Matched: ${state.comparison.matched}; A only: ${state.comparison.only_a.length}; B only: ${state.comparison.only_b.length}.\n`;
    if (bundle.job?.report) md+=`\n## Analysis (${bundle.job.report.source})\n\n${bundle.job.report.summary}\n\n${bundle.job.report.next_step}\n`;
    md+="\n## Limits\n\nConfidence is not accuracy. This report describes model outputs, not detection correctness. No GT metrics are inferred. Raw candidates below 0.05 are not retained by native inference.\n";
    download("promptscope-report.md",md,"text/markdown;charset=utf-8");
  };
}
async function handleJSON(file) {
  if (!file) return;
  if (file.size > 4*1024*1024) throw new Error("JSON 文件不能超过 4 MiB。");
  const data=JSON.parse(await file.text());
  if (jsonAction === "evaluate") {
    if (!state.a) throw new Error("请先选择实验 A。");
    const result=await api("/evaluate",{...data,run_id:state.a.id,threshold:state.threshold,iou_threshold:state.iou});
    modal("标注评估 · 实验 A",`<p>单图 all-points AP @ IoU ${state.iou}：<b>${number(result.map,3)}</b>。不是 COCO mAP。</p><div class="table-wrap"><table><thead><tr><th>类别</th><th>GT</th><th>TP / FP / FN</th><th>AP</th><th>P / R</th></tr></thead><tbody>${result.classes.map(r=>`<tr><td>${escapeHTML(r.label)}</td><td>${r.gt}</td><td>${r.tp} / ${r.fp} / ${r.fn}</td><td>${number(r.ap,3)}</td><td>${number(r.precision)} / ${number(r.recall)}</td></tr>`).join("")}</tbody></table></div><p class="method-note">AP 使用全部已保存候选框；P / R 使用当前显示阈值。请核实自由文本标签与真值的映射。</p><button id="exportEvaluation" class="button secondary">导出评估 JSON</button>`);
    $("exportEvaluation").onclick=()=>download("promptscope-evaluation.json",JSON.stringify({...result,run_id:state.a.id,annotations:data},null,2),"application/json");
  } else {
    if (!state.image) throw new Error("请先选中结果对应的图片。");
    const rows = data.schema_version === 1 && Array.isArray(data.runs) ? data.runs : [data];
    if (rows.length > 100) throw new Error("一次最多导入 100 组结果。");
    if (data.image?.sha256 && data.image.sha256 !== state.image.sha256) throw new Error("报告的图片指纹与当前图片不同，请先上传正确图片。");
    for (const row of rows) await api("/runs/import",{image_id:state.image.id,prompt:row.prompt,model:row.model||"external",detections:row.detections});
    await refreshRuns(); toast(`已导入 ${rows.length} 组结果。`);
  }
}

document.querySelectorAll(".nav").forEach(el=>el.onclick=()=>showTab(el.dataset.tab));
$("help").onclick=()=>showTab("guide"); $("closeModal").onclick=()=>$("modal").close();
function applyTheme(dark) {
  document.body.classList.toggle("dark",dark); $("theme").textContent=dark?"浅色":"深色";
  document.documentElement.style.colorScheme=dark?"dark":"light";
  document.querySelector('meta[name="theme-color"]').content=dark?"#1b1b1e":"#f5f5f7";
  drawAll();
}
$("theme").onclick=()=>{const dark=!document.body.classList.contains("dark");applyTheme(dark);try{localStorage.setItem("promptscope.theme.v2",dark?"dark":"light");}catch(_){}};
for(const id of ["upload","addImage"]) $(id).onclick=()=>$("fileInput").click();
$("fileInput").onchange=guarded(async e=>{await uploadFile(e.target.files[0]);e.target.value="";});
$("sample").onclick=guarded(async()=>{const img=await api("/sample",{});await refreshImages();await selectImage(img.id);showTab("workbench");});
$("imageList").onclick=guarded(async e=>{const b=e.target.closest("[data-image]");if(b){await selectImage(b.dataset.image);showTab("workbench");}});
for(const side of ["A","B"]) {
  $("run"+side).onchange=guarded(async e=>{state[side.toLowerCase()]=state.runs.find(r=>r.id===e.target.value);state.selected=null;renderResults();await updateComparison();});
  $("canvas"+side).onclick=e=>{
    const projection=JSON.parse(e.target.dataset.projection||"null");if(!projection)return;
    const rect=e.target.getBoundingClientRect();const x=(e.clientX-rect.left-projection.ox)/projection.iw,y=(e.clientY-rect.top-projection.oy)/projection.ih;
    const boxes=visible(state[side.toLowerCase()]).map((d,i)=>({d,i,origin:side}));
    if(side==="A"&&state.overlay)boxes.push(...visible(state.b).map((d,i)=>({d,i,origin:"B"})));
    const candidates=boxes.filter(({d})=>x>=d.box[0]&&x<=d.box[2]&&y>=d.box[1]&&y<=d.box[3]);
    candidates.sort((a,b)=>(a.d.box[2]-a.d.box[0])*(a.d.box[3]-a.d.box[1])-(b.d.box[2]-b.d.box[0])*(b.d.box[3]-b.d.box[1]));
    if(candidates.length)chooseDetection(candidates[0].origin,candidates[0].i);
  };
  $("png"+side).onclick=()=>{if(!state.bitmap)return toast("请先选择图片。");const c=document.createElement("canvas");draw(side,c,true);c.toBlob(blob=>download(`promptscope-${side}.png`,blob,"image/png"));};
}
$("swap").onclick=guarded(async()=>{[state.a,state.b]=[state.b,state.a];$("runA").value=state.a?.id||"";$("runB").value=state.b?.id||"";state.selected=null;renderResults();await updateComparison();});
let compareDebounce;
$("threshold").oninput=e=>{state.threshold=Number(e.target.value);$("thresholdValue").textContent=state.threshold.toFixed(2);state.selected=null;renderResults();clearTimeout(compareDebounce);compareDebounce=setTimeout(()=>updateComparison().catch(e=>toast(e.message)),100);};
$("iou").onchange=guarded(async e=>{state.iou=Number(e.target.value);await updateComparison();});
$("showLabels").onchange=drawAll;
$("detections").onclick=e=>{const row=e.target.closest("[data-side]");if(row)chooseDetection(row.dataset.side,Number(row.dataset.index));};
$("run").onclick=guarded(()=>submitJob()); $("plan").onclick=guarded(createPlan);
$("cancel").onclick=guarded(async()=>{if(state.job){await api(`/jobs/${state.job.id}/cancel`,{});toast("已请求取消，将在当前模型调用结束后停止后续实验。");}});
$("export").onclick=exportDialog; $("refreshHistory").onclick=guarded(loadHistory);
$("historyList").onclick=guarded(async e=>{
  const run=e.target.closest("[data-open-run]"),job=e.target.closest("[data-job]");
  if(run){await selectImage(run.dataset.image);await refreshRuns([run.dataset.openRun]);showTab("workbench");}
  if(job){state.job=await api(`/jobs/${job.dataset.job}`);renderJob(state.job);showTab("workbench");if(["queued","running"].includes(state.job.status))await pollJob();}
});
$("import").onclick=()=>{jsonAction="import";$("jsonInput").click();};
$("evaluate").onclick=()=>{if(!state.a)return toast("请先选择实验 A。");jsonAction="evaluate";$("jsonInput").click();};
$("jsonInput").onchange=guarded(async e=>{try{await handleJSON(e.target.files[0]);}finally{e.target.value="";}});
$("workbench").ondragover=e=>{e.preventDefault();$("workbench").classList.add("drag-over");};
$("workbench").ondragleave=e=>{if(!$("workbench").contains(e.relatedTarget))$("workbench").classList.remove("drag-over");};
$("workbench").ondrop=guarded(async e=>{e.preventDefault();$("workbench").classList.remove("drag-over");await uploadFile(e.dataTransfer.files[0]);});
new ResizeObserver(drawAll).observe($("canvasA").parentElement);
new ResizeObserver(drawAll).observe($("canvasB").parentElement);
function inspectorTab(agent) {
  $("manualPanel").classList.toggle("hidden",agent);$("agentPanel").classList.toggle("hidden",!agent);
  $("manualTab").classList.toggle("active",!agent);$("agentTab").classList.toggle("active",agent);
  $("manualTab").setAttribute("aria-selected",String(!agent));$("agentTab").setAttribute("aria-selected",String(agent));
  $("manualTab").tabIndex=agent?-1:0;$("agentTab").tabIndex=agent?0:-1;
}
$("manualTab").onclick=()=>inspectorTab(false);$("agentTab").onclick=()=>inspectorTab(true);
for(const id of ["manualTab","agentTab"]) $(id).onkeydown=e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();const agent=id==="manualTab";inspectorTab(agent);$(agent?"agentTab":"manualTab").focus();}};
for(const [id,overlay] of [["splitView",false],["overlayView",true]]) $(id).onclick=()=>{
  state.overlay=overlay;document.querySelector(".views").classList.toggle("overlay",overlay);
  $("splitView").classList.toggle("active",!overlay);$("overlayView").classList.toggle("active",overlay);
  $("splitView").setAttribute("aria-pressed",String(!overlay));$("overlayView").setAttribute("aria-pressed",String(overlay));drawAll();
};
$("prompts").oninput=()=>{$("promptCount").textContent=$("prompts").value.split("\n").filter(x=>x.trim()).length+" 组";};
$("prompts").onkeydown=guarded(async e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();await submitJob();}});
async function initialize() {
  inspectorTab(false);
  let dark=true;try{dark=localStorage.getItem("promptscope.theme.v2")!=="light";}catch(_){}applyTheme(dark);
  await refreshStatus(); await refreshImages();
  if(!state.images.length){await api("/sample",{});await refreshImages();}
  let remembered;try{remembered=localStorage.getItem("promptscope.image");}catch(_){}
  await selectImage(state.images.find(i=>i.id===remembered)?.id||state.images[0]?.id);
  const jobs=await api("/jobs");const active=jobs.find(j=>["queued","running"].includes(j.status));
  if(active){state.job=active;await pollJob();}else if(jobs.length){state.job=jobs[0];renderJob(state.job);}
  $("historyCount").textContent=(await api("/runs")).length;
}
initialize().catch(e=>{$("jobStatus").textContent=`连接失败：${e.message}。请从启动脚本运行项目。`;toast(e.message);});
