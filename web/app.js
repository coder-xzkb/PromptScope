"use strict";
const $ = (id) => document.getElementById(id);
const state = { images: [], image: null, bitmap: null, runs: [], a: null, b: null, plan: null,
  job: null, experiments: [], trash: [], groupMode: "manual", showTrash: false, runningId: null,
  threshold: .25, iou: .5, comparison: null, selected: null, busy: false, overlay: false, comparisonSequence: 0 };
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
async function selectImage(id, group = null) {
  if(!group)groupSequence++;
  const sequence = ++imageSequence;
  const meta = state.images.find(x => x.id === id);
  if (!meta) return;
  const image = new Image();
  image.src = `/api/images/${id}/file`;
  await image.decode();
  if (sequence !== imageSequence) return;
  state.image = meta; state.bitmap = image; state.selected = null;
  state.job = group; state.a = state.b = null;
  if(group) renderJob(group); else clearJobView();
  renderExperiments();
  $("sceneTitle").textContent = meta.name.replace(/\.[a-z]+$/i, "");
  $("imageMeta").textContent = `${meta.width} × ${meta.height} px`;
  document.querySelectorAll(".image-item").forEach(el => el.classList.toggle("active", el.dataset.image === id));
  try { localStorage.setItem("promptscope.image", id); } catch (_) { /* optional preference */ }
  try { localStorage.setItem("promptscope.experiment", group?.id || ""); } catch (_) {}
  await refreshRuns(group?.run_ids);
}
async function refreshRuns(preferredIds) {
  if (!state.image) return drawAll();
  const imageId = state.image.id, groupId = state.job?.id;
  const allRuns = await api(`/runs?image_id=${imageId}`);
  if (imageId !== state.image?.id || groupId !== state.job?.id) return;
  const runs = groupId ? state.job.run_ids.map(id=>allRuns.find(r=>r.id===id)).filter(Boolean) : [];
  state.runs = runs;
  const oldA = state.a?.id, oldB = state.b?.id;
  state.a = runs.find(r => r.id === (preferredIds?.[0] || oldA)) || runs.at(-1) || null;
  state.b = runs.find(r => r.id === (preferredIds?.[1] || oldB)) || runs[0] || null;
  for (const side of ["A", "B"]) {
    const select = $("run" + side);
    select.innerHTML = runs.length ? runs.map((r, i) => `<option value="${r.id}">${escapeHTML(r.prompt)} · ${escapeHTML(r.model)} #${i+1}</option>`).join("") : "<option>当前实验组还没有结果</option>";
    if (state[side.toLowerCase()]) select.value = state[side.toLowerCase()].id;
  }
  renderResults(); await updateComparison();
}
const statusNames = {queued:"排队中",running:"运行中",complete:"已完成",failed:"失败",cancelled:"已取消",interrupted:"已中断"};
async function refreshExperiments() {
  [state.experiments,state.trash] = await Promise.all([api("/experiments"),api("/experiments?deleted=true")]);
  renderExperiments();
}
function renderExperiments() {
  const selected=state.experiments.find(g=>g.id===state.job?.id);
  $("sceneContext").textContent=selected?`${selected.mode==="agent"?"Agent 实验":"手动实验"} / ${selected.source==="recorded_inference"?"内置样例":"实验"} ${String(selected.number).padStart(3,"0")}`:"视觉检测 / 新实验";
  const list = (state.showTrash ? state.trash : state.experiments).filter(g=>g.mode===state.groupMode);
  for(const mode of ["manual","agent"]) {
    const button=$(mode+"Groups");
    button.classList.toggle("active",state.groupMode===mode);
    button.setAttribute("aria-pressed",String(state.groupMode===mode));
    $(mode+"GroupCount").textContent=state.experiments.filter(g=>g.mode===mode).length;
  }
  $("trashToggle").textContent=state.showTrash?"返回实验列表":"回收站 · "+state.trash.length;
  $("trashToggle").setAttribute("aria-pressed",String(state.showTrash));
  $("historyCount").textContent=state.experiments.length;
  $("experimentList").innerHTML=list.map(g=>{
    const label=`实验 ${String(g.number).padStart(3,"0")}`;
    const busy=["queued","running"].includes(g.status);
    const source=g.source==="recorded_inference"?"内置样例":g.source==="imported"?"外部导入":statusNames[g.status]||g.status;
    return `<article class="experiment-card ${state.job?.id===g.id?"active":""}">
      <button class="experiment-open" data-experiment="${g.id}" ${g.deleted?"disabled":""} aria-label="打开${label}：${escapeHTML(g.image_name)}" ${state.job?.id===g.id?'aria-current="true"':""}>
      <img src="/api/images/${g.image_id}/file" alt=""><span><strong>${label}${g.kept?" · ★":""}</strong><span class="experiment-name">${escapeHTML(g.image_name)}</span></span></button>
      <p class="experiment-prompt">${escapeHTML(g.prompts.join(" / "))}</p><p class="experiment-meta">${source} · ${g.prompts.length} 个提示词<br>${escapeHTML(new Date(g.created_at).toLocaleString())}</p>
      <div class="experiment-actions">${g.deleted?`<button data-group-action="restore" data-id="${g.id}" aria-label="恢复${label}">恢复实验</button>`:`<button data-group-action="keep" data-id="${g.id}" aria-label="${g.kept?"取消保留":"保留"}${label}" aria-pressed="${g.kept}">${g.kept?"★ 已保留":"☆ 保留"}</button><button data-group-action="delete" data-id="${g.id}" aria-label="删除${label}" ${busy?'disabled title="请等待结束或先取消任务"':""}>删除</button>`}</div></article>`;
  }).join("") || `<p class="experiment-empty">${state.showTrash?"这里没有已删除的实验。":state.groupMode==="manual"?"运行一次手动检测，就会在这里新增一组。":"执行一次 Agent 计划，就会在这里新增一组。"}</p>`;
}
function clearJobView() {
  $("jobBadge").textContent="READY";$("jobBadge").className="badge neutral";
  $("jobStatus").textContent="选择历史实验，或运行一次新实验。";$("trace").innerHTML="";
  renderAnalysis(null);
}
let groupSequence=0;
async function openExperiment(id) {
  const sequence=++groupSequence;
  const group=await api(`/experiments/${id}`);
  if(sequence!==groupSequence)return;
  if(group.deleted)return toast("这组实验在回收站，请先恢复。");
  state.groupMode=group.mode;state.showTrash=false;
  state.threshold=.25;state.iou=.5;$("threshold").value=.25;$("thresholdValue").textContent="0.25";$("iou").value="0.5";
  state.plan=null;$("planResult").innerHTML="";
  $("prompts").value=group.request.prompts.join("\n");$("prompts").oninput();
  if(["tiny","base"].includes(group.request.model))$("model").value=group.request.model;
  $("textThreshold").value=group.request.text_threshold??.25;
  if(group.plan){state.plan=group.plan;$("goal").value=group.plan.goal;$("agentMode").value=group.plan.mode;displayPlan(group.plan);}
  inspectorTab(group.mode==="agent");
  await selectImage(group.request.image_id,group);
  showTab("workbench");
}
async function groupAction(action,id) {
  const group=[...state.experiments,...state.trash].find(g=>g.id===id);
  if(!group)return;
  await api(`/experiments/${id}/${action}`,action==="keep"?{kept:!group.kept}:{});
  if(action==="delete" && state.job?.id===id)await selectImage(state.image.id);
  await refreshExperiments();
  if(!$("history").classList.contains("hidden"))await loadHistory();
  toast(action==="delete"?"实验已移至回收站，可恢复。原图和共用缓存保留。":action==="restore"?"实验已恢复。":group.kept?"已取消保留标记；实验仍自动保存。":"已标记保留，并置于列表前方。");
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
  groupSequence++;
  setBusy(true);
  try {
    state.job = await api(planId ? `/agent/execute/${planId}` : "/jobs",config);
    state.runningId=state.job.id;state.groupMode=planId?"agent":"manual";state.showTrash=false;
    state.a=state.b=null;await refreshRuns();await refreshExperiments();
    try{localStorage.setItem("promptscope.experiment",state.job.id);}catch(_){}
    await pollJob();
  } catch (e) { setBusy(false); throw e; }
}
function renderJob(job) {
  $("jobBadge").textContent = job.status.toUpperCase();
  $("jobBadge").className = "badge " + (job.status === "failed" ? "failed" : ["running","queued"].includes(job.status) ? "working" : "neutral");
  $("jobStatus").textContent = job.message;
  $("trace").innerHTML = job.events.map(e => `<div class="trace-event"><b>${escapeHTML(e.stage)}</b><p>${escapeHTML(e.message)}</p></div>`).join("");
  if (job.report) {
    $("trace").innerHTML += '<a class="analysis-link" href="#analysisPanel">查看实验结果分析 ↓</a>';
  }
  renderAnalysis(job);
}
function renderAnalysis(job = state.job) {
  const current = job?.request.image_id === state.image?.id ? job : null;
  const report = current?.report;
  const pending = current && ["running", "queued"].includes(current.status);
  const savedOnly=current && ["recorded_inference","imported"].includes(current.source);
  $("analysisBadge").textContent = report ? (report.source === "llm" ? "LLM 分析" : "规则报告") : pending ? "正在实验" : savedOnly ? "已有检测结果" : "等待结果";
  $("analysisPanel").classList.toggle("has-report", !!report);
  $("analysisMeta").textContent = current ? `${current.completed} / ${current.request.prompts.length} 组实验 · ${new Date(current.created_at).toLocaleString()}` : "当前图片的实验结论与下一步建议";
  if (!report) {
    $("analysisBody").innerHTML = `<p class="analysis-empty">${pending ? "实验正在进行。检测和分析完成后，结论会显示在这里。" : savedOnly ? "这组保存的是样例或导入的检测结果，未生成分析报告。运行新的手动实验或 Agent 计划后，可在对应实验组中查看分析。" : current && ["failed", "cancelled", "interrupted"].includes(current.status) ? escapeHTML(current.message) : "运行手动实验或 Agent 计划后，在这里查看结果分析。已有报告可从侧边实验列表打开。"}</p>`;
    return;
  }
  $("analysisBody").innerHTML = `${current.plan?.goal ? `<p class="analysis-question"><span>研究问题</span>${escapeHTML(current.plan.goal)}</p>` : ""}
    <div class="analysis-summary"><h3>结果解读</h3><p>${escapeHTML(report.summary)}</p></div>
    <div class="analysis-next"><h3>下一步建议</h3><p>${escapeHTML(report.next_step)}</p></div>
    ${report.llm_error ? `<p class="analysis-error">LLM 分析未生成，当前显示规则报告：${escapeHTML(report.llm_error)}</p>` : ""}
    <details class="analysis-context"><summary>查看这份报告对应的实验与参数</summary><ul>${current.request.prompts.map(p=>`<li>${escapeHTML(p)}</li>`).join("")}</ul><p>分析使用本次任务的全部实验，固定显示阈值 0.25、匹配 IoU 0.50；切换上方 A / B 或滑块不会重写这份报告。${report.source === "llm" ? "LLM 仅依据结构化检测结果分析，结论请结合标注或人工检查。" : "规则报告不包含大模型分析。"}</p></details>`;
}
async function pollJob() {
  clearTimeout(pollTimer);
  if (!state.runningId) return;
  const id=state.runningId;
  try {
    const job = await api(`/jobs/${id}`);
    if(state.job?.id===id){state.job=job;renderJob(job);}
    await refreshExperiments();
    if (["queued","running"].includes(job.status)) {
      setBusy(true); pollTimer = setTimeout(pollJob,1600);
    } else {
      setBusy(false);
      state.runningId=null;
      if (state.job?.id===id) await refreshRuns(job.run_ids);
      await refreshStatus();
      toast(job.status === "complete" ? "实验已完成，分析已显示在检测明细下方。" : job.message);
    }
  } catch (e) {
    if(state.job?.id===id)$("jobStatus").textContent = "连接暂时中断，正在重试。任务仍可能在服务器运行。";
    pollTimer = setTimeout(pollJob,4000);
  }
}
async function refreshStatus() {
  const status = await api("/status");
  const d = status.detector;
  $("modelState").textContent = d.loaded ? `${d.loaded.toUpperCase()} · ${d.device.toUpperCase()}` : d.installed ? "模型按需加载" : "需安装模型依赖";
  $("llmStatus").textContent = status.llm_configured ? `已配置：${status.llm_model}。仅发送文本和检测结果。` : "未配置 LLM；点击顶部「API 接入」配置，或先使用本地模板。";
  $("agentMode").options[1].disabled = !status.llm_configured;
  if(!status.llm_configured) $("agentMode").value="template";
}
function displayPlan(plan) {
    $("planResult").innerHTML = `<div class="eyebrow">${plan.mode === "template" ? "TEMPLATE PLAN" : "LLM PLAN"} / ${plan.experiments.length} RUNS</div>` + plan.experiments.map((e,i) => `<div class="plan-item"><span class="plan-index">0${i+1}</span><b>${escapeHTML(e.prompt)}</b><p>${escapeHTML(e.rationale)}</p></div>`).join("") + `<p class="plan-caveat">${escapeHTML(plan.caveat)}</p><button id="executePlan" class="button primary full" ${state.busy?"disabled":""}>执行这组实验 →</button><button id="editPlan" class="text-button">复制到提示词框，手动编辑</button>`;
    $("executePlan").onclick = guarded(() => submitJob(plan.id));
    $("editPlan").onclick = () => { $("prompts").value = plan.experiments.map(e=>e.prompt).join("\n"); $("prompts").oninput(); inspectorTab(false); $("prompts").focus(); toast("已复制。编辑后通过「运行检测」执行手动实验。"); };
}
async function createPlan() {
  const button = $("plan"); button.disabled = true; button.textContent = "正在规划…";
  try {
    const plan = await api("/agent/plan",{goal:$("goal").value,target:$("target").value,mode:$("agentMode").value});
    state.plan = plan;
    displayPlan(plan);
  } finally { button.disabled = false; button.textContent = '生成实验计划'; }
}
async function loadHistory() {
  await refreshExperiments();
  $("historyList").innerHTML=["manual","agent"].map(mode=>{
    const groups=state.experiments.filter(g=>g.mode===mode);
    return `<section class="history-section"><h2>${mode==="manual"?"手动实验":"Agent 实验"} · ${groups.length}</h2>`+groups.map(g=>`<article class="panel history-card"><img src="/api/images/${g.image_id}/file" alt=""><div class="history-body"><h2>实验 ${String(g.number).padStart(3,"0")} ${g.kept?"★":""} · ${escapeHTML(g.image_name)}</h2><p>${escapeHTML(g.prompts.join(" / "))}</p><p>${escapeHTML(new Date(g.created_at).toLocaleString())} · ${statusNames[g.status]||escapeHTML(g.status)}</p></div><button class="button secondary" data-experiment="${g.id}">打开实验组 ↗</button></article>`).join("")+(groups.length?"":'<p class="experiment-empty">还没有这类实验。</p>')+'</section>';
  }).join("");
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
  modal("导出实验", '<p>导出当前实验组的结果，包含模型版本、提示词、参数和检测框。图片文件与权重不包含在报告中。</p><button class="button primary" id="exportJSON">JSON · 完整记录</button><button class="button secondary" id="exportCSV">CSV · 检测明细</button><button class="button secondary" id="exportMD">Markdown · 对比报告</button>');
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
    await refreshExperiments();const imported=state.experiments.find(g=>g.image_id===state.image.id&&g.source==="imported");if(imported)await openExperiment(imported.id);toast(`已导入 ${rows.length} 组结果。`);
  }
}

async function openAPISettings() {
  const saved=await api("/settings/llm");
  modal("API 接入",`<form id="apiForm" class="api-form">
    <p class="api-intro">为 Agent 配置规划与分析模型。保存后立即生效，新任务使用新设置。</p>
    <div class="api-form-grid"><div><label for="apiProvider">运营商</label><select id="apiProvider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义兼容服务</option></select></div>
    <div id="apiNameField"><label for="apiProviderName">运营商名称</label><input id="apiProviderName" maxlength="80" placeholder="例如：我的模型服务"></div></div>
    <label for="apiBaseURL">接口基础地址</label><input id="apiBaseURL" type="url" required placeholder="https://.../v1" autocomplete="off"><p class="api-hint">使用 Chat Completions 兼容接口，不追加 /chat/completions。</p>
    <label for="apiKey">API Key <span id="apiKeyState"></span></label><input id="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="填写此运营商的 API Key"><p id="apiKeyHint" class="api-hint"></p>
    <div class="api-model-heading"><label for="apiModel">模型</label><button id="apiLoadModels" type="button" class="text-button">获取模型列表</button></div><input id="apiModel" list="apiModels" maxlength="160" required autocomplete="off" placeholder="获取列表后选择，或直接填写模型 ID"><datalist id="apiModels"></datalist>
    <p class="api-hint">列表可能含非对话模型，请选择支持 JSON 输出的对话模型。</p>
    <div class="api-form-grid"><div><label for="apiThinking">思考模式</label><select id="apiThinking"><option value="default">跟随模型默认</option><option value="disabled">关闭思考</option><option value="enabled">开启思考</option></select></div><div><label for="apiEffort">思考强度</label><select id="apiEffort"></select></div></div>
    <p id="apiThinkingHint" class="api-hint"></p>
    <label class="api-clear"><input id="apiClearKey" type="checkbox"> 清除已保存的密钥（停用 API）</label>
    <p class="api-privacy">密钥仅保存在本机服务端，不会回填到页面或放进导出报告。模型调用按运营商规则计费。</p>
    <p id="apiSettingsStatus" role="status" aria-live="polite"></p>
    <div class="api-form-actions"><button type="button" id="apiCancel" class="button secondary">取消</button><button id="apiSave" class="button primary" type="submit">保存并应用</button></div>
  </form>`);
  $("apiProvider").value=saved.provider;$("apiProviderName").value=saved.provider_name||"";
  $("apiBaseURL").value=saved.base_url;$("apiModel").value=saved.model;
  $("apiThinking").value=saved.thinking;
  const presets={deepseek:{base:"https://api.deepseek.com",model:"deepseek-flash",name:"DeepSeek"},openai:{base:"https://api.openai.com/v1",model:"",name:"OpenAI"},custom:{base:"",model:"",name:""}};
  function updateOptions(effort=$("apiEffort").value||"high") {
    const provider=$("apiProvider").value;
    $("apiNameField").classList.toggle("hidden",provider!=="custom");
    $("apiBaseURL").readOnly=provider!=="custom";
    const options=provider==="deepseek"?[["low","低"],["high","高"],["max","最高"]]:[["low","低"],["medium","中"],["high","高"]];
    $("apiEffort").innerHTML=options.map(([v,t])=>`<option value="${v}">${t}</option>`).join("");
    $("apiEffort").value=options.some(([v])=>v===effort)?effort:"high";
    $("apiEffort").disabled=$("apiThinking").value!=="enabled";
    const reuse=saved.api_key_set&&provider===saved.provider&&$("apiBaseURL").value.replace(/\/$/,"")===saved.base_url;
    $("apiKeyState").textContent=reuse?"已配置":"未配置";
    $("apiKeyHint").textContent=reuse?"留空可继续使用此接口已保存的密钥；填写新值会替换。":"请填写当前运营商的密钥；切换接口不会沿用旧密钥。";
    $("apiThinkingHint").textContent=provider==="deepseek"?"DeepSeek 支持关闭思考，开启后可选择低、高或最高强度。":"不同模型支持的参数不同；不支持思考参数时请选择「跟随模型默认」。关闭模式要求模型支持 reasoning_effort=none。";
  }
  updateOptions(saved.reasoning_effort);
  const form=$("apiForm"),status=$("apiSettingsStatus"),keyInput=$("apiKey"),saveButton=$("apiSave"),modelsList=$("apiModels");
  $("apiModels").innerHTML=saved.provider==="deepseek"?'<option value="deepseek-flash"><option value="deepseek-v4-pro">':"";
  $("apiProvider").onchange=()=>{const p=presets[$("apiProvider").value];$("apiBaseURL").value=p.base;$("apiModel").value=p.model;$("apiProviderName").value=p.name;$("apiKey").value="";$("apiClearKey").checked=false;$("apiThinking").value=$("apiProvider").value==="deepseek"?"disabled":"default";$("apiModels").innerHTML=$("apiProvider").value==="deepseek"?'<option value="deepseek-flash"><option value="deepseek-v4-pro">':"";$("apiSettingsStatus").textContent="";updateOptions();};
  $("apiThinking").onchange=()=>updateOptions();$("apiBaseURL").oninput=()=>updateOptions();
  function values(){return {provider:$("apiProvider").value,provider_name:$("apiProviderName").value,base_url:$("apiBaseURL").value,model:$("apiModel").value,api_key:$("apiKey").value,thinking:$("apiThinking").value,reasoning_effort:$("apiEffort").value,clear_key:$("apiClearKey").checked};}
  $("apiLoadModels").onclick=async()=>{
    const button=$("apiLoadModels");button.disabled=true;$("apiSettingsStatus").textContent="正在获取模型列表…";
    const draft=values();
    try{const result=await api("/settings/llm/models",draft);if(form.isConnected&&$("apiProvider").value===draft.provider&&$("apiBaseURL").value===draft.base_url){modelsList.innerHTML=result.models.map(m=>`<option value="${escapeHTML(m)}">`).join("");status.textContent=`获取到 ${result.models.length} 个模型，可在模型输入框中选择；未运行实验。`;}}
    catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  };
  $("apiCancel").onclick=()=>$("modal").close();
  $("apiForm").onsubmit=async e=>{
    e.preventDefault();saveButton.disabled=true;
    try{const result=await api("/settings/llm",values());keyInput.value="";await refreshStatus();if(form.isConnected)$("modal").close();toast(result.configured?"API 设置已生效，新实验使用新配置。":"密钥已清除或未填写；当前使用本地模板。 ");}
    catch(error){status.textContent=error.message;}finally{saveButton.disabled=false;}
  };
}
$("apiSettings").onclick=guarded(openAPISettings);

document.querySelectorAll(".nav").forEach(el=>el.onclick=()=>showTab(el.dataset.tab));
$("help").onclick=()=>showTab("guide"); $("closeModal").onclick=()=>$("modal").close();
function applyTheme(dark) {
  document.body.classList.toggle("dark",dark); $("theme").textContent=dark?"浅色":"深色";
  document.documentElement.style.colorScheme=dark?"dark":"light";
  document.querySelector('meta[name="theme-color"]').content=dark?"#30343b":"#f5f5f7";
  drawAll();
}
$("theme").onclick=()=>{const dark=!document.body.classList.contains("dark");applyTheme(dark);try{localStorage.setItem("promptscope.theme.v2",dark?"dark":"light");}catch(_){}};
for(const id of ["upload","addImage"]) $(id).onclick=()=>$("fileInput").click();
$("fileInput").onchange=guarded(async e=>{await uploadFile(e.target.files[0]);e.target.value="";});
$("sample").onclick=guarded(async()=>{const img=await api("/sample",{});await refreshImages();await refreshExperiments();const group=state.experiments.find(g=>g.image_id===img.id&&g.source==="recorded_inference");if(group)await openExperiment(group.id);else{await selectImage(img.id);toast("样例实验在回收站，可恢复后查看。");}showTab("workbench");});
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
$("cancel").onclick=guarded(async()=>{if(state.runningId){await api(`/jobs/${state.runningId}/cancel`,{});toast("已请求取消，将在当前模型调用结束后停止后续实验。");}});
$("export").onclick=exportDialog; $("refreshHistory").onclick=guarded(loadHistory);
$("historyList").onclick=guarded(async e=>{
  const group=e.target.closest("[data-experiment]");if(group)await openExperiment(group.dataset.experiment);
});
$("experimentList").onclick=guarded(async e=>{const action=e.target.closest("[data-group-action]"),group=e.target.closest("[data-experiment]");if(action)await groupAction(action.dataset.groupAction,action.dataset.id);else if(group)await openExperiment(group.dataset.experiment);});
for(const mode of ["manual","agent"])$(mode+"Groups").onclick=guarded(async()=>{state.groupMode=mode;state.showTrash=false;const first=state.experiments.find(g=>g.mode===mode);if(first)await openExperiment(first.id);else{state.job=null;state.plan=null;$("planResult").innerHTML="";clearJobView();renderExperiments();await refreshRuns();inspectorTab(mode==="agent");showTab("workbench");}});
$("trashToggle").onclick=()=>{state.showTrash=!state.showTrash;renderExperiments();};
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
  let remembered,rememberedGroup;try{remembered=localStorage.getItem("promptscope.image");rememberedGroup=localStorage.getItem("promptscope.experiment");}catch(_){}
  await selectImage(state.images.find(i=>i.id===remembered)?.id||state.images[0]?.id);
  await refreshExperiments();
  const first=state.experiments.find(g=>g.id===rememberedGroup)||state.experiments.find(g=>g.image_id===state.image?.id)||state.experiments[0];
  if(first)await openExperiment(first.id);
  const active=state.experiments.find(g=>["queued","running"].includes(g.status));
  if(active){state.runningId=active.id;await pollJob();}
}
initialize().catch(e=>{$("jobStatus").textContent=`连接失败：${e.message}。请从启动脚本运行项目。`;toast(e.message);});
