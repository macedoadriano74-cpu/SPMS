import { useState, useMemo, useEffect, useCallback } from "react";
/* ══════════════════════════════════════════════════════════════════════
 * SPMS+ v2.0 — Compatibility shim
 * Claude Artifacts expone window.storage (API propietaria async).
 * Fuera de ese entorno no existe. Este shim la emula con localStorage.
 * Mantiene el mismo contrato async que usa el código original.
 * ══════════════════════════════════════════════════════════════════════ */
if (typeof window !== "undefined" && !(window as any).storage) {
  (window as any).storage = {
    get: async (key: string) => {
      try {
        const value = localStorage.getItem(key);
        return value !== null ? { value } : null;
      } catch { return null; }
    },
    set: async (key: string, value: string, _shared?: boolean) => {
      try {
        localStorage.setItem(key, value);
        return { key, value };
      } catch { return null; }
    },
    delete: async (key: string, _shared?: boolean) => {
      try {
        localStorage.removeItem(key);
        return { key, deleted: true };
      } catch { return null; }
    },
    list: async (prefix?: string, _shared?: boolean) => {
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (!prefix || k.startsWith(prefix))) keys.push(k);
        }
        return { keys, prefix };
      } catch { return { keys: [], prefix }; }
    },
  };
}


/* ══ SUPABASE CLIENT (carga dinámica) ═══════════════════════ */
let _sb=null;
const SB_SCRIPT_URL="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const loadSupabaseLib=()=>new Promise((resolve,reject)=>{
  if(window.supabase)return resolve(window.supabase);
  const existing=document.getElementById("sb-lib");
  if(existing){existing.addEventListener("load",()=>resolve(window.supabase));return;}
  const s=document.createElement("script");s.id="sb-lib";s.src=SB_SCRIPT_URL;s.async=true;
  s.onload=()=>resolve(window.supabase);s.onerror=()=>reject(new Error("No se pudo cargar Supabase"));
  document.head.appendChild(s);
});
const initSupabase=async(url,key)=>{
  const lib=await loadSupabaseLib();
  _sb=lib.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"spms_auth"}});
  return _sb;
};
const sb=()=>_sb;

/* ══ SYNC STATE ─ modo mixto ═══════════════════════════════ */
const SYNC_STATUS={offline:"offline",syncing:"syncing",synced:"synced",error:"error",local:"local"};

/* ROLES */
const ROLES={
  sponsor:{label:"Sponsor",sub:"Patrono / Project Owner",color:"#14B8A6",icon:"👑",perms:{manageUsers:true,deleteProject:true,createProject:true,viewAll:true,editContent:true,boomManageBoards:true,boomViewAll:true,boomDeleteAny:true}},
  pm:{label:"PM",sub:"Coordinador / Scrum Master",color:"#3A7BD5",icon:"🎯",perms:{manageUsers:false,deleteProject:false,createProject:true,viewAll:false,editContent:true,boomManageBoards:true,boomViewAll:false,boomDeleteAny:false}},
  team:{label:"Team",sub:"Equipo",color:"#27AE60",icon:"🔧",perms:{manageUsers:false,deleteProject:false,createProject:false,viewAll:false,editContent:true,boomManageBoards:false,boomViewAll:false,boomDeleteAny:false}},
};
const can=(user,p)=>user&&ROLES[user.role]?.perms[p];
const DEFAULT_USERS=[{id:"u_admin",username:"admin",password:"spms2024",name:"Administrador",role:"sponsor",created:new Date().toISOString()}];

/* BOOM */
const PRIO={
  critical:{label:"Crítica",color:"#E74C3C",bg:"#E74C3C22",dot:"🔴"},
  high:{label:"Alta",color:"#F39C12",bg:"#F39C1222",dot:"🟠"},
  medium:{label:"Media",color:"#3A7BD5",bg:"#3A7BD522",dot:"🔵"},
  low:{label:"Baja",color:"#27AE60",bg:"#27AE6022",dot:"🟢"},
};
const SCOLS=[
  {id:"c_todo",name:"Por hacer",status:"todo",color:"#6B7E94",wip:null},
  {id:"c_progress",name:"En progreso",status:"in_progress",color:"#3A7BD5",wip:5},
  {id:"c_review",name:"En revisión",status:"review",color:"#9B59B6",wip:3},
  {id:"c_blocked",name:"Bloqueado",status:"blocked",color:"#E74C3C",wip:null},
  {id:"c_done",name:"Hecho",status:"done",color:"#27AE60",wip:null},
];
const mkBoard=(name,projId,userId,color="#14B8A6")=>({id:"b_"+Date.now(),name,projectId:projId||null,color,cols:[...SCOLS.map(c=>({...c}))],createdBy:userId,members:[],createdAt:new Date().toISOString()});
const mkAct=(d,userId)=>({id:"a_"+Date.now()+"_"+Math.random().toString(36).slice(2,5),...d,createdBy:userId,progress:d.progress||0,assignees:d.assignees||[],tags:d.tags||[],order:Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const mkLog=(actId,userId,action,field,oldV,newV)=>({id:"l_"+Date.now(),actId,userId,action,field:field||"",old:oldV!==undefined?String(oldV):"",new:newV!==undefined?String(newV):"",ts:new Date().toISOString()});
const genId=()=>"id_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
const isOverdue=(d)=>d&&new Date(d)<new Date()&&new Date(d).toDateString()!==new Date().toDateString();
const isToday=(d)=>d&&new Date(d).toDateString()===new Date().toDateString();
const isThisWeek=(d)=>{if(!d)return false;const n=new Date(),e=new Date(n);e.setDate(n.getDate()+7);return new Date(d)>new Date()&&new Date(d)<=e;};
const fmtDate=(d)=>d?new Date(d).toLocaleDateString("es-PA",{day:"2-digit",month:"short"}):"—";
const fmtNum=(n)=>{const v=Number(n);if(!v||isNaN(v))return"—";if(Math.abs(v)>=1e6)return(v/1e6).toFixed(2)+"M";if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+"K";return v.toFixed(0);};
const initials=(name)=>name?name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase():"?";

/* PROJECT */
const EP={name:"",contract:"",pm:"",org:"",client:"",client_rep:"",scope:"",bac_currency:"USD",bac:"",rate:"",overhead:"",quantum:"",batna:"",pmis:"",schedule_tool:"",assignedPM:"",assignedTeam:""};
const PF=[
  {group:"General",fields:[{k:"name",l:"Nombre del Proyecto"},{k:"contract",l:"Contrato / ID"},{k:"pm",l:"PM (nombre)"},{k:"org",l:"Organización"},{k:"client",l:"Cliente"},{k:"scope",l:"Alcance / Frentes"}]},
  {group:"Financiero",fields:[{k:"bac_currency",l:"Moneda"},{k:"bac",l:"BAC"},{k:"rate",l:"Tarifa MOD / H-H"},{k:"overhead",l:"Overhead %"},{k:"quantum",l:"Quantum / Reclamación"},{k:"batna",l:"BATNA"}]},
  {group:"Herramientas",fields:[{k:"schedule_tool",l:"Herramienta cronograma"},{k:"pmis",l:"PMIS"}]},
];

/* T&T */
const TT={
  expertJudgment:{n:"Expert Judgment",t:"Técnica",how:"1. Identificar expertise necesario.\n2. Fuentes: equipo, consultores, asociaciones.\n3. Preparar contexto y preguntas.\n4. Conducir sesión.\n5. Integrar juicio con otros datos.\n6. Documentar razonamiento."},
  meetings:{n:"Meetings",t:"Técnica",how:"1. Convocar con objetivo + agenda ≥24 h antes.\n2. Designar facilitador y secretario.\n3. Apertura: objetivo + time-boxing.\n4. Facilitar participación equitativa.\n5. Cierre: acuerdos + acciones.\n6. Acta ≤24 h post-reunión."},
  dataGathering:{n:"Data Gathering",t:"Técnica",how:"BRAINSTORMING: generar → agrupar → priorizar.\nENTREVISTAS: preguntas abiertas → escuchar → documentar → validar ≤24 h.\nCUESTIONARIOS: Likert + preguntas abiertas → analizar."},
  dataAnalysis:{n:"Data Analysis",t:"Análisis",how:"ALTERNATIVES ANALYSIS: opciones → criterios ponderados → score=Σ(punt×peso) → seleccionar.\nVARIANCE ANALYSIS: real vs. plan → causa raíz → impacto → acción."},
  changeControlTools:{n:"Change Control Tools",t:"Herramienta",how:"FLUJO CCB:\n1. CR Form: número, descripción, impacto.\n2. CCB evalúa: impacto en baselines.\n3. Decisión: Aprobado/Rechazado/Diferido.\n4. Comunicar a stakeholders.\n5. Si aprobado: actualizar baselines.\n6. Registrar en Change Log."},
  pmis:{n:"PMIS",t:"Herramienta",how:"Módulos: Cronograma (CPM+baseline) · EVM (PV/EV/AC auto) · Repositorio (versionado+roles) · Issue Log+Change Log · Comunicaciones · Dashboard KPIs."},
  evm:{n:"Earned Value Management",t:"Herramienta",how:"PV=BAC×%Plan · EV=BAC×%Real · AC=Real\nCV=EV-AC · SV=EV-PV · CPI=EV/AC · SPI=EV/PV\nEAC=BAC/CPI · ETC=EAC-AC · VAC=BAC-EAC\nCPI<0.90→alerta · CPI<0.80→acción · SPI<0.85→alerta"},
  varianceAnalysis:{n:"Variance Analysis",t:"Análisis",how:"1. CV=EV-AC · SV=EV-PV.\n2. Comparar con umbrales del PMP.\n3. Causa raíz.\n4. Evaluar impacto.\n5. Acción: correctiva/preventiva/CR.\n6. Registrar en WPR."},
  trendAnalysis:{n:"Trend Analysis",t:"Análisis",how:"1. Graficar métrica de últimos 3-6 períodos.\n2. 3 períodos de deterioro = intervención.\n3. Correlacionar con eventos.\n4. Extrapolar desempeño futuro."},
  cpm:{n:"Critical Path Method",t:"Herramienta",how:"FORWARD: ES₁=0 · EF=ES+Dur · ES_suc=max(EF preds)\nBACKWARD: LF_last=EF_last · LS=LF-Dur · LF_pred=min(LS sucs)\nTF=LS-ES · FF=ES_suc-EF · CP: TF=0"},
  scheduleCompression:{n:"Schedule Compression",t:"Técnica",how:"CRASHING: (C_crash-C_normal)÷(D_normal-D_crash)→comprimir CP con menor costo.\nFAST-TRACKING: paralelizar FS→SS con lag mínimo. Aumenta riesgo."},
  rollingWave:{n:"Rolling Wave Planning",t:"Técnica",how:"0-4 sem: L4-L5 (≤3 días) · 5-12 sem: L3 (3-10 días) · 3-6 meses: L2 · >6 meses: L1.\nDetallar próximas 4 semanas en cada período."},
  agileSprintPlanning:{n:"Sprint Planning",t:"Técnica",how:"1. PO presenta backlog priorizado.\n2. Sprint Goal.\n3. Seleccionar por capacity.\n4. Capacity check.\n5. Descomponer ≤1 día.\n6. Commitment.\n7. Sprint Backlog publicado."},
  pert:{n:"Three-Point PERT",t:"Estimación",how:"E=(O+4M+P)÷6 · σ=(P-O)÷6\nE±σ→68% · E±2σ→95% · E±3σ→99.7%"},
  bottomUp:{n:"Bottom-Up Estimating",t:"Estimación",how:"1. Descomponer al WBS más bajo (≤80 H-H).\n2. MOD + Material + Equipo + Subcontrato.\n3. Overhead e indirectos.\n4. Sumar → proyecto.\n5. Contingencia (ΣEMV).\n6. BoE."},
  parametric:{n:"Parametric Estimating",t:"Estimación",how:"Costo=Cantidad×Tasa · Duración=Cantidad÷Productividad\nTasa validada → Calcular → Validar vs. bottom-up (>15%→revisar) → BoE."},
  reserveAnalysis:{n:"Reserve Analysis",t:"Análisis",how:"CONTINGENCIA (PMB): ΣEMV ó %BAC (5-10%/10-15%/15-25%). Autoridad: PM.\nRESERVA GESTIÓN (fuera PMB): 5-10% BAC. Autoridad: Sponsor."},
  qualityAudit:{n:"Quality Audit",t:"Técnica",how:"1. Plan: alcance+norma+checklist.\n2. Apertura: comunicar objetivo.\n3. Ejecución: entrevistas+documentos+campo.\n4. Hallazgos: C/NC/OB.\n5. Cierre: hallazgos+plazos.\n6. Informe ≤5 días.\n7. Seguimiento."},
  rootCause:{n:"Root Cause Analysis",t:"Técnica",how:"5 PORQUÉS: Problema→¿Por qué?(×3-5)→causa raíz→acción.\nISHIKAWA: efecto→6 espinas (Método/MOD/Material/Máquina/Medición/Medio)→brainstorming."},
  inspection:{n:"Inspection (ITP)",t:"Técnica",how:"HOLD(H): no continúa sin aprobación · WITNESS(W): inspector presente · REVIEW(R): documental.\nNotificar→preparar→verificar→evidencia fotográfica→C/NC/OB→NCR antes de corregir."},
  pxiMatrix:{n:"Probability × Impact Matrix",t:"Herramienta",how:"P: 0.10/0.20/0.40/0.60/0.80 · I: 0.05/0.10/0.20/0.40/0.80\nScore=P×I · ALTO≥0.24 · MEDIO 0.08-0.23 · BAJO<0.08"},
  emv:{n:"Expected Monetary Value",t:"Análisis",how:"EMV=P×Impacto · CONTINGENCIA: ΣEMV · ÁRBOL: mayor EMV · PRIORIDAD: desc."},
  monteCarlo:{n:"Monte Carlo Simulation",t:"Herramienta",how:"1. Variables inciertas con distribución.\n2. ≥1,000 iteraciones.\n3. P50=base · P80=conservador · P90=máxima reserva."},
  stakeholderAnalysis:{n:"Stakeholder Analysis",t:"Herramienta",how:"ALTO/ALTO→Gestionar de cerca · ALTO/BAJO→Mantener satisfecho\nBAJO/ALTO→Mantener informado · BAJO/BAJO→Monitorear\nRevaluar mensualmente."},
  engagementMatrix:{n:"Stakeholder Engagement Matrix",t:"Herramienta",how:"1-Desconocedor · 2-Resistente · 3-Neutral · 4-Partidario · 5-Líder\nMatriz: Actual | Deseado | Brecha | Acciones | Responsable | Fecha"},
  commReqAnalysis:{n:"Communication Requirements Analysis",t:"Análisis",how:"N=n×(n-1)÷2 canales.\nPor stakeholder: info, canal, idioma, frecuencia, confirmación.\nDocumentar solo necesidades reales."},
  raci:{n:"RACI Matrix",t:"Herramienta",how:"R=Responsable · A=Aprobador(SOLO UNO) · C=Consultado · I=Informado\nCada tarea: 1A+≥1R · Ninguno >8R simultáneos."},
  tuckman:{n:"Tuckman Ladder",t:"Técnica",how:"FORMING→DIRECTIVO · STORMING→COACH · NORMING→MENTOR · PERFORMING→FACILITADOR · ADJOURNING: reconocer."},
  groundRules:{n:"Ground Rules",t:"Técnica",how:"1. Sesión facilitada 60-90 min.\n2. Brainstorming comportamientos deseados.\n3. Agrupar por categoría.\n4. Seleccionar 7-10 reglas.\n5. Firmar en Team Charter.\n6. Revisar en retros."},
  riskResponse:{n:"Risk Response Strategies",t:"Técnica",how:"AMENAZAS: EVITAR · TRANSFERIR · MITIGAR · ACEPTAR ACTIVA · ACEPTAR PASIVA · ESCALAR.\nOPORTUNIDADES: EXPLOTAR · COMPARTIR · MEJORAR · ACEPTAR."},
  ai:{n:"Artificial Intelligence [PMBOK® 8]",t:"Herramienta",how:"AUTOMATIZACIÓN: tareas repetitivas.\nASISTENCIA: IA sugiere, humano decide. Etiquetar: 'Sugerencia IA — No vinculante'.\nAUGMENTACIÓN: amplifica capacidades.\nÉTICA: transparencia + supervisión humana."},
  decisionMaking:{n:"Decision Making — Multicriteria",t:"Técnica",how:"1. Opciones. 2. Criterios(4-7) pesos%(total=100%). 3. Calificar 1-10. 4. Score=Σ(calif×peso÷100). 5. Mayor score. 6. Documentar rationale."},
  processAutomations:{n:"Process Automation [PMBOK® 8]",t:"Herramienta",how:"BIM: BOM+clash detection+4D/5D.\nDOCUMENTAL: ITP desde WBS+alertas.\nANÁLISIS: NLP+detección riesgos.\nINTEGRACIÓN: PMIS↔EVM↔cronograma."},
  resourceOptimization:{n:"Resource Optimization",t:"Técnica",how:"LEVELING: sobreasignaciones→mover en holgura→puede extender duración.\nSMOOTHING: optimizar SIN extender→usa solo Free Float."},
  makeOrBuy:{n:"Make-or-Buy Analysis",t:"Análisis",how:"Evaluar: Costo · Calidad · IP · Disponibilidad · Riesgo · Regulaciones.\nDocumentar decisión → Procurement Plan."},
  sensitivity:{n:"Sensitivity Analysis — Tornado",t:"Análisis",how:"1. Variables inciertas. 2. Variar min→max. 3. Rango=I_max-I_min. 4. Ordenar desc. 5. Barras→tornado. 6. TOP 3-5."},
  decomp:{n:"Decomposition (WBS)",t:"Técnica",how:"1. L1→L4-L5. 2. Paquete: 8-80 H-H. 3. Regla 100%. 4. WBS Dictionary: código+descripción+entregable+criterio+responsable+costo."},
  projectCanvas:{n:"Project Canvas [PMBOK® 8]",t:"Herramienta",how:"PROPÓSITO | RESULTADO / STAKEHOLDERS | EQUIPO / RECURSOS | RIESGOS / SUPUESTOS | RESTRICCIONES\nSesión 60-90 min → alineación + base para el Charter."},
  networkAnalysis:{n:"Schedule Network Analysis",t:"Técnica",how:"CPM: ruta crítica (TF=0) · PERT: incertidumbre (O,M,P) · CCM: CP+restricciones+buffer.\nWhat-if: Si X retrasa N días→recalcular→nuevo fin."},
};
const TT_LIST=Object.entries(TT).map(([k,v])=>({k,...v}));
const TT_TYPES=["Todos","Técnica","Herramienta","Análisis","Estimación"];

/* DOMAINS */
const DOM=[
  {id:"D1",c:"GOV",n:"Governance",col:"#3A7BD5",cnt:9,desc:"Supervisión, autorización, control de cambios, calidad, conocimiento y cierre."},
  {id:"D2",c:"SCP",n:"Scope",col:"#E67E22",cnt:6,desc:"Requisitos, definición de alcance, WBS, validación y control."},
  {id:"D3",c:"SCH",n:"Schedule",col:"#9B59B6",cnt:3,desc:"Plan, desarrollo CPM+Scrumban y control del cronograma."},
  {id:"D4",c:"FIN",n:"Finance",col:"#14B8A6",cnt:4,desc:"Estimación, presupuesto y control de costos con EVM."},
  {id:"D5",c:"STK",n:"Stakeholders",col:"#1ABC9C",cnt:7,desc:"Identificación, compromiso, comunicaciones y monitoreo."},
  {id:"D6",c:"RES",n:"Resources",col:"#E74C3C",cnt:5,desc:"Plan, estimación, adquisición, liderazgo y control."},
  {id:"D7",c:"RSK",n:"Risk",col:"#F39C12",cnt:6,desc:"Plan, identificación, análisis, respuestas e implementación."},
];
const FAS={"Initiating":{bg:"#14B8A622",tx:"#14B8A6"},"Planning":{bg:"#3A7BD522",tx:"#8AB4F8"},"Executing":{bg:"#27AE6022",tx:"#6FCF97"},"Monitoring & Controlling":{bg:"#9B59B622",tx:"#C39BD3"},"Closing":{bg:"#E74C3C22",tx:"#E57373"}};

/* 40 PROCESSES */
const PR=[
  {id:"1.1",d:"D1",fa:"Initiating",n:"Initiate Project or Phase",pv:"Develop Project Charter",obj:"Autorizar formalmente el proyecto o fase, designar al PM con autoridad para asignar recursos.",tt:["projectCanvas","expertJudgment","dataGathering","meetings"],out:[{n:"Project Charter",tpl:["Project name & ID","Sponsor & PM authority","SMART objectives","Scope IN/OUT","Milestones","Budget","Constraints","Assumptions","Top risks","Approvals"]},{n:"Assumption Log",tpl:["ID","Assumption","Source","Owner","Impact if false","Validation date","Status"]}]},
  {id:"1.2",d:"D1",fa:"Planning",n:"Integrate and Align Project Plans",pv:"Develop Project Management Plan",obj:"Consolidar todos los planes subsidiarios en un PMP coherente e integrado.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Project Management Plan",tpl:["Scope Baseline","Schedule Baseline","Cost Baseline PMB","Quality Plan","Resource Plan","Risk Plan","Stakeholder Plan","Communications Plan","Change Plan","Tailoring decisions"]}]},
  {id:"1.3",d:"D1",fa:"Planning",n:"Plan Sourcing Strategy",pv:"Plan Procurement Management",obj:"Determinar qué necesidades se satisfacen externamente y documentar la estrategia de aprovisionamiento.",tt:["makeOrBuy","expertJudgment","dataAnalysis","meetings"],out:[{n:"Procurement Management Plan",tpl:["Make-or-buy decisions","Contract type","Vendor criteria","Timeline","Risk allocation","Approval authority","Inspection requirements"]}]},
  {id:"1.4",d:"D1",fa:"Executing",n:"Manage Project Execution",pv:"Direct and Manage Project Work",obj:"Liderar y ejecutar el trabajo del PMP para producir entregables, gestionar recursos y recopilar datos.",tt:["expertJudgment","pmis","meetings","groundRules"],out:[{n:"Deliverables",tpl:["Deliverable ID","WBS code","Description","Completion date","QC status","Acceptance status"]},{n:"Work Performance Data",tpl:["Date","Activity","Planned %","Actual %","H-H planned","H-H actual","Cost incurred","Issues","CRs"]},{n:"Issue Log",tpl:["ID","Date","Description","Domain","Priority","Owner","Due date","Status","Resolution"]}]},
  {id:"1.5",d:"D1",fa:"Executing",n:"Manage Quality Assurance",pv:"Manage Quality",obj:"Ejecutar las actividades del plan de calidad y auditar los procesos.",tt:["qualityAudit","rootCause","dataAnalysis","inspection"],out:[{n:"Quality Reports",tpl:["Audit ref","Date","Area","Standard","Inspector","Conformities","Non-conformities","Root cause","Corrective action","Owner","Target date","Status"]},{n:"Test and Evaluation Documents",tpl:["Test type","Standard","Date","Sample ID","Result","Inspector","Certificate#"]}]},
  {id:"1.6",d:"D1",fa:"Executing",n:"Manage Project Knowledge",pv:"Manage Project Knowledge",obj:"Utilizar conocimiento existente y crear conocimiento nuevo para lograr los objetivos del proyecto.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Lessons Learned Register",tpl:["ID","Phase","Category","Event","Cause","Impact","Lesson learned","Recommendation","Author","Date","Status"]}]},
  {id:"1.7",d:"D1",fa:"Monitoring & Controlling",n:"Monitor and Control Project Performance",pv:"Monitor and Control Project Work",obj:"Rastrear, revisar y reportar el progreso general para cumplir con los objetivos del PMP.",tt:["evm","varianceAnalysis","trendAnalysis","pmis","meetings"],out:[{n:"Work Performance Reports",tpl:["Period","CPI","SPI","EAC","ETC","Issues","Risks","CRs pending","Next milestones","Forecast"]},{n:"Change Requests",tpl:["CR#","Trigger","Type","Description","Impact analysis","Recommendation","Priority"]}]},
  {id:"1.8",d:"D1",fa:"Monitoring & Controlling",n:"Assess and Implement Changes",pv:"Perform Integrated Change Control",obj:"Revisar solicitudes de cambio, aprobar/rechazar/diferir cambios al baseline.",tt:["changeControlTools","expertJudgment","decisionMaking","meetings"],out:[{n:"Approved Change Requests",tpl:["CR#","Decision","CCB authorization","Date","Baseline update required"]},{n:"PM Plan Updates",tpl:["Plans updated","Version#","Date","Authorized by","Changes made"]}]},
  {id:"1.9",d:"D1",fa:"Closing",n:"Close Project or Phase",pv:"Close Project or Phase",obj:"Finalizar todas las actividades, completar el cierre administrativo, transferir entregables y capturar lecciones.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Final Report",tpl:["Project name","Period","Objectives achieved","Final cost","Final schedule","Quality metrics","Top 5 lessons","Open items","Sponsor sign-off"]},{n:"OPAs Updates",tpl:["Updated lessons learned DB","Updated templates","Updated procedures","Updated estimating data"]}]},
  {id:"2.1",d:"D2",fa:"Planning",n:"Plan Scope Management",pv:"Plan Scope Management",obj:"Crear un plan que documente cómo se definirá, validará y controlará el alcance.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Scope Management Plan",tpl:["How scope defined","How scope validated","How scope controlled","WBS approach","Change threshold"]},{n:"Requirements Management Plan",tpl:["How requirements collected","Prioritization","Traceability matrix approach","Changes to requirements"]}]},
  {id:"2.2",d:"D2",fa:"Planning",n:"Elicit and Analyze Requirements",pv:"Collect Requirements",obj:"Determinar, documentar y gestionar las necesidades y requisitos de los stakeholders.",tt:["dataGathering","dataAnalysis","processAutomations"],out:[{n:"Requirements Documentation",tpl:["Req. ID","Category","Source","Description","Priority","Acceptance criteria","Verification method","Status"]},{n:"Requirements Traceability Matrix",tpl:["Req. ID","WBS element","Drawing ref","Hold Point ITP","Test result","Acceptance status","Notes"]}]},
  {id:"2.3",d:"D2",fa:"Planning",n:"Define Scope",pv:"Define Scope",obj:"Desarrollar una descripción detallada del proyecto y del producto.",tt:["expertJudgment","decisionMaking","dataAnalysis"],out:[{n:"Project Scope Statement",tpl:["Product scope description","Deliverables IN scope","Exclusions OUT of scope","Acceptance criteria","Constraints","Assumptions","Project boundaries","Sign-offs"]}]},
  {id:"2.4",d:"D2",fa:"Planning",n:"Develop Scope Structure",pv:"Create WBS",obj:"Subdividir los entregables del proyecto en componentes manejables.",tt:["decomp","expertJudgment","agileSprintPlanning"],out:[{n:"Scope Baseline (WBS + Dictionary + Scope Statement)",tpl:["WBS Code","Work Package name","Level","Responsible","Description","Deliverable","Acceptance criteria","Duration estimate","Cost estimate","Dependencies"]}]},
  {id:"2.5",d:"D2",fa:"Monitoring & Controlling",n:"Monitor and Control Scope",pv:"Control Scope",obj:"Monitorear el estado del alcance, gestionar cambios e identificar y prevenir el scope creep.",tt:["varianceAnalysis","trendAnalysis"],out:[{n:"Work Performance Information (Scope)",tpl:["WBS element","Baseline scope","Actual scope","Variance description","Cause","Action","CR raised"]},{n:"Change Requests (scope)",tpl:["CR#","Scope change","Requested by","Cost impact","Schedule impact","Recommendation"]}]},
  {id:"2.6",d:"D2",fa:"Monitoring & Controlling",n:"Validate Scope",pv:"Validate Scope",obj:"Formalizar la aceptación de los entregables completados obteniendo la firma del cliente.",tt:["inspection","decisionMaking"],out:[{n:"Accepted Deliverables",tpl:["Deliverable ID","WBS code","Acceptance criteria met Y/N","Client reviewer","Date","Conditions","Authorization signature"]}]},
  {id:"3.1",d:"D3",fa:"Planning",n:"Plan Schedule Management",pv:"Plan Schedule Management",obj:"Establecer políticas y procedimientos para planificar, desarrollar, gestionar y controlar el cronograma.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Schedule Management Plan",tpl:["Scheduling methodology","Tool","Level of detail","Units","Estimation approach","Control thresholds SPI","Reporting format","Sprint cadence"]}]},
  {id:"3.2",d:"D3",fa:"Planning",n:"Develop Schedule",pv:"Develop Schedule",obj:"Analizar secuencias, duraciones, recursos y restricciones para crear el modelo de cronograma.",tt:["networkAnalysis","cpm","scheduleCompression","rollingWave","agileSprintPlanning","pert","resourceOptimization"],out:[{n:"Project Schedule",tpl:["Activity ID","Name","WBS","Predecessors","Duration","Effort H-H","Resource","ES","EF","LS","LF","Total Float","Critical Y/N"]},{n:"Schedule Baseline",tpl:["Baseline version","Approval date","Milestone schedule","S-Curve PV data","Critical path duration"]}]},
  {id:"3.3",d:"D3",fa:"Monitoring & Controlling",n:"Monitor and Control Schedule",pv:"Control Schedule",obj:"Monitorear el estado del cronograma, actualizar el schedule baseline, gestionar cambios e identificar delays.",tt:["evm","cpm","scheduleCompression","varianceAnalysis","trendAnalysis"],out:[{n:"Schedule Forecasts",tpl:["Forecast completion date per milestone","Delay summary","Recovery actions","Evidence base"]},{n:"Change Requests — Schedule",tpl:["CR#","Delay days","Cause classification","Responsibility","Cost impact","Evidence"]}]},
  {id:"4.1",d:"D4",fa:"Planning",n:"Plan Financial Management",pv:"Plan Cost Management",obj:"Establecer políticas y procedimientos para planificar, gestionar y controlar los costos.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Financial Management Plan",tpl:["Estimating methodology","Level of accuracy","Control thresholds CPI","EVM configuration","Reporting format","Claims tracking policy"]}]},
  {id:"4.2",d:"D4",fa:"Planning",n:"Estimate Costs",pv:"Estimate Costs",obj:"Desarrollar una aproximación de los recursos monetarios necesarios para completar las actividades.",tt:["parametric","bottomUp","pert","reserveAnalysis"],out:[{n:"Cost Estimates",tpl:["WBS code","Work Package","H-H","H-H rate","Labor cost","Material","Equipment","Subcontract","Overhead %","Contingency %","Total","Method","Confidence"]},{n:"Basis of Estimates",tpl:["Method","Basis and assumptions","Confidence range","Constraints","Risk quantification"]}]},
  {id:"4.3",d:"D4",fa:"Planning",n:"Develop Budget",pv:"Determine Budget",obj:"Agregar los costos estimados para establecer la línea base de costos autorizada (PMB).",tt:["reserveAnalysis","expertJudgment"],out:[{n:"Cost Baseline — PMB (S-Curve)",tpl:["Period","PV period","PV cumulative","BAC","Contingency Reserve","Management Reserve"]},{n:"Project Funding Requirements",tpl:["Period","Funding required","Source","Expected receipt","Actual receipt","Gap","Actions"]}]},
  {id:"4.4",d:"D4",fa:"Monitoring & Controlling",n:"Monitor and Control Finances",pv:"Control Costs",obj:"Monitorear el estado financiero del proyecto para actualizar los costos y gestionar cambios al cost baseline.",tt:["evm","trendAnalysis","varianceAnalysis","dataAnalysis"],out:[{n:"Cost Forecasts",tpl:["Period","EAC","ETC","VAC","TCPI","Forecast completion cost","Cause of variance","Actions"]},{n:"EVM Report",tpl:["Period","BAC","PV","EV","AC","CV","SV","CPI","SPI","EAC","ETC","VAC","TCPI"]}]},
  {id:"5.1",d:"D5",fa:"Initiating",n:"Identify Stakeholders",pv:"Identify Stakeholders",obj:"Identificar regularmente a todos los interesados del proyecto y analizar sus intereses e impacto.",tt:["stakeholderAnalysis","dataGathering","expertJudgment","meetings"],out:[{n:"Stakeholder Register",tpl:["ID","Name","Org/Role","Contact","Type","Interest","Power H/M/L","Current engagement 1-5","Desired engagement 1-5","Strategy","Channel","Owner"]}]},
  {id:"5.2",d:"D5",fa:"Planning",n:"Plan Stakeholder Engagement",pv:"Plan Stakeholder Engagement",obj:"Desarrollar enfoques para involucrar a los stakeholders.",tt:["engagementMatrix","expertJudgment","dataAnalysis"],out:[{n:"Stakeholder Engagement Plan",tpl:["Stakeholder","Current level","Desired level","Gap","Approach","Frequency","Channel","Owner","Target date"]}]},
  {id:"5.3",d:"D5",fa:"Planning",n:"Plan Communications Management",pv:"Plan Communications Management",obj:"Desarrollar el plan para las actividades de comunicación.",tt:["commReqAnalysis","dataAnalysis"],out:[{n:"Communications Management Plan",tpl:["Stakeholder","Information","Format/medium","Frequency","Channel","Sender","Approval required","Storage","Confirmation of receipt"]}]},
  {id:"5.4",d:"D5",fa:"Executing",n:"Manage Stakeholder Engagement",pv:"Manage Stakeholder Engagement",obj:"Comunicarse y trabajar con los stakeholders para satisfacer sus necesidades.",tt:["meetings","groundRules"],out:[{n:"Stakeholder Engagement Log",tpl:["Date","Stakeholder","Interaction type","Topic/Purpose","Key decisions","Actions committed","Owner","Due date"]}]},
  {id:"5.5",d:"D5",fa:"Executing",n:"Manage Communications",pv:"Manage Communications",obj:"Asegurar la recolección, creación, distribución, almacenamiento y gestión oportuna de la información.",tt:["pmis","dataAnalysis"],out:[{n:"Project Communications Log",tpl:["Document","Reference#","Date","Sender","Recipients","Channel","Archive location","Acknowledgement required","Received"]}]},
  {id:"5.6",d:"D5",fa:"Monitoring & Controlling",n:"Monitor Stakeholder Engagement",pv:"Monitor Stakeholder Engagement",obj:"Monitorear las relaciones con los stakeholders y adaptar las estrategias.",tt:["engagementMatrix","dataAnalysis","meetings"],out:[{n:"Stakeholder Re-Assessment",tpl:["Stakeholder","Previous level","Current level","Change","Cause","Required level","Gap","Actions","Owner","Target date"]}]},
  {id:"5.7",d:"D5",fa:"Monitoring & Controlling",n:"Monitor Communications",pv:"Monitor Communications",obj:"Monitorear y controlar las comunicaciones para asegurar que las necesidades sean satisfechas.",tt:["dataAnalysis","pmis","expertJudgment"],out:[{n:"Communications Effectiveness Review",tpl:["Communication type","Planned freq","Actual freq","Response rate %","Effectiveness 1-5","Issues identified","Actions"]}]},
  {id:"6.1",d:"D6",fa:"Planning",n:"Plan Resource Management",pv:"Plan Resource Management",obj:"Definir cómo estimar, adquirir, gestionar y utilizar los recursos del proyecto.",tt:["raci","expertJudgment","meetings"],out:[{n:"Resource Management Plan",tpl:["Resource acquisition strategy","RACI roles & responsibilities","Training plan","Resource control thresholds"]},{n:"Team Charter",tpl:["Team mission","Members & roles","Values","Norms","Communication protocols","Decision-making authority","Signature"]}]},
  {id:"6.2",d:"D6",fa:"Planning",n:"Estimate Resources",pv:"Estimate Activity Resources",obj:"Estimar los tipos y cantidades de recursos humanos y físicos necesarios.",tt:["parametric","bottomUp","ai","expertJudgment"],out:[{n:"Resource Requirements",tpl:["Activity/WBS","Resource type","Quantity","Unit","Duration","Total H-H","Source","Cost","Notes"]},{n:"Resource Breakdown Structure",tpl:["L1 Project","L2 Category","L3 Type","L4 Specific resource"]}]},
  {id:"6.3",d:"D6",fa:"Executing",n:"Acquire Resources",pv:"Acquire Resources",obj:"Obtener los miembros del equipo, equipos, materiales y otros recursos necesarios.",tt:["decisionMaking","meetings"],out:[{n:"Project Team Assignments",tpl:["Role","Name","Organization","Start date","End date","Allocation %","Location","Cost rate","Skills confirmed"]}]},
  {id:"6.4",d:"D6",fa:"Executing",n:"Lead the Team",pv:"Develop Team + Manage Team",obj:"Monitorear el desempeño del equipo, proporcionar retroalimentación y gestionar cambios.",tt:["tuckman","groundRules","meetings","ai"],out:[{n:"Team Performance Assessments",tpl:["Team/Member","Role","Period","Technical 1-5","Schedule adherence","Quality","Collaboration","Overall","Strengths","Dev areas","Actions"]}]},
  {id:"6.5",d:"D6",fa:"Monitoring & Controlling",n:"Monitor and Control Resourcing",pv:"Control Resources",obj:"Asegurar que los recursos asignados estén disponibles según lo planificado.",tt:["varianceAnalysis","trendAnalysis","resourceOptimization","pmis"],out:[{n:"Resource Utilization Report",tpl:["Period","Resource","Planned H-H","Actual H-H","Variance","Utilization %","Stand-by flag","Issue description","Action taken"]}]},
  {id:"7.1",d:"D7",fa:"Planning",n:"Plan Risk Management",pv:"Plan Risk Management",obj:"Definir cómo conducir las actividades de gestión de riesgos.",tt:["expertJudgment","dataAnalysis","meetings"],out:[{n:"Risk Management Plan",tpl:["Methodology","Roles & responsibilities","Risk categories RBS","Probability scale","Impact scale","P×I matrix","Risk appetite","Thresholds","Reserve policy"]}]},
  {id:"7.2",d:"D7",fa:"Planning",n:"Identify Risks",pv:"Identify Risks",obj:"Identificar los riesgos individuales del proyecto y las fuentes de riesgo general.",tt:["dataGathering","expertJudgment"],out:[{n:"Risk Register",tpl:["Risk ID","Category","Description","Trigger","Cause","Probability","Impact","Score P×I","EMV","Owner","Response strategy","Response actions","Contingency plan","Fallback","Residual risk","Reserve","Status"]},{n:"Risk Report",tpl:["Overall exposure","Top risks summary","Risk trends","Quantitative results","Reserve adequacy"]}]},
  {id:"7.3",d:"D7",fa:"Planning",n:"Perform Risk Analysis",pv:"Qualitative + Quantitative Risk Analysis",obj:"Priorizar riesgos evaluando probabilidad e impacto.",tt:["pxiMatrix","emv","monteCarlo","sensitivity","dataGathering"],out:[{n:"Risk Register Updates",tpl:["Risk ID","Score","Priority H/M/L","EMV","Quantitative method","Revised probability","Revised impact","Analysis date"]},{n:"Risk Report Updates",tpl:["Overall exposure","Top risks","Quantitative results","Reserve adequacy"]}]},
  {id:"7.4",d:"D7",fa:"Planning",n:"Plan Risk Responses",pv:"Plan Risk Responses",obj:"Desarrollar opciones, seleccionar estrategias y acordar acciones para abordar la exposición al riesgo.",tt:["riskResponse","decisionMaking","expertJudgment"],out:[{n:"Risk Response Plan",tpl:["Risk ID","Strategy","Specific actions","Owner","Contingency reserve","Fallback plan","Trigger condition","Post-response score"]}]},
  {id:"7.5",d:"D7",fa:"Executing",n:"Implement Risk Responses",pv:"Implement Risk Responses",obj:"Implementar los planes de respuesta a riesgos acordados.",tt:["expertJudgment","pmis","meetings"],out:[{n:"Risk Response Log",tpl:["Risk ID","Action","Owner","Planned date","Actual date","Status","Effectiveness","Residual risk","Next action"]},{n:"Change Requests",tpl:["CR# triggered by risk","Description","Impact on baselines"]}]},
  {id:"7.6",d:"D7",fa:"Monitoring & Controlling",n:"Monitor Risks",pv:"Monitor Risks",obj:"Monitorear la implementación de las respuestas, rastrear riesgos e identificar nuevos.",tt:["qualityAudit","reserveAnalysis","trendAnalysis","meetings"],out:[{n:"Risk Monitoring Report",tpl:["Period","Total risks","High priority active","Closed","New risks","Top 5 risks","Reserve status","SPI trend","CPI trend","Actions","Next review"]},{n:"Change Requests",tpl:["CR# triggered by risk monitoring","Description","Urgency"]}]},
];

/* ══ INPUTS — PMBOK® 8 (por proceso) ═══════════════════════
   Formato: "@X.Y Nombre" = output del proceso X.Y · "Nombre" = input externo/genérico
   EEF = Enterprise Environmental Factors · OPA = Organizational Process Assets */
const PR_IN={
"1.1":["Business Case","Benefits Management Plan","Agreements","EEF","OPA"],
"1.2":["@1.1 Project Charter","Outputs de planes subsidiarios (cada proceso de planificación alimenta el PMP)","Business Documents","Agreements","EEF","OPA"],
"1.3":["@1.1 Project Charter","Business Documents","@1.2 Project Management Plan","@2.2 Requirements Documentation","@3.2 Milestone List","@6.2 Resource Requirements","@7.2 Risk Register","@5.1 Stakeholder Register","EEF","OPA"],
"1.4":["@1.2 Project Management Plan","@1.8 Approved Change Requests","@5.4 Change Log","@1.6 Lessons Learned Register","@3.2 Milestone List","@2.2 Requirements Documentation","@7.2 Risk Register","@5.1 Stakeholder Register","EEF","OPA"],
"1.5":["@1.2 Quality Management Plan","@1.6 Lessons Learned Register","Quality Metrics","@7.2 Risk Report","Quality Control Measurements","@1.4 Work Performance Data"],
"1.6":["@1.2 Project Management Plan","@1.6 Lessons Learned Register (previo)","@6.3 Project Team Assignments","Resource Breakdown Structure","@5.1 Stakeholder Register","@1.4 Deliverables","EEF","OPA"],
"1.7":["@1.2 Project Management Plan","@1.1 Assumption Log","@4.2 Basis of Estimates","@4.4 Cost Forecasts","@1.4 Issue Log","@1.6 Lessons Learned Register","@3.2 Milestone List","@1.5 Quality Reports","@7.2 Risk Register","@7.2 Risk Report","@3.3 Schedule Forecasts","Work Performance Information","Agreements","EEF","OPA"],
"1.8":["@1.2 Project Management Plan (Change Mgmt Plan)","@4.2 Basis of Estimates","@2.2 Requirements Traceability Matrix","@7.2 Risk Report","@1.7 Work Performance Reports","Change Requests (consolidadas de procesos M&C)","EEF","OPA"],
"1.9":["@1.1 Project Charter","@1.2 Project Management Plan","@1.1 Assumption Log","@4.2 Basis of Estimates","@5.4 Change Log","@1.4 Issue Log","@1.6 Lessons Learned Register","@3.2 Milestone List","@5.5 Project Communications","Quality Control Measurements","@1.5 Quality Reports","@2.2 Requirements Documentation","@7.2 Risk Register","@7.2 Risk Report","@2.6 Accepted Deliverables","Business Documents","Agreements","Procurement Documentation","OPA"],
"2.1":["@1.1 Project Charter","@1.2 Project Management Plan (Quality Mgmt, Lifecycle, Development Approach)","EEF","OPA"],
"2.2":["@1.1 Project Charter","@2.1 Scope Management Plan","@2.1 Requirements Management Plan","@5.2 Stakeholder Engagement Plan","@1.1 Assumption Log","@1.6 Lessons Learned Register","@5.1 Stakeholder Register","Business Documents","Agreements","EEF","OPA"],
"2.3":["@1.1 Project Charter","@2.1 Scope Management Plan","@1.1 Assumption Log","@2.2 Requirements Documentation","@7.2 Risk Register","EEF","OPA"],
"2.4":["@2.1 Scope Management Plan","@2.3 Project Scope Statement","@2.2 Requirements Documentation","EEF","OPA"],
"2.5":["@1.2 Project Management Plan (Scope, Requirements, Change, Config, Scope Baseline, PMB)","@1.6 Lessons Learned Register","@2.2 Requirements Documentation","@2.2 Requirements Traceability Matrix","@1.4 Work Performance Data","OPA"],
"2.6":["@1.2 Project Management Plan (Scope, Requirements, Scope Baseline)","@1.6 Lessons Learned Register","@1.5 Quality Reports","@2.2 Requirements Documentation","@2.2 Requirements Traceability Matrix","Verified Deliverables (del proceso de QC)","@1.4 Work Performance Data"],
"3.1":["@1.1 Project Charter","@2.1 Scope Management Plan","@1.2 Development Approach","EEF","OPA"],
"3.2":["@3.1 Schedule Management Plan","@2.4 Scope Baseline","Activity Attributes","Activity List","@1.1 Assumption Log","@4.2 Basis of Estimates","Duration Estimates","@1.6 Lessons Learned Register","@3.2 Milestone List","Project Schedule Network Diagrams","@6.3 Project Team Assignments","Resource Calendars","@6.2 Resource Requirements","@7.2 Risk Register","Agreements","EEF","OPA"],
"3.3":["@1.2 Project Management Plan (Schedule, Baseline, Scope Baseline, PMB)","@1.6 Lessons Learned Register","Project Calendars","@3.2 Project Schedule","Resource Calendars","Schedule Data","@1.4 Work Performance Data","OPA"],
"4.1":["@1.1 Project Charter","@3.1 Schedule Management Plan","@7.1 Risk Management Plan","EEF","OPA"],
"4.2":["@4.1 Financial/Cost Management Plan","@1.2 Quality Management Plan","@2.4 Scope Baseline","@1.6 Lessons Learned Register","@3.2 Project Schedule","@6.2 Resource Requirements","@7.2 Risk Register","EEF","OPA"],
"4.3":["@4.1 Cost Management Plan","@6.1 Resource Management Plan","@2.4 Scope Baseline","@4.2 Basis of Estimates","@4.2 Cost Estimates","@3.2 Project Schedule","@7.2 Risk Register","Business Documents","Agreements","EEF","OPA"],
"4.4":["@1.2 Project Management Plan (Cost Mgmt, Cost Baseline, PMB)","@1.6 Lessons Learned Register","@4.3 Project Funding Requirements","@1.4 Work Performance Data","OPA"],
"5.1":["@1.1 Project Charter","Business Documents","@1.2 Communications Management Plan","@5.2 Stakeholder Engagement Plan","@5.4 Change Log","@1.4 Issue Log","@2.2 Requirements Documentation","Agreements","EEF","OPA"],
"5.2":["@1.1 Project Charter","@6.1 Resource Management Plan","@5.3 Communications Management Plan","@7.1 Risk Management Plan","@1.1 Assumption Log","@5.4 Change Log","@1.4 Issue Log","@3.2 Project Schedule","@7.2 Risk Register","@5.1 Stakeholder Register","Agreements","EEF","OPA"],
"5.3":["@1.1 Project Charter","@6.1 Resource Management Plan","@5.2 Stakeholder Engagement Plan","@2.2 Requirements Documentation","@5.1 Stakeholder Register","EEF","OPA"],
"5.4":["@5.3 Communications Management Plan","@7.1 Risk Management Plan","@5.2 Stakeholder Engagement Plan","@1.2 Change Management Plan","@5.4 Change Log (previo)","@1.4 Issue Log","@1.6 Lessons Learned Register","@5.1 Stakeholder Register","EEF","OPA"],
"5.5":["@6.1 Resource Management Plan","@5.3 Communications Management Plan","@5.2 Stakeholder Engagement Plan","@5.4 Change Log","@1.4 Issue Log","@1.6 Lessons Learned Register","@1.5 Quality Report","@7.2 Risk Report","@5.1 Stakeholder Register","@1.7 Work Performance Reports","EEF","OPA"],
"5.6":["@6.1 Resource Management Plan","@5.3 Communications Management Plan","@5.2 Stakeholder Engagement Plan","@1.4 Issue Log","@1.6 Lessons Learned Register","@5.5 Project Communications","@7.2 Risk Register","@5.1 Stakeholder Register","@1.4 Work Performance Data","EEF","OPA"],
"5.7":["@6.1 Resource Management Plan","@5.3 Communications Management Plan","@5.2 Stakeholder Engagement Plan","@1.4 Issue Log","@1.6 Lessons Learned Register","@5.5 Project Communications","@1.4 Work Performance Data","EEF","OPA"],
"6.1":["@1.1 Project Charter","@1.2 Quality Management Plan","@2.4 Scope Baseline","@3.2 Project Schedule","@2.2 Requirements Documentation","@7.2 Risk Register","@5.1 Stakeholder Register","EEF","OPA"],
"6.2":["@6.1 Resource Management Plan","@2.4 Scope Baseline","Activity Attributes","Activity List","@1.1 Assumption Log","@4.2 Cost Estimates","Resource Calendars","@7.2 Risk Register","EEF","OPA"],
"6.3":["@6.1 Resource Management Plan","@1.3 Procurement Management Plan","@4.3 Cost Baseline","@3.2 Project Schedule","Resource Calendars","@6.2 Resource Requirements","@5.1 Stakeholder Register","EEF","OPA"],
"6.4":["@6.1 Resource Management Plan","@1.6 Lessons Learned Register","@6.3 Project Team Assignments","Resource Calendars","@6.1 Team Charter","@1.4 Issue Log","@1.7 Work Performance Reports","Team Performance Assessments (período previo)","EEF","OPA"],
"6.5":["@6.1 Resource Management Plan","@1.4 Issue Log","@1.6 Lessons Learned Register","Physical Resource Assignments","@3.2 Project Schedule","Resource Breakdown Structure","@6.2 Resource Requirements","@7.2 Risk Register","@1.4 Work Performance Data","Agreements","OPA"],
"7.1":["@1.1 Project Charter","@1.2 Project Management Plan (todos los componentes)","@5.1 Stakeholder Register","EEF","OPA"],
"7.2":["@1.2 Project Management Plan (todos los planes y baselines)","@1.1 Assumption Log","@4.2 Cost Estimates","Duration Estimates","@1.4 Issue Log","@1.6 Lessons Learned Register","@2.2 Requirements Documentation","@6.2 Resource Requirements","@5.1 Stakeholder Register","Agreements","Procurement Documentation","EEF","OPA"],
"7.3":["@7.1 Risk Management Plan","@2.4 Scope Baseline","@3.2 Schedule Baseline","@4.3 Cost Baseline","@1.1 Assumption Log","@7.2 Risk Register","@7.2 Risk Report","@5.1 Stakeholder Register","@4.2 Basis of Estimates","@4.2 Cost Estimates","Duration Estimates","@3.2 Milestone List","@6.2 Resource Requirements","EEF","OPA"],
"7.4":["@6.1 Resource Management Plan","@7.1 Risk Management Plan","@4.3 Cost Baseline","@1.6 Lessons Learned Register","@3.2 Project Schedule","@6.3 Project Team Assignments","Resource Calendars","@7.2 Risk Register","@7.2 Risk Report","@5.1 Stakeholder Register","EEF","OPA"],
"7.5":["@7.1 Risk Management Plan","@1.6 Lessons Learned Register","@7.2 Risk Register","@7.2 Risk Report","OPA"],
"7.6":["@7.1 Risk Management Plan","@1.4 Issue Log","@1.6 Lessons Learned Register","@7.2 Risk Register","@7.2 Risk Report","@1.4 Work Performance Data","@1.7 Work Performance Reports"]
};

const CLC={"IN":"#14B8A6","PL":"#3A7BD5","EX":"#27AE60","MC":"#9B59B6","CL":"#E74C3C"};
const CLL={"IN":"Initiating","PL":"Planning","EX":"Executing","MC":"Mon. & Ctrl","CL":"Closing"};
const TP_LBL={"t":"Texto","ta":"Párrafo","d":"Fecha","n":"Número","tbl":"Tabla"};
const TP_CLS={"t":"tft-t","ta":"tft-ta","d":"tft-d","n":"tft-n","tbl":"tft-tbl"};

const TPL=[
  {id:"charter",n:"Project Charter",cat:"IN",pr:["1.1"],pur:"Autoriza formalmente el proyecto.",wh:"Antes de cualquier planificación formal.",ap:"Sponsor",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"ID / Código",tp:"t",r:1},{n:"Fecha",tp:"d",r:1},{n:"Preparado por",tp:"t",r:1},{n:"Aprobado por (Sponsor)",tp:"t",r:1}]},{t:"2. Autoridad del PM",f:[{n:"Nombre del PM designado",tp:"t",r:1},{n:"Autoridad presupuesto",tp:"t",r:1},{n:"Autoridad recursos y decisiones técnicas",tp:"ta",r:1}]},{t:"3. Descripción y Objetivos",f:[{n:"Descripción Ejecutiva",tp:"ta",r:1},{n:"Justificación de Negocio",tp:"ta",r:1},{n:"Objetivo Principal SMART",tp:"ta",r:1},{n:"Criterios de Éxito",tp:"ta",r:1}]},{t:"4. Alcance",f:[{n:"IN Scope",tp:"ta",r:1},{n:"OUT of Scope",tp:"ta",r:1}]},{t:"5. Cronograma y Presupuesto",f:[{n:"Hitos principales",tp:"tbl",r:1},{n:"Fecha de Inicio",tp:"d",r:1},{n:"Fecha Fin Planificada",tp:"d",r:1},{n:"BAC",tp:"n",r:1},{n:"Moneda",tp:"t",r:1}]},{t:"6. Restricciones, Supuestos y Riesgos",f:[{n:"Restricciones",tp:"ta",r:1},{n:"Supuestos",tp:"ta",r:1},{n:"Riesgos de alto nivel",tp:"ta",r:1}]}]},
  {id:"pmp",n:"Project Management Plan",cat:"PL",pr:["1.2"],pur:"Documento integrador de cómo se ejecutará, monitoreará y cerrará el proyecto.",wh:"Aprobado antes de iniciar la ejecución.",ap:"Sponsor / CCB",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"PM Responsable",tp:"t",r:1},{n:"Versión del PMP",tp:"t",r:1},{n:"Fecha Baseline",tp:"d",r:1}]},{t:"2. Tailoring y Planes Subsidiarios",f:[{n:"Ciclo de vida",tp:"t",r:1},{n:"Decisiones de tailoring",tp:"ta",r:1},{n:"Scope Management Plan",tp:"t",r:1},{n:"Schedule Management Plan",tp:"t",r:1},{n:"Financial Management Plan",tp:"t",r:1},{n:"Risk Management Plan",tp:"t",r:1},{n:"Resource Management Plan",tp:"t",r:1}]},{t:"3. Baselines y Umbrales",f:[{n:"Scope Baseline",tp:"t",r:1},{n:"Schedule Baseline",tp:"t",r:1},{n:"Cost Baseline / PMB",tp:"t",r:1},{n:"Umbrales SPI",tp:"t",r:1},{n:"Umbrales CPI",tp:"t",r:1}]}]},
  {id:"scope_stmt",n:"Project Scope Statement",cat:"PL",pr:["2.3"],pur:"Establece qué está dentro y fuera del alcance.",wh:"Parte del scope baseline.",ap:"Sponsor / PM",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"Versión / Fecha",tp:"d",r:1}]},{t:"2. Producto y Entregables",f:[{n:"Descripción del producto/servicio/resultado",tp:"ta",r:1},{n:"Criterios de aceptación del producto",tp:"ta",r:1},{n:"Lista de entregables IN SCOPE",tp:"ta",r:1}]},{t:"3. Exclusiones y Restricciones",f:[{n:"OUT of Scope — exclusiones explícitas",tp:"ta",r:1},{n:"Supuestos del alcance",tp:"ta",r:1},{n:"Restricciones del alcance",tp:"ta",r:1}]}]},
  {id:"risk_reg",n:"Risk Register",cat:"PL",pr:["7.2","7.3","7.4","7.6"],pur:"Repositorio central de todos los riesgos identificados.",wh:"Iniciado al identificar riesgos.",ap:"PM",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"Versión / Fecha",tp:"d",r:1}]},{t:"2. Registro",f:[{n:"Tabla de riesgos (ID, categoría, P, I, score, EMV, estrategia, estado)",tp:"tbl",r:1}]},{t:"3. Resumen",f:[{n:"Total riesgos",tp:"n",r:1},{n:"Riesgos ALTO",tp:"n",r:1},{n:"Riesgos MEDIO",tp:"n",r:1},{n:"EMV total",tp:"n",r:1}]}]},
  {id:"wpr",n:"Work Performance Report (EVM)",cat:"MC",pr:["1.7","3.3","4.4"],pur:"Reporte integrado de desempeño: EVM + cronograma + calidad + riesgos.",wh:"Quincenal o mensual.",ap:"PM",secs:[{t:"1. Identificación y Resumen",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"Período del reporte",tp:"t",r:1},{n:"Fecha",tp:"d",r:1},{n:"Estado general",tp:"t",r:1},{n:"Logros del período",tp:"ta",r:1},{n:"Problemas críticos",tp:"ta",r:1}]},{t:"2. Métricas EVM",f:[{n:"BAC",tp:"n",r:1},{n:"PV",tp:"n",r:1},{n:"EV",tp:"n",r:1},{n:"AC",tp:"n",r:1},{n:"CV",tp:"n",r:1},{n:"SV",tp:"n",r:1},{n:"CPI",tp:"n",r:1},{n:"SPI",tp:"n",r:1},{n:"EAC",tp:"n",r:1},{n:"ETC",tp:"n",r:1},{n:"VAC",tp:"n",r:1}]},{t:"3. Issues y Proyección",f:[{n:"Estado de hitos",tp:"tbl",r:1},{n:"Top issues",tp:"tbl",r:1},{n:"CRs pendientes",tp:"tbl",r:1},{n:"Proyección al cierre",tp:"ta",r:1}]}]},
  {id:"change_req",n:"Change Request Form",cat:"MC",pr:["1.8","2.5","3.3","4.4","7.5","7.6"],pur:"Solicitar formalmente una modificación al scope, cronograma, costos u otros componentes.",wh:"Cada vez que se propone un cambio.",ap:"CCB / PM",secs:[{t:"1. Identificación",f:[{n:"Número CR",tp:"t",r:1},{n:"Fecha",tp:"d",r:1},{n:"Solicitante",tp:"t",r:1},{n:"Nombre del Proyecto",tp:"t",r:1}]},{t:"2. Descripción e Impacto",f:[{n:"Tipo",tp:"t",r:1},{n:"Área(s) afectada(s)",tp:"t",r:1},{n:"Descripción detallada del cambio",tp:"ta",r:1},{n:"Justificación",tp:"ta",r:1},{n:"Impacto en alcance",tp:"ta",r:1},{n:"Impacto en cronograma",tp:"t",r:1},{n:"Impacto en costo",tp:"t",r:1}]},{t:"3. Decisión CCB",f:[{n:"Decisión",tp:"t",r:1},{n:"Justificación",tp:"ta",r:1},{n:"Fecha de decisión",tp:"d",r:1},{n:"Firmas CCB",tp:"tbl",r:1}]}]},
  {id:"ll_reg",n:"Lessons Learned Register",cat:"EX",pr:["1.6","1.9"],pur:"Documentar conocimiento adquirido.",wh:"Actualizado continuamente.",ap:"PM",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"Versión / Fecha",tp:"d",r:1}]},{t:"2. Registro",f:[{n:"Tabla de lecciones aprendidas",tp:"tbl",r:1}]},{t:"3. OPA Updates",f:[{n:"Plantillas a actualizar",tp:"ta",r:0},{n:"Benchmarks actualizados",tp:"ta",r:0}]}]},
  {id:"issue_log",n:"Issue Log",cat:"EX",pr:["1.4","5.4"],pur:"Registrar, monitorear y gestionar issues.",wh:"Actualizar en cada reunión.",ap:"PM",secs:[{t:"1. Identificación",f:[{n:"Nombre del Proyecto",tp:"t",r:1},{n:"Versión / Fecha",tp:"d",r:1}]},{t:"2. Registro",f:[{n:"Tabla de issues",tp:"tbl",r:1}]},{t:"3. Resumen",f:[{n:"Issues abiertos",tp:"n",r:1},{n:"Issues críticos/altos",tp:"n",r:1},{n:"Issues vencidos",tp:"n",r:1}]}]},
];

/* ══ OUTPUT TEMPLATES — PMBOK® Guide 8th Edition ════════════ */
const OUT_TPL={
"1.1_0":`# PROJECT CHARTER
**Proyecto:** {{name}}  |  **Código:** {{contract}}  |  **Fecha:** {{date}}
**PM designado:** {{pm}}  |  **Sponsor:** {{client}}  |  **Organización:** {{org}}

## 1. Propósito y Justificación del Proyecto
[Describir el problema u oportunidad de negocio que justifica el proyecto. Vincular con objetivos estratégicos.]

## 2. Objetivos SMART
- Obj 1: [Specific / Measurable / Achievable / Relevant / Time-bound]
- Obj 2: …
- Obj 3: …

## 3. Alcance de Alto Nivel
**IN SCOPE:** [Entregables principales incluidos]
**OUT OF SCOPE:** [Exclusiones explícitas]

## 4. Requisitos de Alto Nivel
- Requisito 1 (funcional / técnico / de calidad)
- …

## 5. Hitos Principales
| Hito | Fecha objetivo | Responsable | Criterio de aceptación |
|------|----------------|-------------|------------------------|
| Kick-off | TBD | PM | Charter firmado |
| Milestone 1 | TBD | … | … |

## 6. Presupuesto
- **BAC:** {{bac_currency}} {{bac}}
- **Tarifa MOD / H-H:** {{rate}}
- **Overhead:** {{overhead}}%
- **Quantum / Reclamación:** {{quantum}}
- **BATNA:** {{batna}}

## 7. Restricciones, Supuestos y Riesgos de Alto Nivel
**Restricciones:** [plazo, presupuesto, calidad, recursos]
**Supuestos:** [disponibilidad, aprobaciones, clima]
**Riesgos de alto nivel (Top 5):** [P × I = Score · EMV]

## 8. Autoridad del Project Manager
- **Nombre:** {{pm}}
- **Autoridad presupuestaria:** Hasta [X]% del BAC sin aprobación adicional
- **Autoridad de recursos:** [alcance de decisiones técnicas y de personal]

## 9. Stakeholders Principales
- **Sponsor:** {{client}}
- **Cliente:** {{client}} ({{client_rep}})
- **Organización ejecutora:** {{org}}
- **Representantes clave:** …

## 10. Aprobaciones
Sponsor: ___________  Firma: ___________  Fecha: _______
PM: _______________  Firma: ___________  Fecha: _______

---
*Ref: PMBOK® Guide 8th Edition · Initiate Project or Phase*`,

"1.1_1":`# ASSUMPTION LOG
**Proyecto:** {{name}}  |  **Versión:** 1.0  |  **Fecha:** {{date}}  |  **Propietario:** {{pm}}

| ID | Supuesto | Fuente | Propietario | Impacto si falla | Fecha validación | Estado |
|----|----------|--------|-------------|------------------|------------------|--------|
| AS-001 | [Descripción del supuesto] | [Charter / Entrevista / …] | [Nombre] | [Alto / Medio / Bajo] | YYYY-MM-DD | Pendiente / Validado / Refutado |
| AS-002 | … | … | … | … | … | … |

## Revisión periódica
- **Frecuencia:** Quincenal en reunión de equipo
- **Conversión a riesgo:** Supuestos con impacto Alto que no se validan pasan al Risk Register

---
*Ref: PMBOK® Guide 8th Edition · Uncertainty Performance Domain*`,

"1.2_0":`# PROJECT MANAGEMENT PLAN (PMP)
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Versión:** 1.0 (Baseline)  |  **Fecha:** {{date}}

## 1. Ciclo de Vida y Tailoring
- **Enfoque:** [Predictivo / Adaptativo / Híbrido]
- **Justificación de tailoring:** [Factores del proyecto, industria, complejidad]

## 2. Planes Subsidiarios (referencias)
- Scope Management Plan — v1.0
- Schedule Management Plan — v1.0
- Financial Management Plan — v1.0
- Quality Management Plan — v1.0
- Resource Management Plan — v1.0
- Communications Management Plan — v1.0
- Risk Management Plan — v1.0
- Procurement Management Plan — v1.0
- Stakeholder Engagement Plan — v1.0
- Change Management Plan — v1.0
- Configuration Management Plan — v1.0

## 3. Baselines
- **Scope Baseline:** WBS + WBS Dictionary + Scope Statement v1.0
- **Schedule Baseline:** MS Project / P6 file v1.0 (fecha fin: TBD)
- **Cost Baseline / PMB:** S-Curve v1.0 (BAC: {{bac_currency}} {{bac}})

## 4. Umbrales de Control
- **CPI:** Alerta < 0.95 · Acción < 0.90 · Escalación < 0.80
- **SPI:** Alerta < 0.95 · Acción < 0.90 · Escalación < 0.85
- **Scope:** Cambios > 5% requieren CCB
- **Calidad:** NCR críticos escalan al Sponsor en ≤24 h

## 5. Decisiones Clave de Tailoring
[Documentar qué procesos se adaptaron, simplificaron o intensificaron y por qué]

---
*Ref: PMBOK® Guide 8th Edition · Integrate and Align Project Plans*`,

"1.4_2":`# ISSUE LOG
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Versión:** _ |  **Fecha:** {{date}}

| ID | Fecha | Descripción | Dominio | Prioridad | Impacto | Responsable | Fecha límite | Acciones | Estado | Fecha cierre | Lección |
|----|-------|-------------|---------|-----------|---------|-------------|--------------|----------|--------|--------------|---------|
| IS-001 | YYYY-MM-DD | [Descripción] | [GOV/SCP/SCH/FIN/STK/RES/RSK] | [Alta/Media/Baja] | [Descripción] | [Nombre] | YYYY-MM-DD | [Acciones] | [Abierto/En progreso/Cerrado] | YYYY-MM-DD | [Lección aprendida si aplica] |

## Resumen
- **Issues abiertos:** _
- **Issues críticos/altos:** _
- **Issues vencidos:** _

## Reglas de escalación
- Prioridad Alta y > 5 días sin avance → PM
- Issue bloqueante del cronograma crítico → Sponsor en ≤24 h

---
*Ref: PMBOK® Guide 8th Edition · Manage Project Execution*`,

"1.5_0":`# QUALITY REPORT
**Proyecto:** {{name}}  |  **Período:** _  |  **Preparado por:** _  |  **Fecha:** {{date}}

## 1. Resumen del Período
- Auditorías realizadas: _
- Inspecciones ITP: _ (H: _ · W: _ · R: _)
- NCRs abiertas: _ · NCRs cerradas: _

## 2. Hallazgos — Tabla de Conformidades y No Conformidades
| Ref | Fecha | Área | Estándar | Inspector | Tipo (C/NC/OB) | Descripción | Causa raíz | Acción correctiva | Responsable | Fecha objetivo | Estado |
|-----|-------|------|----------|-----------|----------------|-------------|------------|-------------------|-------------|----------------|--------|

## 3. Análisis de Causa Raíz (RCA)
Para NC mayores: aplicar 5 Porqués / Ishikawa. Documentar método y hallazgos.

## 4. Acciones Correctivas / Preventivas
- CA-001: [Descripción] | Responsable: _ | Fecha: _ | Estado: _

## 5. Tests and Evaluation Documents (referencias)
[Listar certificados, pull-off, ensayos de tracción, etc.]

---
*Ref: PMBOK® Guide 8th Edition · Manage Quality Assurance*`,

"1.6_0":`# LESSONS LEARNED REGISTER
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Fecha:** {{date}}

| ID | Fase | Categoría | Evento | Causa raíz | Impacto | Lección | Recomendación | Acción OPA | Autor | Fecha | Estado |
|----|------|-----------|--------|------------|---------|---------|---------------|------------|-------|-------|--------|
| LL-001 | [Initiate/Plan/Exec/M&C/Close] | [Técnica/Proceso/Gestión] | [Qué sucedió] | [Por qué sucedió] | [Alto/Medio/Bajo + descripción] | [Lo que aprendimos] | [Qué haríamos distinto] | [Actualizar plantilla X / proc Y] | [Nombre] | YYYY-MM-DD | [Propuesta/Aprobada/Integrada] |

## OPA Updates Sugeridos
- Actualizar plantilla: _
- Actualizar benchmark de estimación: _
- Actualizar procedimiento: _

---
*Ref: PMBOK® Guide 8th Edition · Manage Project Knowledge*`,

"1.7_0":`# WORK PERFORMANCE REPORT (WPR)
**Proyecto:** {{name}}  |  **Período:** _  |  **Preparado por:** {{pm}}  |  **Fecha:** {{date}}
**Estado general:** 🟢 VERDE / 🟡 AMARILLO / 🔴 ROJO — [justificación breve]

## 1. Logros del Período
- _
- _

## 2. Problemas Críticos
- _

## 3. Métricas EVM
| Métrica | Valor | Umbral | Estado |
|---------|-------|--------|--------|
| BAC | {{bac_currency}} {{bac}} | — | — |
| PV (Planned Value) | _ | — | — |
| EV (Earned Value) | _ | — | — |
| AC (Actual Cost) | _ | — | — |
| **CV = EV − AC** | _ | > 0 | 🟢/🟡/🔴 |
| **SV = EV − PV** | _ | > 0 | 🟢/🟡/🔴 |
| **CPI = EV ÷ AC** | _ | ≥ 0.95 | 🟢/🟡/🔴 |
| **SPI = EV ÷ PV** | _ | ≥ 0.95 | 🟢/🟡/🔴 |
| **EAC = BAC ÷ CPI** | _ | — | — |
| **ETC = EAC − AC** | _ | — | — |
| **VAC = BAC − EAC** | _ | ≥ 0 | 🟢/🟡/🔴 |
| **TCPI** | _ | ≤ 1.10 | 🟢/🟡/🔴 |

## 4. Estado de Hitos
| Hito | Plan | Real/Proy | Varianza | Estado |
|------|------|-----------|----------|--------|

## 5. Top Issues y CRs Pendientes
| ID | Issue / CR | Prioridad | Responsable | Estado |
|----|-----------|-----------|-------------|--------|

## 6. Top Riesgos Activos
[Top 5 por score P×I · acciones en curso]

## 7. Proyección al Cierre
[Forecast de fecha y costo · acciones de recuperación si SPI/CPI < umbral]

---
*Ref: PMBOK® Guide 8th Edition · Monitor and Control Project Performance*`,

"1.7_1":`# CHANGE REQUEST FORM
**CR#:** CR-_  |  **Fecha:** {{date}}  |  **Solicitante:** _  |  **Proyecto:** {{name}}

## 1. Tipo de Cambio
☐ Correctivo  ☐ Preventivo  ☐ Reparación de defecto  ☐ Actualización PMP

## 2. Área(s) Afectada(s)
☐ Alcance  ☐ Cronograma  ☐ Costo  ☐ Calidad  ☐ Recursos  ☐ Riesgos  ☐ Comunicaciones  ☐ Adquisiciones

## 3. Descripción del Cambio
[Descripción detallada, factual, sin suposiciones]

## 4. Justificación
[Por qué este cambio es necesario · evidencia · referencia a causa raíz]

## 5. Análisis de Impacto
- **Alcance:** [cambios a WBS / entregables]
- **Cronograma:** [± días · impacto en ruta crítica · Sí/No]
- **Costo:** [± monto en {{bac_currency}}]
- **Calidad:** [impacto en especificaciones / estándares]
- **Riesgos:** [riesgos nuevos · cambios en riesgos existentes]
- **Recursos:** [H-H adicionales · equipos · materiales]

## 6. Recomendación del PM
☐ Aprobar  ☐ Aprobar con condiciones  ☐ Rechazar  ☐ Diferir
**Justificación:** _

## 7. Decisión del CCB
☐ Aprobado  ☐ Rechazado  ☐ Diferido  ☐ Aprobado con condiciones
**Condiciones:** _  |  **Fecha decisión:** _

## 8. Firmas CCB
| Nombre | Cargo | Firma | Fecha |
|--------|-------|-------|-------|

## 9. Baselines Actualizados
☐ Scope  ☐ Schedule  ☐ Cost  |  **Versión nueva:** _

---
*Ref: PMBOK® Guide 8th Edition · Assess and Implement Changes*`,

"1.9_0":`# FINAL REPORT — PROJECT CLOSURE
**Proyecto:** {{name}}  |  **Código:** {{contract}}  |  **Fecha cierre:** {{date}}  |  **PM:** {{pm}}

## 1. Resumen Ejecutivo
[2–3 párrafos: resultado del proyecto, objetivos alcanzados, desempeño global]

## 2. Objetivos vs. Resultados
| Objetivo (SMART) | Resultado | Estado |
|------------------|-----------|--------|

## 3. Métricas Finales
- **Alcance:** [% de entregables aceptados]
- **Cronograma:** SPI final = _ | Duración plan vs. real = _ días
- **Costo:** CPI final = _ | EAC final = {{bac_currency}} _ | VAC = _
- **Calidad:** NCRs cerradas / totales = _
- **Satisfacción del cliente:** _/5

## 4. Top 5 Lecciones Aprendidas
1. _
2. _
3. _
4. _
5. _

## 5. Items Abiertos / Pendientes de Transferencia
[Lista de ítems no cerrados y a quién se transfieren]

## 6. Liberación de Recursos
- Equipo: [plan de reasignación]
- Equipos/materiales: [destino]
- Facilities: [devolución]

## 7. Archivos Transferidos a OPAs
☐ Lessons Learned DB  ☐ Plantillas actualizadas  ☐ Procedimientos  ☐ Datos históricos de estimación  ☐ Risk DB

## 8. Aprobación Final del Sponsor
Sponsor: ___________  Firma: ___________  Fecha: _______

---
*Ref: PMBOK® Guide 8th Edition · Close Project or Phase*`,

"2.2_0":`# REQUIREMENTS DOCUMENTATION
**Proyecto:** {{name}}  |  **Versión:** _  |  **Fecha:** {{date}}

| Req ID | Categoría | Fuente | Descripción | Prioridad | Criterio de aceptación | Método de verificación | Estado |
|--------|-----------|--------|-------------|-----------|------------------------|------------------------|--------|
| REQ-001 | [Funcional / Técnico / Calidad / Normativo / Stakeholder] | [Documento / Persona] | [Descripción clara y testeable] | [Must / Should / Could / Won't — MoSCoW] | [Condición medible] | [Inspección / Test / Revisión / Demostración] | [Propuesto / Aprobado / Implementado / Verificado] |

## Proceso de Priorización
MoSCoW aplicado con cliente en sesión formal documentada.

## Control de Cambios de Requisitos
Cualquier cambio → CR Form → impacto en matriz de trazabilidad.

---
*Ref: PMBOK® Guide 8th Edition · Elicit and Analyze Requirements*`,

"2.2_1":`# REQUIREMENTS TRACEABILITY MATRIX (RTM)
**Proyecto:** {{name}}  |  **Versión:** _  |  **Fecha:** {{date}}

| Req ID | Descripción | WBS element | Drawing ref | Hold Point ITP | Test result | Acceptance status | Notas |
|--------|-------------|-------------|-------------|----------------|-------------|-------------------|-------|
| REQ-001 | … | 1.2.3 | DWG-001 rev B | HP-5 | PASS | Aceptado (firma cliente) | … |

## Métricas de Cobertura
- Requisitos trazables al WBS: _/total (%)
- Requisitos verificados: _/total (%)
- Requisitos aceptados por cliente: _/total (%)

---
*Ref: PMBOK® Guide 8th Edition · Elicit and Analyze Requirements*`,

"2.3_0":`# PROJECT SCOPE STATEMENT
**Proyecto:** {{name}}  |  **Versión:** _  |  **Fecha:** {{date}}

## 1. Descripción del Producto / Servicio / Resultado
[Descripción progresivamente elaborada del producto final]

## 2. Criterios de Aceptación del Producto
- [Criterio 1 medible y verificable]
- …

## 3. Entregables IN SCOPE
- [Entregable 1 con su especificación]
- [Entregable 2]
- …

## 4. Exclusiones Explícitas (OUT of Scope)
⚠ Lo siguiente NO forma parte del alcance y NO será entregado:
- _
- _

## 5. Supuestos del Alcance
- _
- _

## 6. Restricciones del Alcance
- _
- _

## 7. Límites del Proyecto (Project Boundaries)
[Dónde empieza y dónde termina la responsabilidad del equipo del proyecto]

## 8. Sign-offs
Cliente: ___________ Fecha: _______
Sponsor: ___________ Fecha: _______
PM: _______________ Fecha: _______

---
*Ref: PMBOK® Guide 8th Edition · Define Scope*`,

"2.4_0":`# SCOPE BASELINE — WBS + WBS DICTIONARY
**Proyecto:** {{name}}  |  **Versión Baseline:** v1.0  |  **Fecha:** {{date}}

## 1. WBS (Estructura jerárquica)
\`\`\`
1. {{name}}
├── 1.1 [Fase / Entregable mayor]
│   ├── 1.1.1 [Work Package]
│   │   ├── 1.1.1.1 [Actividad]
│   │   └── 1.1.1.2 [Actividad]
│   └── 1.1.2 [Work Package]
├── 1.2 [Fase / Entregable mayor]
└── 1.9 Project Management
\`\`\`

## 2. WBS Dictionary — detalle por Work Package
| WBS Code | Nombre | Nivel | Responsable | Descripción | Entregable | Criterio de aceptación | Duración est. (días) | Costo est. ({{bac_currency}}) | Dependencias |
|----------|--------|-------|-------------|-------------|------------|------------------------|----------------------|-------------------------------|--------------|
| 1.1.1 | … | 3 | … | … | … | … | _ | _ | 1.1.0 FS |

## 3. Regla 100%
Todos los WP suman 100% del alcance del proyecto. Sin duplicaciones ni vacíos.

## 4. Control de Versiones
v1.0 Baseline — aprobado el {{date}}. Cambios posteriores vía CR.

---
*Ref: PMBOK® Guide 8th Edition · Develop Scope Structure (Create WBS)*`,

"3.2_0":`# PROJECT SCHEDULE + SCHEDULE BASELINE
**Proyecto:** {{name}}  |  **Herramienta:** {{schedule_tool}}  |  **Versión Baseline:** v1.0  |  **Fecha:** {{date}}

## 1. Actividades (extracto)
| Act ID | Nombre | WBS | Predecesores | Duración (d) | Esfuerzo H-H | Recurso | ES | EF | LS | LF | TF | Crítica |
|--------|--------|-----|--------------|--------------|--------------|---------|----|----|----|----|----|---------|
| A001 | Kick-off | 1.1 | — | 1 | 8 | PM | 0 | 1 | 0 | 1 | 0 | Sí |

## 2. Milestones
| Milestone | Fecha plan | Responsable | Criterio |
|-----------|------------|-------------|----------|

## 3. Ruta Crítica (CPM)
- Duración del proyecto: _ días
- Actividades críticas (TF=0): A001 → A003 → A007 → …

## 4. S-Curve (PV por período)
| Período | PV período | PV acumulado | % completado |
|---------|------------|--------------|--------------|

## 5. Supuestos del Cronograma
- Calendario: 5×8 / 6×10 / 7×24 — _
- Productividad asumida: _ H-H/ton · _ m²/día
- Buffers incluidos: _% global / _d al final

---
*Ref: PMBOK® Guide 8th Edition · Develop Schedule · CPM*`,

"4.2_0":`# COST ESTIMATES
**Proyecto:** {{name}}  |  **Tarifa MOD:** {{rate}}  |  **Overhead:** {{overhead}}%  |  **Moneda:** {{bac_currency}}

| WBS | Work Package | H-H | Tarifa H-H | Costo MOD | Material | Equipo | Subcontrato | Overhead | Contingencia | Total | Método | Confianza |
|-----|--------------|-----|------------|-----------|----------|--------|-------------|----------|--------------|-------|--------|-----------|
| 1.1.1 | … | _ | {{rate}} | _ | _ | _ | _ | _ | _ | _ | [PAR / BU / PERT] | [-5%/+10% / -10%/+25% / ...] |

## Totales
- **Subtotal directo:** _
- **Overhead ({{overhead}}%):** _
- **Contingencia (_%):** _
- **Total BAC:** {{bac_currency}} {{bac}}

## Métodos Aplicados
- **Bottom-Up:** para WP con productividad conocida (≤80 H-H)
- **Paramétrico:** para estimación por tonelada / m² / unidad
- **PERT (3 puntos):** para WP con alta incertidumbre — E = (O + 4M + P) ÷ 6

---
*Ref: PMBOK® Guide 8th Edition · Estimate Costs*`,

"4.2_1":`# BASIS OF ESTIMATES (BoE)
**Proyecto:** {{name}}  |  **Versión:** _  |  **Fecha:** {{date}}

## 1. Método de Estimación por Componente
| Componente | Método | Fuente del dato | Tasa / Productividad | Rango de confianza |
|------------|--------|-----------------|----------------------|--------------------|

## 2. Supuestos
- [Supuesto técnico]
- [Supuesto de productividad]
- [Supuesto de mercado — inflación, tipo de cambio]

## 3. Exclusiones
- Lo NO incluido en el estimado: _

## 4. Riesgos Cuantificados
Ver Risk Register → EMV sumado = {{bac_currency}} _ (ya incluido en Contingencia)

## 5. Rango de Confianza del Estimado
- **ROM (Rough Order of Magnitude):** −25% / +75%
- **Budget Estimate:** −10% / +25%
- **Definitive Estimate:** −5% / +10%
- **Este estimado:** [categoría] con rango [X/Y]%

## 6. Referencias a Data Históricos
- Proyecto comparable: _  |  Ratio aplicado: _

---
*Ref: PMBOK® Guide 8th Edition · Estimate Costs — BoE*`,

"4.3_0":`# COST BASELINE — PMB (S-Curve)
**Proyecto:** {{name}}  |  **BAC:** {{bac_currency}} {{bac}}  |  **Versión:** v1.0

## S-Curve — PV por período
| Período | PV período | PV acumulado | % del BAC |
|---------|------------|--------------|-----------|
| M1 | _ | _ | _% |
| M2 | _ | _ | _% |
| … | … | … | … |
| **Total** | **{{bac}}** | **{{bac}}** | **100%** |

## Reservas
- **Contingencia (dentro del PMB):** _% del BAC = {{bac_currency}} _ · **Autoridad:** PM
- **Reserva de Gestión (FUERA del PMB):** _% del BAC = {{bac_currency}} _ · **Autoridad:** Sponsor

## Project Funding Requirements
| Período | Requerido | Fuente | Recepción esperada | Recepción real | Gap | Acción |
|---------|-----------|--------|---------------------|----------------|-----|--------|

---
*Ref: PMBOK® Guide 8th Edition · Develop Budget*`,

"4.4_1":`# EVM REPORT
**Proyecto:** {{name}}  |  **Período:** _  |  **Data date:** _

| Métrica | Fórmula | Valor | Interpretación |
|---------|---------|-------|----------------|
| BAC | — | {{bac}} | Presupuesto total autorizado |
| PV | BAC × %Plan | _ | Valor planificado a la fecha |
| EV | BAC × %Real | _ | Valor ganado a la fecha |
| AC | Real costos | _ | Costo real incurrido |
| CV | EV − AC | _ | > 0 favorable · < 0 sobrecosto |
| SV | EV − PV | _ | > 0 adelanto · < 0 retraso |
| CPI | EV ÷ AC | _ | ≥ 1 eficiente en costo |
| SPI | EV ÷ PV | _ | ≥ 1 en cronograma |
| EAC | BAC ÷ CPI | _ | Pronóstico costo total |
| ETC | EAC − AC | _ | Costo por venir |
| VAC | BAC − EAC | _ | Varianza proyectada al cierre |
| TCPI | (BAC − EV) ÷ (BAC − AC) | _ | Eficiencia requerida para cumplir BAC |

## Tendencia (últimos 3 períodos)
| Período | CPI | SPI |
|---------|-----|-----|

## Interpretación y Acciones
- Si **CPI < 0.90** por 3 períodos consecutivos → revisión del Cost Baseline
- Si **SPI < 0.85** por 3 períodos → aplicar crashing / fast-tracking

---
*Ref: PMBOK® Guide 8th Edition · Monitor and Control Finances — EVM*`,

"5.1_0":`# STAKEHOLDER REGISTER
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Versión:** _  |  **Fecha:** {{date}}

| ID | Nombre | Org / Rol | Contacto | Tipo (Int/Ext) | Interés | Poder (H/M/L) | Engagement actual (1-5) | Engagement deseado (1-5) | Estrategia | Canal | Propietario |
|----|--------|-----------|----------|----------------|---------|---------------|-------------------------|--------------------------|------------|-------|-------------|
| ST-001 | … | … | … | … | … | … | … | … | [Gestionar de cerca / Mantener satisfecho / Mantener informado / Monitorear] | [Reunión / Email / Informe] | {{pm}} |

## Leyenda de Niveles (Tuckman/Salience adaptado)
1 = Desconocedor  |  2 = Resistente  |  3 = Neutral  |  4 = Partidario  |  5 = Líder

## Matriz Poder × Interés
- Alto P / Alto I → **Gestionar de cerca**
- Alto P / Bajo I → **Mantener satisfecho**
- Bajo P / Alto I → **Mantener informado**
- Bajo P / Bajo I → **Monitorear**

---
*Ref: PMBOK® Guide 8th Edition · Identify Stakeholders*`,

"5.3_0":`# COMMUNICATIONS MANAGEMENT PLAN
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Versión:** _  |  **Fecha:** {{date}}

| Stakeholder | Información | Formato / Medio | Frecuencia | Canal | Emisor | Aprobación req. | Almacenamiento | Confirmación |
|-------------|-------------|-----------------|------------|-------|--------|-----------------|----------------|--------------|
| Sponsor | WPR ejecutivo | PDF 1 pág + EVM | Mensual | Email + reunión | PM | No | PMIS /repo/reports/ | Acuse email |
| Cliente | Informe de avance | PDF + fotos | Quincenal | Email | PM | Sí (interno) | PMIS | Acuse email |
| Equipo | Daily stand-up | Verbal + board | Diaria | Sala / Teams | Scrum Master | No | Acta breve | — |

## Cálculo de Canales
N canales = n × (n − 1) ÷ 2  donde n = número de stakeholders

## Reglas
- Toda comunicación oficial → archivada en PMIS
- Reuniones formales → acta ≤ 24 h
- Confidencial → canal seguro cifrado

---
*Ref: PMBOK® Guide 8th Edition · Plan Communications Management*`,

"6.1_0":`# RESOURCE MANAGEMENT PLAN + RACI
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Fecha:** {{date}}

## 1. Estrategia de Adquisición
- Interno: [roles y %]
- Contratación directa: [roles]
- Subcontrato: [servicios/especialidades]

## 2. Matriz RACI
| Actividad / Entregable | Sponsor | PM | Líder Técnico | Equipo | Cliente |
|------------------------|---------|----|----|----|----|
| Aprobar Charter | A | R | C | I | I |
| Aprobar Baselines | A | R | C | I | C |
| Ejecutar WP 1.1.1 | I | A | R | R | I |
| Aprobar cambios (CCB) | A | R | C | I | C |

**R** = Responsable (hace el trabajo) · **A** = Accountable (solo UNO) · **C** = Consultado · **I** = Informado
**Regla:** cada tarea ≥ 1 R y exactamente 1 A.

## 3. Plan de Capacitación
- Inducción al proyecto (día 1)
- Capacitación técnica específica según rol

## 4. Umbrales de Control de Recursos
- Utilización objetivo: 80–90%
- Sobreasignación > 1 día → leveling / smoothing

---
*Ref: PMBOK® Guide 8th Edition · Plan Resource Management*`,

"6.1_1":`# TEAM CHARTER
**Proyecto:** {{name}}  |  **Fecha:** {{date}}

## 1. Misión del Equipo
[Propósito claro alineado con el Charter del proyecto]

## 2. Miembros y Roles
| Nombre | Rol | Responsabilidad principal | Asignación (%) |
|--------|-----|---------------------------|----------------|

## 3. Valores del Equipo
- Transparencia  |  Compromiso con la calidad  |  Respeto  |  …

## 4. Normas de Trabajo (Ground Rules)
- Reuniones puntuales, con agenda previa ≥ 24 h
- Daily stand-up ≤ 15 min
- Decisiones documentadas en acta
- Conflictos: abordar en ≤ 48 h con el PM
- Retrospectivas quincenales

## 5. Protocolo de Comunicación
- Urgente (<2 h): llamada / Teams
- Normal: email / PMIS
- Formal: oficio con número correlativo

## 6. Autoridad de Decisión
- Técnica: Líder técnico (dentro de baselines)
- Cambios a baselines: PM → CCB → Sponsor

## 7. Firmas del Equipo
[Todos los miembros firman para validar el charter]

---
*Ref: PMBOK® Guide 8th Edition · Plan Resource Management — Team Charter*`,

"7.1_0":`# RISK MANAGEMENT PLAN
**Proyecto:** {{name}}  |  **PM:** {{pm}}  |  **Fecha:** {{date}}

## 1. Metodología
- Identificación: brainstorming, entrevistas, checklists, análisis de supuestos
- Análisis cualitativo: matriz P × I
- Análisis cuantitativo: EMV, Monte Carlo, sensibilidad (tornado)
- Respuestas: evitar/transferir/mitigar/aceptar (amenazas); explotar/compartir/mejorar/aceptar (oportunidades)

## 2. Roles y Responsabilidades
- **Risk Owner:** [nombre] por cada riesgo
- **Risk Manager / PM:** consolidación, reportes, escalación
- **Sponsor:** autoridad sobre reserva de gestión

## 3. Categorías (RBS — Risk Breakdown Structure)
- Técnico (diseño, materiales, tecnología)
- Externo (cliente, regulatorio, clima, mercado)
- Organizacional (recursos, dependencias)
- Gestión (estimación, planificación, control)

## 4. Escalas
**Probabilidad:** 0.10 / 0.20 / 0.40 / 0.60 / 0.80
**Impacto:** 0.05 / 0.10 / 0.20 / 0.40 / 0.80

## 5. Matriz P × I (Score)
- **Alto:** ≥ 0.24 (atención inmediata)
- **Medio:** 0.08 – 0.23 (monitoreo activo)
- **Bajo:** < 0.08 (lista de observación)

## 6. Apetito al Riesgo
[Declaración del Sponsor sobre cuánto riesgo es aceptable en costo/plazo/calidad]

## 7. Política de Reservas
- Contingencia: ΣEMV ó _% del BAC
- Reserva de gestión: _% del BAC — autoridad Sponsor

## 8. Frecuencia de Revisión
- Riesgos Altos: semanal
- Riesgos Medios: quincenal
- Riesgos Bajos: mensual

---
*Ref: PMBOK® Guide 8th Edition · Plan Risk Management*`,

"7.2_0":`# RISK REGISTER
**Proyecto:** {{name}}  |  **Versión:** _  |  **Fecha:** {{date}}

| ID | Categoría | Descripción | Trigger | Causa | P (0.10-0.80) | I (0.05-0.80) | Score P×I | EMV ({{bac_currency}}) | Owner | Estrategia | Acciones | Contingencia | Fallback | Residual | Reserva | Estado |
|----|-----------|-------------|---------|-------|---------------|---------------|-----------|------------------------|-------|------------|----------|--------------|----------|----------|---------|--------|
| R-001 | [Técnico/Externo/Org/Gestión] | … | [evento que indica que el riesgo está ocurriendo] | [causa raíz] | _ | _ | _ | _ | [nombre] | [Evitar/Transferir/Mitigar/Aceptar] | [acciones] | [plan B activable] | [plan si falla B] | [score residual] | [$ asignado] | [Activo/Cerrado/Ocurrió] |

## Resumen
- **Total riesgos:** _
- **Altos:** _ · **Medios:** _ · **Bajos:** _
- **EMV total activo:** {{bac_currency}} _
- **Reserva contingencia asignada:** {{bac_currency}} _

---
*Ref: PMBOK® Guide 8th Edition · Identify Risks + Plan Risk Responses*`,

"7.2_1":`# RISK REPORT
**Proyecto:** {{name}}  |  **Período:** _  |  **Fecha:** {{date}}

## 1. Exposición General al Riesgo
- **EMV total:** {{bac_currency}} _
- **VaR (P80):** {{bac_currency}} _ (Monte Carlo, 1000 iteraciones)
- **Reserva actual:** {{bac_currency}} _  ·  **Adecuación:** Suficiente / Insuficiente

## 2. Top 5 Riesgos
| Rank | Risk ID | Descripción breve | Score | EMV | Owner | Estado respuesta |
|------|---------|-------------------|-------|-----|-------|------------------|

## 3. Tendencia de Riesgos
- Período anterior: _ altos · _ medios
- Período actual: _ altos · _ medios
- Tendencia: ⬆ / ⬇ / →

## 4. Resultados Cuantitativos
- Monte Carlo completion date — P50: _ · P80: _
- Monte Carlo cost — P50: _ · P80: _
- Tornado — top 3 drivers: _

## 5. Riesgos Nuevos del Período
| ID | Descripción | Score | Acción |
|----|-------------|-------|--------|

## 6. Riesgos Cerrados (no materializados)
| ID | Motivo de cierre |
|----|------------------|

---
*Ref: PMBOK® Guide 8th Edition · Perform Risk Analysis*`,

"7.4_0":`# RISK RESPONSE PLAN
**Proyecto:** {{name}}  |  **Versión:** _

| Risk ID | Estrategia | Acciones específicas | Owner | Contingencia ({{bac_currency}}) | Fallback | Trigger para activar | Score post-respuesta |
|---------|-----------|----------------------|-------|---------------------------------|----------|----------------------|----------------------|
| R-001 | [Amenaza: Evitar/Transferir/Mitigar/Aceptar activa/Aceptar pasiva/Escalar] [Oportunidad: Explotar/Compartir/Mejorar/Aceptar] | … | … | _ | [plan B] | [evento observable] | _ |

## Notas sobre Estrategias
- **Evitar:** eliminar la causa / cambiar el plan
- **Transferir:** seguro, garantía, contrato (el riesgo sigue existiendo, la consecuencia no es nuestra)
- **Mitigar:** reducir P o I
- **Aceptar activa:** establecer reserva y plan de contingencia
- **Aceptar pasiva:** no hacer nada hasta que ocurra

---
*Ref: PMBOK® Guide 8th Edition · Plan Risk Responses*`,

"7.6_0":`# RISK MONITORING REPORT
**Proyecto:** {{name}}  |  **Período:** _  |  **Próxima revisión:** _

## 1. Resumen
- **Total riesgos activos:** _
- **Altos activos:** _  ·  **Cerrados (período):** _  ·  **Nuevos (período):** _

## 2. Top 5 Riesgos Activos
| Risk ID | Descripción | Score | Acción en curso | Estado |
|---------|-------------|-------|------------------|--------|

## 3. Estado de la Reserva
- Contingencia inicial: {{bac_currency}} _
- Consumido: {{bac_currency}} _ (_%)
- Disponible: {{bac_currency}} _

## 4. Tendencia EVM vs. Riesgos
- SPI actual: _  ·  tendencia: ⬆ / ⬇ / →
- CPI actual: _  ·  tendencia: ⬆ / ⬇ / →
- Correlación con materialización de riesgos: _

## 5. Acciones Recomendadas
- _
- _

## 6. Próxima Revisión
Fecha: _  |  Frecuencia: [Semanal / Quincenal / Mensual]

---
*Ref: PMBOK® Guide 8th Edition · Monitor Risks*`
};

const LAYERS=[
  {n:"CAPA 0",t:"ADN Cultural",col:"#14B8A6",d:"Compromiso · Confianza · Generación del Valor.",tags:["Compromiso","Confianza","Valor"]},
  {n:"CAPA 1",t:"Tres Pilares Operacionales",col:"#3A7BD5",d:"SYST · EN · GER",tags:["SYST","EN","GER"]},
  {n:"CAPA 2",t:"PMBOK® 8 — 7 Dominios · 40 Procesos",col:"#27AE60",d:"6 Principios + 7 Dominios + 40 Procesos.",tags:["6 Principios","7 Dominios","40 Procesos"]},
  {n:"CAPA 3",t:"Scrumban — Motor de Ejecución",col:"#9B59B6",d:"Kanban (WIP limits, CFD) + Scrum Cadence.",tags:["Sprint 2 sem","Kanban","Stand-up"]},
  {n:"CAPA 4",t:"Governance + Evidencia",col:"#E74C3C",d:"EVM, KPIs, Claims Register, Correspondencia oficial.",tags:["EVM","Claims","Correspondencia"]},
  {n:"CAPA 5",t:"BOOM COMPROMISE",col:"#1ABC9C",d:"Módulo transversal de gestión de tareas.",tags:["Tableros","Actividades","Trazabilidad"]},
];

const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Outfit:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body,html{background:#04141A;color:#CDD6E4;font-family:'Outfit',sans-serif}
.root{min-height:100vh}
.nav{background:#061A22;border-bottom:1px solid #14B8A644;display:flex;overflow-x:auto;scrollbar-width:none;padding:0 6px;position:sticky;top:0;z-index:30}
.nav::-webkit-scrollbar{display:none}
.nb{flex-shrink:0;padding:10px 11px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;border:none;background:transparent;color:#6B7E94;cursor:pointer;border-bottom:2px solid transparent;font-family:'Outfit',sans-serif;white-space:nowrap;transition:all .15s}
.nb.on{color:#14B8A6;border-bottom-color:#14B8A6}
.user-area{display:flex;align-items:center;gap:6px;padding:0 8px;flex-shrink:0}
.ubadge{font-size:10px;font-weight:600;padding:3px 8px;border-radius:12px;border:1px solid;font-family:'Outfit',sans-serif;white-space:nowrap}
.logout-btn{background:transparent;border:1px solid #E74C3C44;color:#E57373;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:9px;font-family:'Outfit',sans-serif}
.pbar{background:#071A22;border-bottom:1px solid #14B8A633;padding:6px 14px;display:flex;align-items:center;gap:8px;min-height:32px;position:sticky;top:42px;z-index:25}
.pbar-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.5px;text-transform:uppercase;flex-shrink:0}
.pbar-name{font-size:12px;font-weight:600;color:#14B8A6;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbar-none{font-size:11px;color:#E74C3C;font-style:italic;flex:1}
.pbar-btn{font-size:9px;background:#14B8A622;border:1px solid #14B8A644;color:#14B8A6;padding:3px 8px;border-radius:3px;cursor:pointer;font-family:'Outfit',sans-serif;flex-shrink:0}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(160deg,#071A22 0%,#04141A 100%)}
.login-box{background:#0B1F27;border:1px solid #14B8A644;border-radius:10px;padding:28px 24px;width:100%;max-width:340px}
.login-title{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#FFF;text-align:center;margin-bottom:4px}
.login-title em{color:#14B8A6;font-style:normal}
.login-sub{font-size:11px;color:#6B7E94;margin-bottom:18px;text-align:center}
.login-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px;margin-top:14px;display:block}
.login-inp{width:100%;background:#04141A;border:1px solid #1C3A40;border-radius:5px;padding:10px 12px;color:#CDD6E4;font-size:13px;font-family:'Outfit',sans-serif;transition:border-color .15s}
.login-inp:focus{outline:none;border-color:#14B8A6}
.login-inp::placeholder{color:#6B7E94}
.login-btn{width:100%;background:#14B8A6;color:#04141A;border:none;border-radius:5px;padding:12px;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;cursor:pointer;margin-top:18px}
.login-err{background:#E74C3C22;border:1px solid #E74C3C44;border-radius:4px;padding:8px 12px;font-size:11px;color:#E57373;margin-top:10px;text-align:center}
.login-hint{font-size:10px;color:#6B7E94;text-align:center;margin-top:12px;line-height:1.6}
.sec-hdr{padding:10px 16px 6px;border-bottom:1px solid #1C3A40;background:#061A22;position:sticky;top:74px;z-index:19}
.sec-ey{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px}
.sec-ti{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#FFF;display:flex;align-items:center;gap:8px}
.hero{background:linear-gradient(160deg,#071A22 0%,#04141A 100%);border-bottom:1px solid #14B8A633;padding:22px 16px 18px;text-align:center}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:9px;color:#14B8A6;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:10px}
.logo-wrap{display:flex;justify-content:center;margin:6px 0 10px}
.logo-svg{width:72px;height:108px;filter:drop-shadow(0 6px 14px #14B8A644)}
.brand-big{font-family:'Syne',sans-serif;font-size:44px;font-weight:800;line-height:1;letter-spacing:1.5px;margin:4px 0 4px;user-select:none;display:inline-block}
.brand-big .b1{color:#14B8A6}
.brand-big .b2{color:#5EEAD4}
.brand-big .b3{color:#FFF}
.brand-sa{font-family:'JetBrains Mono',monospace;font-size:9px;color:#5EEAD4;letter-spacing:3px;text-transform:uppercase;margin-bottom:14px}
.brand-divider{width:40px;height:2px;background:#14B8A6;margin:0 auto 12px;opacity:.6}
.htitle{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#FFF;line-height:1.1;margin-bottom:4px}
.htitle em{color:#14B8A6;font-style:normal}
.hfull{font-size:11px;color:#8BA8A3;font-style:italic;margin-bottom:10px;line-height:1.5;padding:0 8px}
.hsub{font-size:11px;color:#6B7E94;margin-bottom:14px;line-height:1.6}
.pillars{display:flex;justify-content:center;align-items:stretch;margin-bottom:14px;border:1px solid #14B8A644;border-radius:6px;overflow:hidden;background:#071A22}
.pillar{flex:1;padding:11px 8px;text-align:center;border-right:1px solid #14B8A622}
.pillar:last-child{border-right:none}
.pc{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;display:block;letter-spacing:1px}
.pc.pc-b1{color:#14B8A6}
.pc.pc-b2{color:#5EEAD4}
.pc.pc-b3{color:#FFF}
.pn{font-size:9px;color:#6B7E94;text-transform:uppercase;letter-spacing:.8px;margin-top:3px;display:block}
.llist{padding:10px 16px}
.lcard{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;margin-bottom:8px;border-left:4px solid var(--lc)}
.lcard-n{font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--lc);letter-spacing:2px;margin-bottom:2px}
.lcard-t{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;margin-bottom:4px}
.lcard-d{font-size:11px;color:#6B7E94;line-height:1.6;margin-bottom:6px}
.lcard-tags{display:flex;flex-wrap:wrap;gap:4px}
.ltag{font-size:9px;padding:2px 7px;border-radius:2px;background:#04141A;border:1px solid #1C3A40;color:#CDD6E4}
.pm-hdr{padding:10px 16px 6px;border-bottom:1px solid #1C3A40;background:#061A22;position:sticky;top:42px;z-index:20}
.pm-ey{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px}
.pm-ti{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#FFF}
.pm-wrap{padding:12px 16px}
.pm-new{width:100%;background:#14B8A6;color:#04141A;border:none;border-radius:6px;padding:11px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:12px}
.pm-sl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.pm-sl::after{content:'';flex:1;height:1px;background:#1C3A40}
.pjcard{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all .15s}
.pjcard:hover{border-color:#14B8A655;background:#112A32}
.pjcard.act{border-color:#14B8A6;border-left:4px solid #14B8A6}
.pj-top{display:flex;align-items:flex-start;gap:10px;margin-bottom:6px}
.pj-icon{width:34px;height:34px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;background:#14B8A622;border:1px solid #14B8A644}
.pj-name{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;line-height:1.3;flex:1}
.pj-ctr{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;margin-top:1px}
.pj-abadge{font-size:8px;font-weight:700;background:#14B8A6;color:#04141A;padding:2px 6px;border-radius:3px;flex-shrink:0}
.pj-meta{display:flex;gap:10px;flex-wrap:wrap}
.pj-mi{font-size:10px;color:#8A9BAC}
.pj-mi strong{color:#14B8A6}
.pj-acts{display:flex;gap:6px;margin-top:8px;border-top:1px solid #1C3A4066;padding-top:8px}
.pj-sel{flex:1;background:#14B8A6;color:#04141A;border:none;padding:6px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif}
.pj-edt{background:#112A32;color:#14B8A6;border:1px solid #14B8A644;padding:6px 11px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif}
.pj-del{background:#E74C3C22;color:#E57373;border:1px solid #E74C3C44;padding:6px 11px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif}
.pe-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#061A22;border-bottom:1px solid #1C3A40;position:sticky;top:42px;z-index:20}
.pe-back{background:transparent;border:1px solid #14B8A655;color:#14B8A6;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:'Outfit',sans-serif}
.pe-ti{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#FFF;flex:1}
.pe-save{background:#14B8A6;color:#04141A;border:none;padding:6px 14px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif}
.pe-sec{padding:10px 16px}
.fg{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;margin-bottom:10px;overflow:hidden}
.fg-t{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#14B8A6;padding:8px 12px;background:#071A22;border-bottom:1px solid #1C3A40}
.fr{padding:8px 12px;border-bottom:1px solid #1C3A4033}
.fr:last-child{border-bottom:none}
.fl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px}
.fi{background:#04141A;border:1px solid #1C3A40;border-radius:4px;padding:7px 10px;color:#CDD6E4;font-size:12px;font-family:'Outfit',sans-serif;width:100%;transition:border-color .15s}
.fi:focus{outline:none;border-color:#14B8A6}
.sbd{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6FCF97;background:#27AE6022;border:1px solid #27AE6044;padding:3px 8px;border-radius:3px}
.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px}
.dc{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;cursor:pointer;position:relative;overflow:hidden;transition:all .15s}
.dc:hover{border-color:#14B8A655;background:#112A32}
.dc-bar{position:absolute;top:0;left:0;right:0;height:3px}
.dc-c{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.5px;margin-bottom:3px}
.dc-n{font-size:14px;font-weight:600;color:#FFF;margin-bottom:2px}
.dc-cnt{font-size:10px;color:#6B7E94}
.dc-bg{position:absolute;bottom:6px;right:10px;font-family:'Syne',sans-serif;font-size:28px;color:#14B8A615;line-height:1}
.back-btn{display:flex;align-items:center;gap:6px;background:transparent;border:1px solid #14B8A655;color:#14B8A6;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:10px;font-weight:600;font-family:'Outfit',sans-serif;margin:8px 16px}
.plist2{padding:0 12px 12px}
.pi{background:#0B1F27;border:1px solid #1C3A40;border-radius:5px;margin-bottom:7px;cursor:pointer;overflow:hidden;transition:all .15s}
.pi:hover{border-color:#14B8A655}
.pi.open{border-color:#14B8A6}
.pi-hdr{display:flex;align-items:center;gap:8px;padding:10px 12px}
.pi-id{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;flex-shrink:0;width:26px}
.pi-fa{font-size:8px;font-weight:600;padding:2px 6px;border-radius:2px;flex-shrink:0;white-space:nowrap}
.pi-n{font-size:13px;font-weight:600;color:#FFF;flex:1;line-height:1.3}
.pi-ch{color:#6B7E94;font-size:10px;transition:transform .15s;flex-shrink:0}
.pi-ch.open{transform:rotate(180deg);color:#14B8A6}
.pd{padding:0 12px 12px}
.pd-pv{font-family:'JetBrains Mono',monospace;font-size:8px;color:#0F7B6D;margin:8px 0 6px;font-style:italic}
.pd-obj{font-size:12px;color:#CDD6E4;line-height:1.7;background:#112A32;border-left:3px solid #3A7BD5;padding:10px 12px;border-radius:0 4px 4px 0;margin-bottom:10px}
.stabs{display:flex;border:1px solid #1C3A40;border-radius:4px;overflow:hidden;margin-bottom:10px}
.stab{flex:1;padding:7px 4px;font-size:10px;font-weight:600;text-transform:uppercase;border:none;background:transparent;color:#6B7E94;cursor:pointer;font-family:'Outfit',sans-serif;text-align:center;border-right:1px solid #1C3A40;transition:all .15s}
.stab:last-child{border-right:none}
.stab.on{background:#14B8A6;color:#04141A}
.sl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1.5px;text-transform:uppercase;margin:10px 0 6px;display:flex;align-items:center;gap:6px}
.sl::after{content:'';flex:1;height:1px;background:#1C3A40}
.out-item{background:#04141A;border:1px solid #27AE6033;border-left:2px solid #27AE60;border-radius:4px;padding:10px;margin-bottom:7px}
.out-n{font-size:12px;font-weight:600;color:#6FCF97;margin-bottom:5px}
.tpl-pills{display:flex;flex-wrap:wrap;gap:3px}
.pill{font-size:9px;background:#112A32;border:1px solid #1C3A40;color:#8AB4F8;padding:2px 6px;border-radius:2px}
.tti{background:#04141A;border:1px solid #1C3A40;border-left:2px solid #27AE60;border-radius:4px;padding:10px;margin-bottom:7px}
.tti-n{font-size:12px;font-weight:600;color:#FFF;margin-bottom:2px}
.tti-t{font-size:8px;font-weight:600;padding:1px 5px;border-radius:2px;margin-left:4px;background:#27AE6022;color:#6FCF97;vertical-align:middle}
.tti-h{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:#CDD6E4;line-height:1.8;white-space:pre-wrap;background:#0B1F27;padding:8px;border-radius:3px;margin-top:6px}
.nl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1.2px;text-transform:uppercase;margin-top:8px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between}
.ebt{font-size:9px;background:#14B8A622;border:1px solid #14B8A644;color:#14B8A6;padding:2px 6px;border-radius:3px;cursor:pointer;font-family:'Outfit',sans-serif}
.nv{font-size:11px;color:#CDD6E4;line-height:1.6;background:#0B1F27;padding:8px 10px;border-left:2px solid #14B8A6;border-radius:0 4px 4px 0;white-space:pre-wrap}
.ne{color:#6B7E94;font-style:italic;font-size:11px;background:#0B1F27;padding:8px 10px;border-left:2px solid #1C3A40;border-radius:0 4px 4px 0}
.nta{width:100%;background:#04141A;border:1px solid #14B8A6;border-radius:4px;padding:8px 10px;color:#CDD6E4;font-size:11px;font-family:'Outfit',sans-serif;resize:vertical;min-height:80px;line-height:1.6}
.nta:focus{outline:none}
.nacts{display:flex;gap:6px;margin-top:4px}
.nsav{background:#27AE60;color:#FFF;border:none;padding:5px 12px;border-radius:3px;font-size:10px;cursor:pointer;font-family:'Outfit',sans-serif}
.ncnc{background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:5px 12px;border-radius:3px;font-size:10px;cursor:pointer;font-family:'Outfit',sans-serif}
.lib-wrap{padding:12px 16px}
.lsrc{width:100%;background:#0B1F27;border:1px solid #1C3A40;border-radius:5px;padding:10px 12px;color:#CDD6E4;font-size:13px;font-family:'Outfit',sans-serif;margin-bottom:10px}
.lsrc:focus{outline:none;border-color:#14B8A6}
.lsrc::placeholder{color:#6B7E94}
.chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:8px}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;font-size:10px;font-weight:500;padding:5px 10px;border-radius:20px;border:1px solid #1C3A40;background:transparent;color:#6B7E94;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .15s;white-space:nowrap}
.chip.on{background:#14B8A6;color:#04141A;border-color:#14B8A6}
.lcnt{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;margin-bottom:10px}
.lc{background:#0B1F27;border:1px solid #1C3A40;border-radius:7px;margin-bottom:9px;overflow:hidden;cursor:pointer;transition:all .15s}
.lc:hover{border-color:#14B8A655;background:#112A32}
.lc.open{border-color:#14B8A6}
.lc-h{display:flex;align-items:center;gap:8px;padding:11px 12px}
.lc-t{font-size:8px;font-weight:600;padding:2px 7px;border-radius:2px;flex-shrink:0}
.ltype-T{background:#3A7BD522;color:#8AB4F8;border:1px solid #3A7BD544}
.ltype-H{background:#27AE6022;color:#6FCF97;border:1px solid #27AE6044}
.ltype-A{background:#9B59B622;color:#C39BD3;border:1px solid #9B59B644}
.ltype-E{background:#F39C1222;color:#F5CBA7;border:1px solid #F39C1244}
.lc-n{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;flex:1;line-height:1.3}
.lc-ch{color:#6B7E94;font-size:10px;transition:transform .15s;flex-shrink:0}
.lc-ch.open{transform:rotate(180deg);color:#14B8A6}
.lc-how{font-family:'JetBrains Mono',monospace;font-size:10px;color:#CDD6E4;line-height:1.8;white-space:pre-wrap;padding:12px;background:#04141A;border-top:1px solid #1C3A40}
.tw{padding:12px 16px}
.tsrc{width:100%;background:#0B1F27;border:1px solid #1C3A40;border-radius:5px;padding:10px 12px;color:#CDD6E4;font-size:13px;font-family:'Outfit',sans-serif;margin-bottom:8px}
.tsrc:focus{outline:none;border-color:#14B8A6}
.tsrc::placeholder{color:#6B7E94}
.tcnt{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;margin-bottom:10px}
.tc{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;margin-bottom:8px;overflow:hidden;cursor:pointer;transition:all .15s}
.tc:hover{border-color:#14B8A655;background:#112A32}
.tc.open{border-color:#14B8A6}
.tc-h{display:flex;align-items:center;gap:8px;padding:10px 12px}
.tc-cat{font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;flex-shrink:0}
.tc-n{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#FFF;flex:1;line-height:1.3}
.tc-pr{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;flex-shrink:0}
.tc-ch{color:#6B7E94;font-size:10px;transition:transform .15s;flex-shrink:0}
.tc-ch.open{transform:rotate(180deg);color:#14B8A6}
.tc-body{border-top:1px solid #1C3A4066;padding:12px}
.tc-meta{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;background:#04141A;padding:8px 10px;border-radius:4px}
.tc-mr{font-size:10px;color:#8A9BAC;line-height:1.5;display:flex;gap:6px}
.tc-ml{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1px;flex-shrink:0;min-width:65px}
.tc-sec{margin-bottom:12px}
.tc-st{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:#14B8A6;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #1C3A40}
.tf{background:#04141A;border:1px solid #1C3A40;border-radius:4px;padding:8px 10px;margin-bottom:5px}
.tf-h{display:flex;align-items:center;gap:6px;margin-bottom:3px}
.tf-n{font-size:11px;font-weight:600;color:#FFF;flex:1}
.tf-tp{font-family:'JetBrains Mono',monospace;font-size:8px;padding:1px 5px;border-radius:2px;flex-shrink:0}
.tft-t{background:#3A7BD522;color:#8AB4F8;border:1px solid #3A7BD544}
.tft-ta{background:#9B59B622;color:#C39BD3;border:1px solid #9B59B644}
.tft-d{background:#14B8A622;color:#14B8A6;border:1px solid #14B8A644}
.tft-n{background:#27AE6022;color:#6FCF97;border:1px solid #27AE6044}
.tft-tbl{background:#E67E2222;color:#F0A070;border:1px solid #E67E2244}
.tf-req{font-size:8px;color:#E57373;background:#E74C3C22;border:1px solid #E74C3C44;padding:1px 5px;border-radius:2px;flex-shrink:0}
.tf-pval{margin-top:5px}
.tf-ta{width:100%;background:#0B1F27;border:1px solid #1C3A40;border-radius:3px;padding:6px 8px;color:#CDD6E4;font-size:10px;font-family:'Outfit',sans-serif;resize:vertical;min-height:42px;line-height:1.5}
.tf-ta:focus{outline:none;border-color:#14B8A6}
.tf-ta:disabled{opacity:.4;cursor:not-allowed}
.tf-in{width:100%;background:#0B1F27;border:1px solid #1C3A40;border-radius:3px;padding:6px 8px;color:#CDD6E4;font-size:10px;font-family:'Outfit',sans-serif}
.tf-in:focus{outline:none;border-color:#14B8A6}
.tf-in:disabled{opacity:.4;cursor:not-allowed}
.tc-sr{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
.tc-sbtn{background:#14B8A6;color:#04141A;border:none;padding:6px 14px;border-radius:3px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif}
.tc-clr{background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:6px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:'Outfit',sans-serif}
.tc-sbd{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6FCF97;background:#27AE6022;border:1px solid #27AE6044;padding:3px 8px;border-radius:3px}
.users-wrap{padding:12px 16px}
.ucard{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;margin-bottom:8px}
.ucard-top{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.uavatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;border:2px solid}
.uname{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF}
.uuname{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94}
.urole{font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px}
.uacts{display:flex;gap:6px;margin-top:8px;border-top:1px solid #1C3A4066;padding-top:8px}
.u-btn{background:transparent;border:1px solid #1C3A40;color:#8A9BAC;padding:5px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:'Outfit',sans-serif}
.u-btn.danger{border-color:#E74C3C44;color:#E57373}
.u-btn.primary{background:#14B8A6;color:#04141A;border-color:#14B8A6;font-weight:700}
.uform{background:#0B1F27;border:1px solid #14B8A644;border-radius:6px;padding:14px;margin-bottom:12px}
.uform-ti{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#14B8A6;margin-bottom:10px}
.role-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px}
.role-opt{border:1px solid #1C3A40;border-radius:5px;padding:8px 6px;cursor:pointer;text-align:center;transition:all .15s;background:#04141A}
.role-opt.sel{border-width:2px}
.role-opt-icon{font-size:18px;display:block;margin-bottom:3px}
.role-opt-label{font-family:'Syne',sans-serif;font-size:10px;font-weight:700;color:#FFF}
.role-opt-sub{font-size:8px;color:#6B7E94;margin-top:1px}
.noproj{margin:20px 16px;background:#E74C3C11;border:1px solid #E74C3C44;border-radius:6px;padding:16px;text-align:center}
.noproj-t{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#E57373;margin-bottom:4px}
.noproj-d{font-size:11px;color:#8A9BAC;line-height:1.6;margin-bottom:12px}
.noproj-btn{background:#14B8A6;color:#04141A;border:none;padding:9px 18px;border-radius:4px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;cursor:pointer}
.modal-ov{position:fixed;inset:0;background:#000000CC;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-box{background:#0B1F27;border:1px solid #E74C3C;border-radius:8px;padding:20px;max-width:320px;width:100%}
.modal-t{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#E57373;margin-bottom:8px}
.modal-d{font-size:12px;color:#8A9BAC;line-height:1.6;margin-bottom:16px}
.modal-btns{display:flex;gap:8px}
.modal-cnc{flex:1;background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:8px;border-radius:4px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12px}
.modal-del{flex:1;background:#E74C3C;color:#FFF;border:none;padding:8px;border-radius:4px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12px;font-weight:700}
.plist{padding:12px 16px}
.p-card{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:14px;margin-bottom:9px;display:flex;gap:10px}
.p-num{width:30px;height:30px;background:#14B8A6;color:#04141A;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;flex-shrink:0}
.p-en{font-size:13px;font-weight:600;color:#FFF;margin-bottom:2px}
.p-es{font-size:10px;color:#14B8A6;margin-bottom:4px;font-style:italic}
.p-desc{font-size:11px;color:#6B7E94;line-height:1.6}
.footer{text-align:center;font-family:'JetBrains Mono',monospace;font-size:8px;color:#0F7B6D;letter-spacing:1.5px;padding:14px;border-top:1px solid #1C3A40}
.boom-subnav{background:#061A22;border-bottom:1px solid #1C3A40;padding:8px 14px;display:flex;align-items:center;gap:8px;position:sticky;top:74px;z-index:18;overflow-x:auto;scrollbar-width:none}
.boom-subnav::-webkit-scrollbar{display:none}
.boom-snb{padding:6px 12px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;border:none;background:transparent;color:#6B7E94;cursor:pointer;border-radius:4px;font-family:'Outfit',sans-serif;white-space:nowrap;transition:all .15s}
.boom-snb.on{background:#1ABC9C22;color:#1ABC9C;border:1px solid #1ABC9C44}
.boom-add-btn{margin-left:auto;flex-shrink:0;background:#1ABC9C;color:#04141A;border:none;padding:6px 14px;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif}
.boom-panel{padding:12px 16px}
.boom-greeting{font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:#FFF;margin-bottom:4px}
.boom-greeting-sub{font-size:11px;color:#6B7E94;margin-bottom:14px}
.boom-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.boom-stat{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;text-align:center}
.boom-stat-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#1ABC9C}
.boom-stat-val.red{color:#E74C3C}
.boom-stat-val.amber{color:#F39C12}
.boom-stat-lbl{font-size:10px;color:#6B7E94;margin-top:2px}
.boom-section-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;color:#14B8A6;letter-spacing:2px;text-transform:uppercase;margin:14px 0 8px;display:flex;align-items:center;gap:8px}
.boom-section-lbl::after{content:'';flex:1;height:1px;background:#1C3A40}
.boom-act-row{background:#0B1F27;border:1px solid #1C3A40;border-left:3px solid var(--pcolor);border-radius:0 5px 5px 0;padding:10px 12px;margin-bottom:6px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:10px}
.boom-act-row:hover{border-color:#1ABC9C55;background:#112A32}
.boom-act-row.done{opacity:.6}
.boom-act-title{font-size:12px;font-weight:600;color:#FFF;flex:1;line-height:1.4}
.boom-act-meta{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap}
.boom-proj-tag{font-size:8px;padding:2px 6px;border-radius:3px;background:#14B8A622;color:#14B8A6;border:1px solid #14B8A644;font-family:'JetBrains Mono',monospace;white-space:nowrap}
.boom-date{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94}
.boom-date.overdue{color:#E74C3C;font-weight:700}
.boom-date.today{color:#F39C12;font-weight:700}
.boom-assignees{display:flex;gap:2px}
.boom-avatar{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;border:1px solid #04141A;color:#04141A}
.boom-progress-bar{height:3px;background:#1C3A40;border-radius:2px;overflow:hidden;width:48px;flex-shrink:0}
.boom-progress-fill{height:100%;border-radius:2px;background:#1ABC9C;transition:width .3s}
.boom-board-wrap{padding:10px 0 10px 14px;overflow-x:auto;display:flex;gap:10px;min-height:calc(100vh - 200px);scrollbar-width:thin}
.boom-col{min-width:240px;max-width:240px;background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;display:flex;flex-direction:column;max-height:calc(100vh - 210px);overflow:hidden}
.boom-col-hdr{padding:10px 12px;border-bottom:1px solid #1C3A40;display:flex;align-items:center;gap:6px;flex-shrink:0}
.boom-col-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.boom-col-name{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:#FFF;flex:1}
.boom-col-cnt{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;background:#04141A;padding:2px 6px;border-radius:10px}
.boom-col-wip{font-size:8px}
.boom-cards{padding:8px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px}
.boom-cards::-webkit-scrollbar{width:3px}
.boom-cards::-webkit-scrollbar-thumb{background:#1C3A40;border-radius:3px}
.boom-card{background:#04141A;border:1px solid #1C3A40;border-top:3px solid var(--pcolor);border-radius:0 0 5px 5px;padding:10px;cursor:pointer;transition:all .15s}
.boom-card:hover{border-color:#1ABC9C55}
.boom-card-title{font-size:12px;font-weight:600;color:#FFF;line-height:1.4;margin-bottom:7px}
.boom-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:6px}
.boom-card-tags{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.boom-card-tag{font-size:8px;background:#1C3A40;color:#8A9BAC;padding:1px 5px;border-radius:3px;font-family:'JetBrains Mono',monospace}
.boom-col-add{padding:8px;flex-shrink:0;border-top:1px solid #1C3A40}
.boom-col-add-btn{width:100%;background:transparent;border:1px dashed #1C3A40;border-radius:4px;color:#6B7E94;font-size:11px;cursor:pointer;padding:7px;font-family:'Outfit',sans-serif;transition:all .15s}
.boom-col-add-btn:hover{border-color:#1ABC9C44;color:#1ABC9C}
.boom-list-wrap{padding:0 16px 16px}
.boom-list-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}
.boom-list-th{background:#071A22;color:#14B8A6;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:8px 10px;text-align:left;border-bottom:2px solid #14B8A633;white-space:nowrap}
.boom-list-td{padding:8px 10px;border-bottom:1px solid #1C3A40;color:#CDD6E4;vertical-align:middle;cursor:pointer}
.boom-list-tr:hover .boom-list-td{background:#0B1F2744}
.boom-modal-ov{position:fixed;inset:0;background:#000000BB;z-index:200;display:flex;align-items:flex-end;justify-content:center}
.boom-modal{background:#0B1F27;border:1px solid #1ABC9C44;border-radius:10px 10px 0 0;width:100%;max-width:520px;max-height:90vh;overflow-y:auto}
.boom-modal-hdr{padding:14px 16px;border-bottom:1px solid #1C3A40;display:flex;align-items:center;gap:10px;position:sticky;top:0;background:#0B1F27;z-index:1}
.boom-modal-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#FFF;flex:1}
.boom-modal-close{background:transparent;border:1px solid #1C3A40;color:#6B7E94;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.boom-modal-body{padding:16px}
.boom-fl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:5px;margin-top:12px;display:block}
.boom-fi{background:#04141A;border:1px solid #1C3A40;border-radius:4px;padding:8px 10px;color:#CDD6E4;font-size:12px;font-family:'Outfit',sans-serif;width:100%;transition:border-color .15s}
.boom-fi:focus{outline:none;border-color:#1ABC9C}
.boom-ta{background:#04141A;border:1px solid #1C3A40;border-radius:4px;padding:8px 10px;color:#CDD6E4;font-size:12px;font-family:'Outfit',sans-serif;width:100%;resize:vertical;min-height:60px;line-height:1.6}
.boom-ta:focus{outline:none;border-color:#1ABC9C}
.boom-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.boom-prio-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px}
.boom-prio-opt{border:1px solid #1C3A40;border-radius:5px;padding:8px;cursor:pointer;text-align:center;font-size:11px;font-weight:600;transition:all .15s;background:#04141A;color:#8A9BAC}
.boom-prio-opt.sel{border-width:2px;color:#FFF}
.boom-modal-footer{padding:12px 16px;border-top:1px solid #1C3A40;display:flex;gap:8px;position:sticky;bottom:0;background:#0B1F27}
.boom-save-btn{flex:1;background:#1ABC9C;color:#04141A;border:none;padding:10px;border-radius:5px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer}
.boom-cancel-btn{background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:10px 16px;border-radius:5px;font-size:12px;cursor:pointer;font-family:'Outfit',sans-serif}
.boom-del-btn{background:#E74C3C22;color:#E57373;border:1px solid #E74C3C44;padding:10px 14px;border-radius:5px;font-size:12px;cursor:pointer;font-family:'Outfit',sans-serif}
.boom-detail-field{margin-bottom:10px}
.boom-detail-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:3px}
.boom-detail-val{font-size:12px;color:#CDD6E4;line-height:1.6}
.boom-log-item{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #1C3A4033;font-size:10px;color:#8A9BAC}
.boom-log-item:last-child{border-bottom:none}
.boom-log-time{font-family:'JetBrains Mono',monospace;font-size:9px;color:#6B7E94;flex-shrink:0;min-width:70px}
.boom-range{-webkit-appearance:none;width:100%;height:4px;border-radius:2px;background:#1C3A40;outline:none}
.boom-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#1ABC9C;cursor:pointer}
.boom-assignee-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.boom-assignee-opt{font-size:10px;padding:4px 8px;border-radius:4px;cursor:pointer;border:1px solid #1C3A40;background:#04141A;color:#8A9BAC;transition:all .15s}
.boom-assignee-opt.sel{background:#1ABC9C22;border-color:#1ABC9C44;color:#1ABC9C}
.boom-filter-bar{padding:8px 16px;background:#061A22;border-bottom:1px solid #1C3A40;display:flex;gap:8px;align-items:center;overflow-x:auto;scrollbar-width:none}
.boom-filter-bar::-webkit-scrollbar{display:none}
.boom-filter-select{background:#04141A;border:1px solid #1C3A40;border-radius:4px;color:#CDD6E4;font-size:11px;padding:5px 8px;font-family:'Outfit',sans-serif;cursor:pointer;flex-shrink:0}
.boom-filter-select:focus{outline:none;border-color:#1ABC9C}
.boom-filter-label{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1px;text-transform:uppercase;flex-shrink:0}
.coorp-root{background:#04141A;min-height:calc(100vh - 42px);color:#E8F4F1}
.coorp-subnav{background:#061A22;border-bottom:1px solid #14B8A633;padding:8px 14px;display:flex;gap:6px;position:sticky;top:42px;z-index:18;overflow-x:auto;scrollbar-width:none}
.coorp-subnav::-webkit-scrollbar{display:none}
.coorp-snb{padding:7px 12px;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;border:none;background:transparent;color:#6B8A87;cursor:pointer;border-radius:4px;font-family:'Outfit',sans-serif;white-space:nowrap;flex-shrink:0;transition:all .15s}
.coorp-snb.on{background:#14B8A622;color:#14B8A6;border:1px solid #14B8A644}
.coorp-hero{background:linear-gradient(160deg,#061A22 0%,#04141A 100%);border-bottom:1px solid #14B8A633;padding:28px 16px;text-align:center;position:relative;overflow:hidden}
.coorp-hero::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#14B8A6,transparent)}
.coorp-hero-eyebrow{font-family:'JetBrains Mono',monospace;font-size:9px;color:#14B8A6;letter-spacing:3px;text-transform:uppercase;margin-bottom:14px}
.coorp-logo{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;line-height:1;margin-bottom:8px;letter-spacing:2px}
.coorp-logo .s1{color:#14B8A6}
.coorp-logo .s2{color:#5EEAD4}
.coorp-logo .s3{color:#FFF}
.coorp-tagline{font-size:13px;color:#8BA8A3;font-style:italic;margin-bottom:4px}
.coorp-tagline-es{font-size:11px;color:#6B8A87;font-style:italic}
.coorp-hero-quote{margin-top:20px;padding:14px;background:#04141A99;border-left:3px solid #14B8A6;border-radius:0 6px 6px 0;text-align:left;max-width:520px;margin-left:auto;margin-right:auto}
.coorp-hero-quote-en{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#FFF;line-height:1.4;margin-bottom:4px}
.coorp-hero-quote-es{font-size:11px;color:#8BA8A3;font-style:italic;line-height:1.5}
.coorp-sec-hdr{padding:14px 16px 8px;border-bottom:1px solid #14B8A622;background:#061A22}
.coorp-sec-num{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:3px}
.coorp-sec-ti{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#FFF;letter-spacing:1px}
.coorp-sec-sub{font-size:11px;color:#8BA8A3;font-style:italic;margin-top:2px;line-height:1.5}
.coorp-body{padding:16px}
.coorp-pillars{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:8px}
.coorp-pillar{background:#061A22;border:1px solid #14B8A633;border-top:4px solid #14B8A6;border-radius:6px;padding:16px}
.coorp-pillar-hdr{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.coorp-pillar-code{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:#14B8A6;letter-spacing:2px}
.coorp-pillar-arrow{font-size:11px;color:#6B8A87;font-family:'JetBrains Mono',monospace}
.coorp-pillar-en{font-size:11px;color:#8BA8A3;font-style:italic}
.coorp-pillar-name{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#FFF;margin-bottom:10px}
.coorp-pillar-desc{font-size:12px;color:#C9DDD9;line-height:1.7;margin-bottom:10px}
.coorp-pillar-claim{padding:10px 12px;background:#04141A;border-left:3px solid #14B8A6;border-radius:0 4px 4px 0;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#5EEAD4;font-style:italic}
.coorp-mv{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:10px}
.coorp-mv-box{background:#061A22;border:1px solid #14B8A633;border-radius:6px;padding:14px;position:relative}
.coorp-mv-box::before{content:'';position:absolute;top:0;left:12px;right:12px;height:3px;background:#14B8A6;border-radius:0 0 2px 2px}
.coorp-mv-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:8px;margin-top:6px}
.coorp-mv-main{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;line-height:1.5;margin-bottom:8px}
.coorp-mv-sub{font-size:11px;color:#8BA8A3;line-height:1.6;font-style:italic}
.coorp-mv-tag{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1.5px;margin-top:8px}
.coorp-cards-grid{display:grid;grid-template-columns:1fr;gap:8px}
.coorp-card{background:#061A22;border:1px solid #14B8A633;border-left:3px solid #14B8A6;border-radius:0 5px 5px 0;padding:12px 14px}
.coorp-card-ti{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;margin-bottom:5px;line-height:1.3}
.coorp-card-d{font-size:11px;color:#8BA8A3;line-height:1.6}
.coorp-ps{background:#061A22;border:1px solid #14B8A633;border-radius:6px;padding:12px;margin-bottom:8px;display:grid;grid-template-columns:1fr;gap:8px}
.coorp-ps-prob{display:flex;gap:8px;align-items:flex-start}
.coorp-ps-icon{font-size:13px;color:#E57373;flex-shrink:0;margin-top:2px}
.coorp-ps-prob-t{font-size:11px;color:#C9DDD9;line-height:1.5;flex:1}
.coorp-ps-sol{display:flex;gap:8px;align-items:flex-start;padding-top:8px;border-top:1px solid #14B8A622}
.coorp-ps-icon2{font-size:13px;color:#14B8A6;flex-shrink:0;margin-top:2px}
.coorp-ps-sol-t{font-size:11px;color:#5EEAD4;line-height:1.5;flex:1;font-weight:500}
.coorp-ps-pillar{font-family:'Syne',sans-serif;font-size:9px;font-weight:700;color:#14B8A6;background:#14B8A622;border:1px solid #14B8A644;padding:2px 7px;border-radius:3px;flex-shrink:0;align-self:flex-start;letter-spacing:1px}
.coorp-job{background:#061A22;border:1px solid #14B8A633;border-radius:6px;margin-bottom:10px;overflow:hidden}
.coorp-job-hdr{background:#14B8A622;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #14B8A644}
.coorp-job-ti{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF}
.coorp-job-pillar{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#14B8A6;letter-spacing:1.5px}
.coorp-job-body{padding:12px 14px}
.coorp-job-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B8A87;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;margin-top:4px}
.coorp-job-list{list-style:none;padding:0;margin:0 0 10px}
.coorp-job-item{font-size:11px;color:#C9DDD9;padding:4px 0 4px 12px;position:relative;line-height:1.5}
.coorp-job-item::before{content:'▸';position:absolute;left:0;color:#14B8A6;font-size:10px}
.coorp-job-sol{font-size:11px;color:#8BA8A3;line-height:1.7;font-style:italic;padding:8px 10px;background:#04141A;border-left:2px solid #14B8A6;border-radius:0 3px 3px 0}
.coorp-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px}
.coorp-metric{background:#061A22;border:1px solid #14B8A633;border-radius:6px;padding:16px 8px;text-align:center;position:relative}
.coorp-metric::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#14B8A6}
.coorp-metric-val{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;color:#14B8A6;line-height:1;margin-bottom:6px}
.coorp-metric-lbl-en{font-size:9px;color:#FFF;font-weight:600;line-height:1.3;margin-bottom:3px}
.coorp-metric-lbl-es{font-size:8px;color:#8BA8A3;font-style:italic;line-height:1.3;margin-bottom:8px}
.coorp-metric-pillar{display:inline-block;font-family:'Syne',sans-serif;font-size:9px;font-weight:700;color:#14B8A6;background:#14B8A622;padding:3px 8px;border-radius:3px;letter-spacing:1px}
.coorp-metrics-footnote{font-size:10px;color:#6B8A87;font-style:italic;text-align:center;padding:6px}
.coorp-vals-group{background:#061A22;border:1px solid #14B8A633;border-radius:6px;padding:14px;margin-bottom:10px}
.coorp-vals-hdr{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #14B8A633}
.coorp-vals-code{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#14B8A6;letter-spacing:1.5px}
.coorp-vals-name{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;flex:1}
.coorp-val{margin-bottom:10px;padding-left:10px;border-left:2px solid #14B8A644}
.coorp-val:last-child{margin-bottom:0}
.coorp-val-ti{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#5EEAD4;margin-bottom:3px}
.coorp-val-d{font-size:11px;color:#C9DDD9;line-height:1.5}
.coorp-closing{background:linear-gradient(160deg,#061A22 0%,#04141A 100%);padding:24px 16px;text-align:center;border-top:1px solid #14B8A633;margin-top:10px}
.coorp-closing-logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;letter-spacing:3px;margin-bottom:10px}
.coorp-closing-main{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#FFF;line-height:1.4;margin-bottom:6px;padding:0 10px}
.coorp-closing-main em{color:#14B8A6;font-style:normal}
.coorp-closing-sub{font-size:11px;color:#8BA8A3;font-style:italic;margin-bottom:16px}
.coorp-closing-pillars{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:16px}
.coorp-closing-p{background:#04141A;border:1px solid #14B8A633;border-radius:5px;padding:10px 6px}
.coorp-closing-pc{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#14B8A6;letter-spacing:1.5px;margin-bottom:4px}
.coorp-closing-pn{font-size:9px;color:#8BA8A3;font-style:italic;line-height:1.3}
.coorp-regions{font-family:'JetBrains Mono',monospace;font-size:9px;color:#14B8A6;letter-spacing:2px;margin-bottom:10px}
.coorp-standards{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B8A87;letter-spacing:1px;line-height:1.7;padding:0 10px}
.coorp-msg-list{display:flex;flex-direction:column;gap:8px}
.coorp-msg{background:#061A22;border:1px solid #14B8A633;border-left:3px solid #14B8A6;border-radius:0 5px 5px 0;padding:12px 14px}
.coorp-msg-en{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#FFF;line-height:1.4;margin-bottom:4px}
.coorp-msg-es{font-size:11px;color:#8BA8A3;font-style:italic;line-height:1.5}
.coorp-caps{display:grid;grid-template-columns:1fr;gap:6px}
.coorp-cap{background:#061A22;border:1px solid #14B8A633;border-radius:5px;padding:10px 12px;display:flex;align-items:center;gap:10px}
.coorp-cap-icon{font-size:16px;flex-shrink:0}
.coorp-cap-ti{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;color:#FFF;margin-bottom:2px}
.coorp-cap-d{font-size:10px;color:#8BA8A3;line-height:1.4}
.coorp-cap-body{flex:1}
.coorp-footer-mark{text-align:center;font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:2px;padding:16px;background:#04141A;border-top:1px solid #14B8A622}
/* ═══════════════════════════════════════════
   OUTPUT TEMPLATE MODAL — PMBOK 8
═══════════════════════════════════════════ */
.out-btns{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.out-tpl-btn{background:#14B8A622;border:1px solid #14B8A644;color:#14B8A6;padding:5px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600;display:inline-flex;align-items:center;gap:4px;transition:all .15s}
.out-tpl-btn:hover{background:#14B8A644;border-color:#14B8A6}
.out-tpl-badge{font-size:8px;font-family:'JetBrains Mono',monospace;color:#5EEAD4;background:#14B8A622;border:1px solid #14B8A644;padding:2px 6px;border-radius:2px;margin-left:6px;letter-spacing:.5px}
.tpl-modal-ov{position:fixed;inset:0;background:#000000DD;z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto}
.tpl-modal{background:#0B1F27;border:1px solid #14B8A6;border-radius:8px;width:100%;max-width:680px;margin:auto;overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 40px)}
.tpl-modal-hdr{padding:14px 16px;border-bottom:1px solid #14B8A633;background:#061A22;display:flex;align-items:center;gap:10px;flex-shrink:0}
.tpl-modal-ti{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#FFF;flex:1;line-height:1.3}
.tpl-modal-sub{font-size:10px;color:#5EEAD4;font-style:italic;margin-top:2px}
.tpl-modal-close{background:transparent;border:1px solid #1C3A40;color:#6B7E94;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.tpl-modal-body{padding:14px 16px;overflow-y:auto;flex:1}
.tpl-content{background:#04141A;border:1px solid #1C3A40;border-radius:5px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#C9DDD9;line-height:1.75;white-space:pre-wrap;word-wrap:break-word}
.tpl-content h1,.tpl-content h2,.tpl-content h3{font-family:'Syne',sans-serif}
.tpl-info{background:#14B8A611;border-left:3px solid #14B8A6;border-radius:0 4px 4px 0;padding:8px 10px;margin-bottom:10px;font-size:10px;color:#8BA8A3;line-height:1.6}
.tpl-info strong{color:#14B8A6}
.tpl-modal-ftr{padding:12px 16px;border-top:1px solid #14B8A633;background:#061A22;display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}
.tpl-btn-copy{background:transparent;color:#8BA8A3;border:1px solid #1C3A40;padding:8px 14px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600;display:inline-flex;align-items:center;gap:5px}
.tpl-btn-copy:hover{border-color:#14B8A6;color:#14B8A6}
.tpl-btn-use{flex:1;background:#14B8A6;color:#04141A;border:none;padding:8px 14px;border-radius:4px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;cursor:pointer;min-width:180px}
.tpl-btn-cancel{background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:8px 14px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif}
.tpl-copy-toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#27AE60;color:#FFF;padding:8px 16px;border-radius:20px;font-size:11px;font-weight:600;z-index:300;box-shadow:0 4px 12px #00000066;font-family:'Outfit',sans-serif;pointer-events:none}
/* ═══════════════════════════════════════════
   M&C — MONITOREO Y CONTROL
═══════════════════════════════════════════ */
.mc-wrap{padding:12px 16px}
.mc-noproj{background:#E74C3C11;border:1px solid #E74C3C44;border-radius:6px;padding:20px;text-align:center;margin:10px 0}
.mc-noproj-t{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#E57373;margin-bottom:6px}
.mc-noproj-d{font-size:11px;color:#8A9BAC;line-height:1.6;margin-bottom:10px}
.mc-actions-top{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.mc-edit-btn{flex:1;background:#14B8A6;color:#04141A;border:none;border-radius:5px;padding:10px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;cursor:pointer;min-width:160px}
.mc-report-date{font-family:'JetBrains Mono',monospace;font-size:10px;color:#5EEAD4;background:#14B8A622;border:1px solid #14B8A644;padding:6px 10px;border-radius:4px;align-self:center}
.mc-empty{text-align:center;padding:24px;background:#0B1F27;border:1px dashed #1C3A40;border-radius:6px}
.mc-empty-ic{font-size:32px;margin-bottom:8px}
.mc-empty-t{font-family:'Syne',sans-serif;font-size:13px;color:#CDD6E4;margin-bottom:4px;font-weight:700}
.mc-empty-d{font-size:11px;color:#6B7E94;line-height:1.6}
/* Global alert banner */
.mc-banner{border-radius:6px;padding:12px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:flex-start;border:1px solid;border-left-width:4px}
.mc-banner-green{background:#27AE6015;border-color:#27AE60;color:#6FCF97}
.mc-banner-yellow{background:#F39C1215;border-color:#F39C12;color:#F5CBA7}
.mc-banner-orange{background:#E67E2215;border-color:#E67E22;color:#F0A070}
.mc-banner-red{background:#E74C3C15;border-color:#E74C3C;color:#E57373}
.mc-banner-ic{font-size:20px;flex-shrink:0}
.mc-banner-body{flex:1}
.mc-banner-t{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;margin-bottom:3px}
.mc-banner-d{font-size:11px;line-height:1.5;color:#CDD6E4}
/* EVM summary bar */
.mc-evm-bar{background:#0B1F27;border:1px solid #14B8A633;border-radius:6px;padding:10px;margin-bottom:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.mc-evm-cell{text-align:center;padding:6px 4px}
.mc-evm-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#6B7E94;letter-spacing:1px;text-transform:uppercase;margin-bottom:2px}
.mc-evm-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#14B8A6;line-height:1.1}
.mc-evm-sub{font-size:9px;color:#8BA8A3;margin-top:2px}
/* Dashboard cards */
.mc-grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px}
.mc-card{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;padding:12px;border-left:4px solid var(--mc-c,#6B7E94)}
.mc-card-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.mc-card-ic{font-size:18px;flex-shrink:0}
.mc-card-ti{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#FFF;flex:1}
.mc-card-status{font-size:9px;font-weight:700;padding:2px 8px;border-radius:10px;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap}
.mc-green{--mc-c:#27AE60}
.mc-yellow{--mc-c:#F39C12}
.mc-orange{--mc-c:#E67E22}
.mc-red{--mc-c:#E74C3C}
.mc-na{--mc-c:#6B7E94}
.mc-st-green{background:#27AE6022;color:#6FCF97;border:1px solid #27AE6044}
.mc-st-yellow{background:#F39C1222;color:#F5CBA7;border:1px solid #F39C1244}
.mc-st-orange{background:#E67E2222;color:#F0A070;border:1px solid #E67E2244}
.mc-st-red{background:#E74C3C22;color:#E57373;border:1px solid #E74C3C44}
.mc-st-na{background:#6B7E9422;color:#8A9BAC;border:1px solid #6B7E9444}
.mc-card-metrics{display:flex;gap:12px;margin-bottom:8px;flex-wrap:wrap;background:#04141A;padding:8px 10px;border-radius:4px}
.mc-mm{flex:1;min-width:70px}
.mc-mm-lbl{font-family:'JetBrains Mono',monospace;font-size:7px;color:#6B7E94;letter-spacing:1px;text-transform:uppercase;margin-bottom:2px}
.mc-mm-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#CDD6E4}
.mc-mm-val.hl{color:var(--mc-c)}
.mc-card-msg{font-size:11px;color:#CDD6E4;line-height:1.6;margin-bottom:7px;padding:7px 10px;background:#04141A;border-left:2px solid var(--mc-c);border-radius:0 3px 3px 0}
.mc-card-action{font-size:11px;line-height:1.6;padding:8px 10px;background:#04141A99;border:1px dashed var(--mc-c);border-radius:4px;color:#CDD6E4}
.mc-card-action strong{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--mc-c);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:3px}
/* Edit form */
.mc-form{background:#0B1F27;border:1px solid #14B8A644;border-radius:6px;overflow:hidden;margin-bottom:12px}
.mc-form-sec{padding:12px 14px;border-bottom:1px solid #1C3A40}
.mc-form-sec:last-child{border-bottom:none}
.mc-form-st{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#14B8A6;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.mc-form-st-ic{font-size:14px}
.mc-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mc-form-field{display:flex;flex-direction:column;gap:3px}
.mc-form-field.full{grid-column:1/-1}
.mc-form-lbl{font-family:'JetBrains Mono',monospace;font-size:7px;color:#6B7E94;letter-spacing:1px;text-transform:uppercase}
.mc-form-inp{background:#04141A;border:1px solid #1C3A40;border-radius:3px;padding:6px 8px;color:#CDD6E4;font-size:11px;font-family:'Outfit',sans-serif}
.mc-form-inp:focus{outline:none;border-color:#14B8A6}
.mc-form-hint{font-size:10px;color:#8BA8A3;font-style:italic;margin-top:4px;line-height:1.5}
.mc-form-ftr{display:flex;gap:8px;padding:12px 14px;background:#061A22;border-top:1px solid #1C3A40}
.mc-form-save{flex:1;background:#14B8A6;color:#04141A;border:none;padding:9px;border-radius:4px;font-family:'Syne',sans-serif;font-size:12px;font-weight:700;cursor:pointer}
.mc-form-cancel{background:transparent;color:#6B7E94;border:1px solid #1C3A40;padding:9px 14px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif}
/* Alert summary panel */
.mc-alerts-panel{background:#0B1F27;border:1px solid #1C3A40;border-radius:6px;overflow:hidden;margin-bottom:12px}
.mc-alerts-hdr{padding:10px 14px;background:#061A22;border-bottom:1px solid #1C3A40;display:flex;align-items:center;gap:8px}
.mc-alerts-t{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#FFF;flex:1}
.mc-alerts-count{font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;background:#E74C3C22;color:#E57373;border:1px solid #E74C3C44}
.mc-alerts-empty{padding:14px;text-align:center;font-size:11px;color:#6FCF97;font-style:italic}
.mc-alert-item{display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid #1C3A4055;align-items:flex-start}
.mc-alert-item:last-child{border-bottom:none}
.mc-alert-ic{font-size:14px;flex-shrink:0}
.mc-alert-body{flex:1;font-size:11px;color:#CDD6E4;line-height:1.5}
.mc-alert-ax{font-family:'JetBrains Mono',monospace;font-size:8px;color:#8BA8A3;letter-spacing:1px;text-transform:uppercase;margin-bottom:2px}
/* ═══════════════════════════════════════════
   INPUTS + PDF — PMBOK 8
═══════════════════════════════════════════ */
.in-item{background:#04141A;border:1px solid #1C3A40;border-left:2px solid #3A7BD5;border-radius:4px;padding:8px 10px;margin-bottom:5px;display:flex;align-items:flex-start;gap:8px;cursor:pointer;transition:all .15s}
.in-item:hover{border-color:#3A7BD5}
.in-item.ext{border-left-color:#6B7E94}
.in-item.eef{border-left-color:#F39C12}
.in-item.opa{border-left-color:#9B59B6}
.in-ic{font-size:13px;flex-shrink:0;margin-top:1px}
.in-body{flex:1;min-width:0}
.in-name{font-size:12px;color:#FFF;font-weight:500;line-height:1.4;margin-bottom:2px}
.in-src{font-family:'JetBrains Mono',monospace;font-size:9px;color:#5EEAD4;letter-spacing:.5px}
.in-src.ext{color:#8BA8A3}
.in-src.eef{color:#F5CBA7}
.in-src.opa{color:#C39BD3}
.in-src-link{cursor:pointer;text-decoration:underline;text-decoration-style:dotted}
.in-src-link:hover{color:#14B8A6}
.pdf-btns-row{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap}
.pdf-btn{background:#14B8A622;border:1px solid #14B8A644;color:#14B8A6;padding:6px 12px;border-radius:4px;font-size:11px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600;display:inline-flex;align-items:center;gap:5px;transition:all .15s}
.pdf-btn:hover{background:#14B8A644;border-color:#14B8A6}
.pdf-btn-all{background:#14B8A6;color:#04141A;border-color:#14B8A6}
.pdf-btn-all:hover{background:#5EEAD4}
/* ═══════════════════════════════════════════
   PDF DOWNLOAD MODAL
═══════════════════════════════════════════ */
.pdf-dl-ov{position:fixed;inset:0;background:#000000DD;z-index:250;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto}
.pdf-dl-modal{background:#0B1F27;border:2px solid #14B8A6;border-radius:10px;width:100%;max-width:500px;overflow:hidden;box-shadow:0 8px 32px #14B8A655}
.pdf-dl-hdr{padding:16px 18px;background:linear-gradient(135deg,#14B8A6 0%,#5EEAD4 100%);color:#04141A;display:flex;align-items:center;gap:10px}
.pdf-dl-hdr-ic{font-size:24px;flex-shrink:0}
.pdf-dl-hdr-ti{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;flex:1;line-height:1.3}
.pdf-dl-hdr-sub{font-size:10px;opacity:.85;margin-top:2px}
.pdf-dl-close{background:#04141A33;border:none;color:#04141A;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pdf-dl-body{padding:18px}
.pdf-dl-info{background:#04141A;border:1px solid #14B8A633;border-radius:5px;padding:10px 12px;margin-bottom:14px}
.pdf-dl-info-lbl{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px}
.pdf-dl-info-val{font-size:12px;color:#FFF;font-weight:600;margin-bottom:6px;line-height:1.4}
.pdf-dl-info-fn{font-family:'JetBrains Mono',monospace;font-size:10px;color:#5EEAD4;word-break:break-all;background:#061A22;padding:5px 8px;border-radius:3px;border:1px solid #14B8A622}
.pdf-dl-actions{display:flex;flex-direction:column;gap:8px}
.pdf-dl-action{background:#14B8A6;color:#04141A;border:none;border-radius:6px;padding:12px 14px;cursor:pointer;text-align:left;font-family:'Outfit',sans-serif;transition:all .15s;border:2px solid #14B8A6;display:block}
.pdf-dl-action:hover{background:#5EEAD4;border-color:#5EEAD4}
.pdf-dl-action.secondary{background:transparent;color:#14B8A6;border-color:#14B8A6}
.pdf-dl-action.secondary:hover{background:#14B8A622}
.pdf-dl-action.tertiary{background:transparent;color:#8BA8A3;border-color:#1C3A40}
.pdf-dl-action.tertiary:hover{border-color:#8BA8A3;color:#CDD6E4}
.pdf-dl-action-t{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;display:block;margin-bottom:3px}
.pdf-dl-action-d{font-size:10px;line-height:1.5;display:block;opacity:.85;font-weight:400}
.pdf-dl-tip{margin-top:14px;padding:9px 11px;background:#F39C1215;border-left:3px solid #F39C12;border-radius:0 4px 4px 0;font-size:10px;color:#F5CBA7;line-height:1.6}
.pdf-dl-tip strong{color:#F39C12;display:block;margin-bottom:2px;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1px;text-transform:uppercase}
/* ═══════════════════════════════════════════
   SUPABASE / SYNC BAR
═══════════════════════════════════════════ */
.sync-bar{display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:.8px;text-transform:uppercase;padding:2px 8px;border-radius:10px;border:1px solid;cursor:pointer;white-space:nowrap;flex-shrink:0}
.sync-dot{width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0}
.sync-synced{background:#27AE6022;border-color:#27AE6055;color:#6FCF97}
.sync-synced .sync-dot{background:#27AE60;box-shadow:0 0 6px #27AE60}
.sync-syncing{background:#F39C1222;border-color:#F39C1255;color:#F5CBA7}
.sync-syncing .sync-dot{background:#F39C12;animation:pulse 1s infinite}
.sync-offline{background:#6B7E9422;border-color:#6B7E9455;color:#8A9BAC}
.sync-offline .sync-dot{background:#8A9BAC}
.sync-error{background:#E74C3C22;border-color:#E74C3C55;color:#E57373}
.sync-error .sync-dot{background:#E74C3C}
.sync-local{background:#3A7BD522;border-color:#3A7BD555;color:#8AB4F8}
.sync-local .sync-dot{background:#3A7BD5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
/* Login magic link */
.ml-magic{background:#14B8A611;border:1px solid #14B8A644;border-radius:6px;padding:12px;margin-top:14px}
.ml-magic-t{font-family:'JetBrains Mono',monospace;font-size:8px;color:#14B8A6;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.ml-sent{background:#27AE6022;border:1px solid #27AE6055;color:#6FCF97;padding:10px;border-radius:4px;font-size:11px;text-align:center;margin-top:8px;line-height:1.5}
.ml-divider{text-align:center;color:#6B7E94;font-size:10px;margin:16px 0 10px;position:relative}
.ml-divider::before,.ml-divider::after{content:'';position:absolute;top:50%;width:40%;height:1px;background:#1C3A40}
.ml-divider::before{left:0}.ml-divider::after{right:0}
/* Supabase setup */
.sb-setup-card{margin-top:16px;padding:12px;background:#F39C1215;border:1px dashed #F39C1255;border-radius:6px}
.sb-setup-t{font-family:'JetBrains Mono',monospace;font-size:8px;color:#F39C12;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.sb-setup-d{font-size:10px;color:#F5CBA7;line-height:1.6;margin-bottom:8px}
.sb-setup-btn{width:100%;background:#F39C12;color:#04141A;border:none;padding:8px;border-radius:4px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;cursor:pointer}
`;

/* APP */
export default function App(){
  const [users,setUsers]=useState([]);
  const [cu,setCu]=useState(null);
  const [loading,setLoading]=useState(true);
  const [loginF,setLoginF]=useState({u:"",p:""});
  const [loginErr,setLoginErr]=useState("");
  const [showUForm,setShowUForm]=useState(false);
  const [editUId,setEditUId]=useState(null);
  const [uForm,setUForm]=useState({name:"",username:"",password:"",role:"team"});
  const [uFormErr,setUFormErr]=useState("");
  const [delUConf,setDelUConf]=useState(null);
  const [projects,setProjects]=useState([]);
  const [activeId,setActiveId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [editForm,setEditForm]=useState({...EP});
  const [projSaved,setProjSaved]=useState(false);
  const [delPConf,setDelPConf]=useState(null);
  const [notes,setNotes]=useState({});
  const [tmpl,setTmpl]=useState({});
  const [boom,setBoom]=useState({boards:[],acts:{},logs:{}});
  const [boomView,setBoomView]=useState("panel");
  const [openAct,setOpenAct]=useState(null);
  const [actMode,setActMode]=useState("view");
  const [actForm,setActForm]=useState({title:"",desc:"",priority:"medium",assignees:[],dueDate:"",startDate:"",estimatedH:"",colId:"",projId:"",tags:""});
  const [boomFilter,setBoomFilter]=useState({proj:"",priority:"",col:""});
  const [tmplSaved,setTmplSaved]=useState({});
  const [view,setView]=useState("home");
  const [selDom,setSelDom]=useState(null);
  const [openProc,setOpenProc]=useState(null);
  const [procTab,setProcTab]=useState(0);
  const [editNK,setEditNK]=useState(null);
  const [editNV,setEditNV]=useState("");
  const [openLib,setOpenLib]=useState(null);
  const [libQ,setLibQ]=useState("");
  const [libT,setLibT]=useState("Todos");
  const [openTmpl,setOpenTmpl]=useState(null);
  const [tmplQ,setTmplQ]=useState("");
  const [tmplCat,setTmplCat]=useState("All");
  const [coorpSec,setCoorpSec]=useState("identity");
  const [tplModal,setTplModal]=useState(null);
  const [tplCopied,setTplCopied]=useState(false);
  const [mcEdit,setMcEdit]=useState(false);
  const [mcForm,setMcForm]=useState({});
  const [pdfModal,setPdfModal]=useState(null);
  /* ─ SUPABASE / SYNC ─ */
  const [sbConfig,setSbConfig]=useState(null); // {url, key}
  const [showSbSetup,setShowSbSetup]=useState(false);
  const [sbForm,setSbForm]=useState({url:"",key:""});
  const [sbErr,setSbErr]=useState("");
  const [sbReady,setSbReady]=useState(false);
  const [syncStatus,setSyncStatus]=useState(SYNC_STATUS.offline);
  const [syncMsg,setSyncMsg]=useState("");
  const [magicEmail,setMagicEmail]=useState("");
  const [magicSent,setMagicSent]=useState(false);
  const [authChecked,setAuthChecked]=useState(false);

  const activeProj=useMemo(()=>projects.find(p=>p.id===activeId)||null,[projects,activeId]);
  const aN=useMemo(()=>(activeId&&notes[activeId])||{},[notes,activeId]);
  const aT=useMemo(()=>(activeId&&tmpl[activeId])||{},[tmpl,activeId]);
  const visProjs=useMemo(()=>{
    if(!cu)return[];
    if(can(cu,"viewAll"))return projects;
    return projects.filter(p=>p.assignedPM===cu.id||p.assignedTeam===cu.id||p.createdBy===cu.id);
  },[projects,cu]);
  const fTT=useMemo(()=>{const q=libQ.toLowerCase();return TT_LIST.filter(t=>(libT==="Todos"||t.t.startsWith(libT[0]))&&(!q||t.n.toLowerCase().includes(q)||t.how.toLowerCase().includes(q)));},[libQ,libT]);
  const fTPL=useMemo(()=>{const q=tmplQ.toLowerCase();return TPL.filter(t=>(tmplCat==="All"||t.cat===tmplCat)&&(!q||t.n.toLowerCase().includes(q)||t.pr.some(p=>p.includes(q))));},[tmplQ,tmplCat]);

  const boomBoard=useMemo(()=>boom.boards[0]||null,[boom.boards]);
  const allActs=useMemo(()=>Object.values(boom.acts).flat(),[boom.acts]);
  const filteredActs=useMemo(()=>{
    let acts=allActs;
    if(!can(cu,"boomViewAll"))acts=acts.filter(a=>a.assignees.includes(cu?.id)||a.createdBy===cu?.id);
    if(boomFilter.proj)acts=acts.filter(a=>a.projId===boomFilter.proj);
    if(boomFilter.priority)acts=acts.filter(a=>a.priority===boomFilter.priority);
    if(boomFilter.col)acts=acts.filter(a=>a.colId===boomFilter.col);
    return acts;
  },[allActs,boomFilter,cu]);
  const myActs=useMemo(()=>allActs.filter(a=>cu&&(a.assignees.includes(cu.id)||a.createdBy===cu.id)),[allActs,cu]);
  const openActData=useMemo(()=>openAct&&openAct!=="new"?allActs.find(a=>a.id===openAct)||null:null,[allActs,openAct]);
  const openActLogs=useMemo(()=>openAct&&openAct!=="new"?(boom.logs[openAct]||[]).slice().reverse():[],[boom.logs,openAct]);

  /* Auto-pull cuando se completa login con Supabase */
  useEffect(()=>{
    if(sbReady&&cu&&authChecked&&_sb){
      (async()=>{
        setSyncStatus(SYNC_STATUS.syncing);setSyncMsg("Sincronizando…");
        try{
          const{data:profs}=await sb().from("profiles").select("*");
          if(profs)setUsers(profs.map(p=>({id:p.id,name:p.name,username:p.username,role:p.role,created:p.created_at})));
          const{data:projs}=await sb().from("projects").select("*").order("created_at",{ascending:false});
          if(projs){
            const mapped=projs.map(p=>({id:p.id,name:p.name,contract:p.contract||"",pm:p.pm||"",org:p.org||"",client:p.client||"",client_rep:p.client_rep||"",scope:p.scope||"",bac_currency:p.bac_currency||"USD",bac:p.bac||"",rate:p.rate||"",overhead:p.overhead||"",quantum:p.quantum||"",batna:p.batna||"",pmis:p.pmis||"",schedule_tool:p.schedule_tool||"",assignedPM:p.assigned_pm||"",assignedTeam:p.assigned_team||"",createdBy:p.created_by||"",created:p.created_at,mc:{bl:p.mc_baseline||{},cur:p.mc_current||{}}}));
            setProjects(mapped);
            try{await window.storage.set("spms_v2_proj",JSON.stringify({list:mapped,active:null}));}catch{}
          }
          setSyncStatus(SYNC_STATUS.synced);setSyncMsg("Sincronizado: "+new Date().toLocaleTimeString("es-PA"));
        }catch(e){setSyncStatus(SYNC_STATUS.error);setSyncMsg("Error: "+(e.message||""));}
      })();
    }
  // eslint-disable-next-line
  },[sbReady,cu?.id,authChecked]);

  /* ─ M&C useMemo hooks — deben estar antes de los early returns ─ */
  const mcData=useMemo(()=>activeProj?.mc||{bl:{},cur:{}},[activeProj]);
  const mcCompute=useMemo(()=>{
    if(!activeProj)return null;
    const bl=mcData.bl||{};const cur=mcData.cur||{};
    const num=v=>{const n=Number(v);return isNaN(n)?0:n;};
    const BAC=num(bl.bac||activeProj.bac||0);
    const PV=num(cur.pv);const EV=num(cur.ev);const AC=num(cur.ac);
    const CV=EV-AC;const SV=EV-PV;
    const CPI=AC>0?EV/AC:0;const SPI=PV>0?EV/PV:0;
    const EAC=CPI>0?BAC/CPI:BAC;const ETC=EAC-AC;const VAC=BAC-EAC;
    const TCPI=(BAC-AC)>0?(BAC-EV)/(BAC-AC):0;
    const daysPlan=num(bl.days);const daysElapsed=num(cur.days_elapsed);
    const daysForecast=SPI>0?daysPlan/SPI:daysPlan;
    const scheduleDrift=daysForecast-daysPlan;
    const scopeItems=num(bl.scope_items)||1;const scopeDone=num(cur.scope_complete);
    const scopePct=scopeItems>0?(scopeDone/scopeItems)*100:0;
    const scopePlanPct=PV>0&&BAC>0?(PV/BAC)*100:0;
    const scopeGap=scopePct-scopePlanPct;
    const ncrTotal=num(cur.ncr_total);const ncrOpen=num(cur.ncr_open);const ncrCrit=num(cur.ncr_critical);
    const qualityRate=ncrTotal>0?((ncrTotal-ncrOpen)/ncrTotal)*100:100;
    const hhPlan=num(bl.hh);const hhReal=num(cur.hh_real);
    const hhVarPct=hhPlan>0?((hhReal-hhPlan)/hhPlan)*100:0;
    const riskReserve=num(bl.risk_reserve);const riskEMV=num(cur.risk_emv);const rUsed=num(cur.reserve_used);
    const reserveRem=riskReserve-rUsed;
    const reserveCov=riskEMV>0?reserveRem/riskEMV:999;
    const hasBaseline=BAC>0||hhPlan>0||daysPlan>0||scopeItems>1;
    const hasCurrent=PV>0||EV>0||AC>0||hhReal>0||scopeDone>0||ncrTotal>0;
    return{BAC,PV,EV,AC,CV,SV,CPI,SPI,EAC,ETC,VAC,TCPI,daysPlan,daysElapsed,daysForecast,scheduleDrift,scopeItems,scopeDone,scopePct,scopePlanPct,scopeGap,ncrTotal,ncrOpen,ncrCrit,qualityRate,hhPlan,hhReal,hhVarPct,riskReserve,riskEMV,rUsed,reserveRem,reserveCov,hasBaseline,hasCurrent,reportDate:cur.date||""};
  },[activeProj,mcData]);
  const mcEvaluate=useMemo(()=>{
    if(!mcCompute||!mcCompute.hasCurrent)return null;
    const m=mcCompute;
    const evals={};
    if(m.AC===0)evals.cost={status:"na",label:"Sin datos",msg:"Sin datos de costo real (AC).",action:"Registra el AC actual.",metric:"CPI = —"};
    else if(m.CPI>=0.95)evals.cost={status:"green",label:"En control",msg:"CPI ≥ 0.95 — ejecución eficiente en costo.",action:"Continuar monitoreo rutinario.",metric:"CPI = "+m.CPI.toFixed(3)};
    else if(m.CPI>=0.90)evals.cost={status:"yellow",label:"Alerta",msg:"CPI 0.90–0.95 — ligero sobrecosto. Varianza VAC proyectada: "+m.VAC.toFixed(0)+".",action:"Monitorear de cerca. Revisar causa raíz del CV negativo en próximo WPR.",metric:"CPI = "+m.CPI.toFixed(3)};
    else if(m.CPI>=0.80)evals.cost={status:"orange",label:"Acción requerida",msg:"CPI 0.80–0.90 — sobrecosto significativo. EAC = "+m.EAC.toFixed(0)+".",action:"PM: análisis de causa raíz (Pareto/Ishikawa). Evaluar CR a cost baseline. Activar reserva de contingencia.",metric:"CPI = "+m.CPI.toFixed(3)};
    else evals.cost={status:"red",label:"Escalación",msg:"CPI < 0.80 — sobrecosto crítico. EAC = "+m.EAC.toFixed(0)+" (VAC = "+m.VAC.toFixed(0)+").",action:"ESCALAR al Sponsor en ≤24 h. Convocar CCB. Evaluar re-planning del cost baseline. Considerar reserva de gestión.",metric:"CPI = "+m.CPI.toFixed(3)};
    if(m.PV===0)evals.sched={status:"na",label:"Sin datos",msg:"Sin PV registrado.",action:"Registra el Planned Value (PV) para el período.",metric:"SPI = —"};
    else if(m.SPI>=0.95)evals.sched={status:"green",label:"En control",msg:"SPI ≥ 0.95 — proyecto en cronograma.",action:"Continuar monitoreo rutinario.",metric:"SPI = "+m.SPI.toFixed(3)};
    else if(m.SPI>=0.90)evals.sched={status:"yellow",label:"Alerta",msg:"SPI 0.90–0.95 — ligero retraso. Desvío estimado: "+m.scheduleDrift.toFixed(1)+" días.",action:"Revisar ruta crítica. Identificar actividades con holgura consumida.",metric:"SPI = "+m.SPI.toFixed(3)};
    else if(m.SPI>=0.85)evals.sched={status:"orange",label:"Acción requerida",msg:"SPI 0.85–0.90 — retraso significativo. Fecha fin proyectada: +"+m.scheduleDrift.toFixed(0)+" días.",action:"PM: aplicar crashing o fast-tracking a CP. Evaluar CR de schedule baseline. Documentar causas.",metric:"SPI = "+m.SPI.toFixed(3)};
    else evals.sched={status:"red",label:"Escalación",msg:"SPI < 0.85 — retraso crítico. Proyección: +"+m.scheduleDrift.toFixed(0)+" días sobre baseline.",action:"ESCALAR al Sponsor. Convocar CCB para re-baseline. Activar contingencias de plazo.",metric:"SPI = "+m.SPI.toFixed(3)};
    if(m.scopeItems<=1&&m.scopeDone===0)evals.scope={status:"na",label:"Sin datos",msg:"Sin datos de entregables.",action:"Registra número total de entregables y completados.",metric:"—"};
    else if(Math.abs(m.scopeGap)<=5)evals.scope={status:"green",label:"En control",msg:"Alcance alineado con lo planificado ("+m.scopePct.toFixed(1)+"% real vs "+m.scopePlanPct.toFixed(1)+"% plan).",action:"Continuar validación progresiva con el cliente.",metric:m.scopePct.toFixed(1)+"%"};
    else if(m.scopeGap<-5&&m.scopeGap>=-15)evals.scope={status:"yellow",label:"Alerta",msg:"Alcance "+Math.abs(m.scopeGap).toFixed(1)+"% por debajo del plan.",action:"Revisar WPs atrasados. Validar scope baseline con cliente.",metric:m.scopePct.toFixed(1)+"%"};
    else if(m.scopeGap<-15)evals.scope={status:"red",label:"Escalación",msg:"Alcance "+Math.abs(m.scopeGap).toFixed(1)+"% por debajo del plan — posible scope creep invertido o bloqueos severos.",action:"ESCALAR al Sponsor. Revisión integral de WBS. Posible CR de alcance.",metric:m.scopePct.toFixed(1)+"%"};
    else evals.scope={status:"yellow",label:"Sobre-ejecución",msg:"Alcance +"+m.scopeGap.toFixed(1)+"% sobre plan — posible gold plating o adelanto.",action:"Validar que lo entregado cumple criterios y está dentro del scope aprobado.",metric:m.scopePct.toFixed(1)+"%"};
    if(m.ncrTotal===0)evals.quality={status:"na",label:"Sin datos",msg:"Sin NCRs registradas.",action:"Registra NCRs del período.",metric:"—"};
    else if(m.ncrCrit>0)evals.quality={status:"red",label:"Escalación",msg:m.ncrCrit+" NCR crítica(s) abierta(s). Tasa conformidad: "+m.qualityRate.toFixed(1)+"%.",action:"ESCALAR al Sponsor en ≤24 h. Detener proceso afectado. RCA obligatorio (5 porqués + Ishikawa).",metric:m.ncrOpen+"/"+m.ncrTotal+" abiertas"};
    else if((m.ncrOpen/m.ncrTotal)>0.30)evals.quality={status:"orange",label:"Acción requerida",msg:">30% NCRs abiertas. Tasa conformidad: "+m.qualityRate.toFixed(1)+"%.",action:"PM: auditoría de calidad. Revisar ITP y procedimientos. Acciones correctivas documentadas.",metric:m.ncrOpen+"/"+m.ncrTotal};
    else if((m.ncrOpen/m.ncrTotal)>0.15)evals.quality={status:"yellow",label:"Alerta",msg:"15–30% NCRs abiertas. Tasa conformidad: "+m.qualityRate.toFixed(1)+"%.",action:"Acelerar cierre de NCRs. Revisar tendencia de defectos.",metric:m.ncrOpen+"/"+m.ncrTotal};
    else evals.quality={status:"green",label:"En control",msg:"Tasa de conformidad: "+m.qualityRate.toFixed(1)+"%. "+m.ncrOpen+" NCRs abiertas de "+m.ncrTotal+".",action:"Continuar monitoreo rutinario de ITPs.",metric:m.qualityRate.toFixed(1)+"%"};
    if(m.hhPlan===0)evals.res={status:"na",label:"Sin datos",msg:"Sin baseline de H-H.",action:"Registra H-H plan en baseline.",metric:"—"};
    else if(m.hhVarPct<=5&&m.hhVarPct>=-5)evals.res={status:"green",label:"En control",msg:"Consumo H-H alineado con plan ("+m.hhVarPct.toFixed(1)+"%).",action:"Continuar control de productividad rutinario.",metric:m.hhVarPct.toFixed(1)+"%"};
    else if(m.hhVarPct>5&&m.hhVarPct<=15)evals.res={status:"yellow",label:"Alerta",msg:"Consumo H-H "+m.hhVarPct.toFixed(1)+"% sobre plan.",action:"Revisar productividad por WP. Identificar desviaciones por cuadrilla/frente.",metric:"+"+m.hhVarPct.toFixed(1)+"%"};
    else if(m.hhVarPct>15&&m.hhVarPct<=25)evals.res={status:"orange",label:"Acción requerida",msg:"Consumo H-H "+m.hhVarPct.toFixed(1)+"% sobre plan — sobreasignación severa.",action:"PM: resource leveling. Evaluar incremento de turnos o subcontratación. Ajustar forecast.",metric:"+"+m.hhVarPct.toFixed(1)+"%"};
    else if(m.hhVarPct>25)evals.res={status:"red",label:"Escalación",msg:"Consumo H-H >25% sobre plan — impacto crítico en costo.",action:"ESCALAR. Re-evaluar productividad base. Posible CR de recursos.",metric:"+"+m.hhVarPct.toFixed(1)+"%"};
    else evals.res={status:"yellow",label:"Sub-utilización",msg:"Consumo H-H "+Math.abs(m.hhVarPct).toFixed(1)+"% bajo plan — posible inactividad o estimación alta.",action:"Validar productividad real. Posible oportunidad de reasignación.",metric:m.hhVarPct.toFixed(1)+"%"};
    if(m.riskReserve===0)evals.risk={status:"na",label:"Sin datos",msg:"Sin baseline de reserva de riesgo.",action:"Registra reserva de contingencia inicial.",metric:"—"};
    else if(m.reserveCov>=2)evals.risk={status:"green",label:"En control",msg:"Cobertura de reserva: "+m.reserveCov.toFixed(1)+"×. Remanente: "+m.reserveRem.toFixed(0)+".",action:"Continuar monitoreo semanal del Risk Register.",metric:m.reserveCov.toFixed(1)+"×"};
    else if(m.reserveCov>=1.5)evals.risk={status:"yellow",label:"Alerta",msg:"Cobertura 1.5–2× — reserva moderada. EMV activo: "+m.riskEMV.toFixed(0)+".",action:"Revisar Top 5 riesgos. Acelerar acciones mitigadoras.",metric:m.reserveCov.toFixed(2)+"×"};
    else if(m.reserveCov>=1)evals.risk={status:"orange",label:"Acción requerida",msg:"Cobertura 1–1.5× — reserva insuficiente. EMV: "+m.riskEMV.toFixed(0)+" vs Remanente: "+m.reserveRem.toFixed(0)+".",action:"PM: solicitar reserva de gestión al Sponsor. Priorizar respuestas a top riesgos.",metric:m.reserveCov.toFixed(2)+"×"};
    else evals.risk={status:"red",label:"Escalación",msg:"Cobertura <1× — EMV excede reserva disponible. Exposición descubierta: "+(m.riskEMV-m.reserveRem).toFixed(0)+".",action:"ESCALAR al Sponsor. Activar reserva de gestión. Re-evaluar apetito al riesgo.",metric:m.reserveCov.toFixed(2)+"×"};
    return evals;
  },[mcCompute]);

  useEffect(()=>{
    let mounted=true;
    /* Failsafe: si algo cuelga, forzar salida del loading tras 5s */
    const failsafe=setTimeout(()=>{if(mounted){console.warn("Failsafe: forzando fin de loading");setLoading(false);setAuthChecked(true);}},5000);

    (async()=>{
      try{
        /* 1. Cargar usuarios locales (rápido, nunca falla) */
        let u=[...DEFAULT_USERS];
        try{const r=await window.storage.get("spms_users");if(r?.value){const p=JSON.parse(r.value);if(Array.isArray(p)&&p.length>0)u=p;}}catch{}
        if(!mounted)return;
        setUsers(u);

        /* 2. Intentar cargar config Supabase (no bloqueante) */
        let cfg=null;
        try{const r=await window.storage.get("sb_config");if(r?.value){cfg=JSON.parse(r.value);}}catch{}

        if(cfg?.url&&cfg?.key){
          setSbConfig(cfg);
          /* Intentar iniciar Supabase con timeout */
          try{
            const initPromise=initSupabase(cfg.url,cfg.key);
            const timeoutPromise=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),4000));
            await Promise.race([initPromise,timeoutPromise]);
            if(!mounted)return;
            setSbReady(true);
            setSyncStatus(SYNC_STATUS.synced);
            try{
              const {data:{session}}=await sb().auth.getSession();
              if(session&&mounted){
                const{data:prof}=await sb().from("profiles").select("*").eq("id",session.user.id).single();
                if(prof&&mounted){setCu({id:prof.id,name:prof.name,username:prof.username,role:prof.role,email:session.user.email});}
              }
              sb().auth.onAuthStateChange(async(event,session)=>{
                if(!mounted)return;
                if(event==="SIGNED_IN"&&session){
                  const{data:prof}=await sb().from("profiles").select("*").eq("id",session.user.id).single();
                  if(prof){setCu({id:prof.id,name:prof.name,username:prof.username,role:prof.role,email:session.user.email});}
                }else if(event==="SIGNED_OUT"){setCu(null);}
              });
            }catch(authErr){console.warn("Auth check error:",authErr);}
          }catch(sbErr){
            console.warn("Supabase init falló:",sbErr);
            if(mounted){setSyncStatus(SYNC_STATUS.error);setSyncMsg("Supabase no disponible — modo local");}
          }
        }else{
          if(mounted)setSyncStatus(SYNC_STATUS.local);
        }

        if(!mounted)return;
        setAuthChecked(true);

        /* 3. Login local si no hay Supabase */
        if(!cfg){
          try{const r=await window.storage.get("spms_session");if(r?.value){const s=JSON.parse(r.value);const f=u.find(x=>x.id===s.userId);if(f&&mounted)setCu(f);}}catch{}
        }

        /* 4. Cargar datos de caché local */
        try{const r=await window.storage.get("spms_v2_proj");if(r?.value&&mounted){const d=JSON.parse(r.value);setProjects(d.list||[]);setActiveId(d.active||null);}}catch{}
        try{const r=await window.storage.get("spms_v2_notes");if(r?.value&&mounted)setNotes(JSON.parse(r.value));}catch{}
        try{const r=await window.storage.get("spms_v2_tmpl");if(r?.value&&mounted)setTmpl(JSON.parse(r.value));}catch{}
        try{const r=await window.storage.get("spms_boom");if(r?.value&&mounted){const d=JSON.parse(r.value);setBoom(d);}}catch{}
      }catch(globalErr){
        console.error("Error fatal en carga inicial:",globalErr);
      }finally{
        if(mounted){
          clearTimeout(failsafe);
          setLoading(false);
        }
      }
    })();

    /* Listeners online/offline */
    const onOnline=()=>{if(mounted&&sbReady)setSyncStatus(SYNC_STATUS.synced);};
    const onOffline=()=>{if(mounted)setSyncStatus(SYNC_STATUS.offline);};
    window.addEventListener("online",onOnline);
    window.addEventListener("offline",onOffline);

    return()=>{
      mounted=false;
      clearTimeout(failsafe);
      window.removeEventListener("online",onOnline);
      window.removeEventListener("offline",onOffline);
    };
  },[]);

  const saveUsers=async u=>{setUsers(u);try{await window.storage.set("spms_users",JSON.stringify(u),true);}catch{}};
  const saveSess=async u=>{setCu(u);try{await window.storage.set("spms_session",JSON.stringify({userId:u.id}));}catch{}};
  const clearSess=async()=>{setCu(null);try{await window.storage.set("spms_session","");}catch{}};
  const saveProj=async(list,active,pushedProj)=>{
    setProjects(list);setActiveId(active);
    try{await window.storage.set("spms_v2_proj",JSON.stringify({list,active}));}catch{}
    if(sbReady&&cu&&pushedProj){pushProjectToSupabase(pushedProj);}
  };
  const saveNotes=async n=>{setNotes(n);try{await window.storage.set("spms_v2_notes",JSON.stringify(n));}catch{}};
  const saveTmplAll=async t=>{setTmpl(t);try{await window.storage.set("spms_v2_tmpl",JSON.stringify(t));}catch{}};
  const saveBoom=async b=>{setBoom(b);try{await window.storage.set("spms_boom",JSON.stringify(b));}catch{}};

  /* ─ SUPABASE CONFIG & AUTH ─ */
  const saveSbConfig=async()=>{
    setSbErr("");
    if(!sbForm.url.trim()||!sbForm.key.trim()){setSbErr("URL y anon key son obligatorios.");return;}
    if(!sbForm.url.startsWith("https://")){setSbErr("URL debe empezar con https://");return;}
    try{
      const cfg={url:sbForm.url.trim(),key:sbForm.key.trim()};
      await initSupabase(cfg.url,cfg.key);
      const{error}=await sb().from("profiles").select("id").limit(1);
      if(error)throw error;
      await window.storage.set("sb_config",JSON.stringify(cfg));
      setSbConfig(cfg);setSbReady(true);setSyncStatus(SYNC_STATUS.synced);setShowSbSetup(false);
    }catch(e){setSbErr("No se pudo conectar: "+(e.message||"error desconocido"));}
  };

  const clearSbConfig=async()=>{
    if(!confirm("¿Desvincular de Supabase? Los datos locales se mantendrán."))return;
    try{await window.storage.set("sb_config","");}catch{}
    _sb=null;setSbConfig(null);setSbReady(false);setSyncStatus(SYNC_STATUS.local);setCu(null);
    try{await window.storage.set("spms_session","");}catch{}
  };

  const sendMagicLink=async()=>{
    setSbErr("");setMagicSent(false);
    if(!magicEmail.trim()||!magicEmail.includes("@")){setSbErr("Ingresa un correo válido.");return;}
    if(!sbReady){setSbErr("Supabase no configurado.");return;}
    try{
      const{error}=await sb().auth.signInWithOtp({email:magicEmail.trim(),options:{emailRedirectTo:window.location.origin}});
      if(error)throw error;
      setMagicSent(true);
    }catch(e){setSbErr("Error: "+(e.message||"no se pudo enviar"));}
  };

  const doLogout=async()=>{
    if(sbReady&&sb()){try{await sb().auth.signOut();}catch{}}
    setCu(null);try{await window.storage.set("spms_session","");}catch{}
    setView("home");
  };

  /* ─ SYNC: pull projects desde Supabase ─ */
  const pullFromSupabase=async()=>{
    if(!sbReady||!cu)return;
    setSyncStatus(SYNC_STATUS.syncing);setSyncMsg("Sincronizando…");
    try{
      const{data:profs}=await sb().from("profiles").select("*");
      if(profs)setUsers(profs.map(p=>({id:p.id,name:p.name,username:p.username,role:p.role,created:p.created_at})));
      const{data:projs}=await sb().from("projects").select("*").order("created_at",{ascending:false});
      if(projs){
        const mapped=projs.map(p=>({id:p.id,name:p.name,contract:p.contract||"",pm:p.pm||"",org:p.org||"",client:p.client||"",client_rep:p.client_rep||"",scope:p.scope||"",bac_currency:p.bac_currency||"USD",bac:p.bac||"",rate:p.rate||"",overhead:p.overhead||"",quantum:p.quantum||"",batna:p.batna||"",pmis:p.pmis||"",schedule_tool:p.schedule_tool||"",assignedPM:p.assigned_pm||"",assignedTeam:p.assigned_team||"",createdBy:p.created_by||"",created:p.created_at,mc:{bl:p.mc_baseline||{},cur:p.mc_current||{}}}));
        setProjects(mapped);
        try{await window.storage.set("spms_v2_proj",JSON.stringify({list:mapped,active:activeId}));}catch{}
      }
      setSyncStatus(SYNC_STATUS.synced);setSyncMsg("Sincronizado: "+new Date().toLocaleTimeString("es-PA"));
    }catch(e){setSyncStatus(SYNC_STATUS.error);setSyncMsg("Error: "+(e.message||""));}
  };

  /* ─ SYNC: push un proyecto a Supabase ─ */
  const pushProjectToSupabase=async(proj)=>{
    if(!sbReady||!cu)return;
    try{
      const row={id:proj.id,name:proj.name,contract:proj.contract||null,pm:proj.pm||null,org:proj.org||null,client:proj.client||null,client_rep:proj.client_rep||null,scope:proj.scope||null,bac_currency:proj.bac_currency||"USD",bac:proj.bac?Number(proj.bac):null,rate:proj.rate?Number(proj.rate):null,overhead:proj.overhead?Number(proj.overhead):null,quantum:proj.quantum?Number(proj.quantum):null,batna:proj.batna?Number(proj.batna):null,pmis:proj.pmis||null,schedule_tool:proj.schedule_tool||null,assigned_pm:proj.assignedPM||null,assigned_team:proj.assignedTeam||null,created_by:cu.id,mc_baseline:proj.mc?.bl||{},mc_current:proj.mc?.cur||{}};
      const{error}=await sb().from("projects").upsert(row);
      if(error)throw error;
    }catch(e){console.error("Push error:",e);setSyncStatus(SYNC_STATUS.error);setSyncMsg("Error guardando en cloud");}
  };

  /* ─ SUPABASE CONFIG & AUTH END ─ */

  const ensureBoard=useCallback(()=>{
    if(boom.boards.length>0)return boom.boards[0];
    const b=mkBoard("Tablero Principal",null,cu?.id||"u_admin");
    const nb={...boom,boards:[b]};setBoom(nb);
    window.storage.set("spms_boom",JSON.stringify(nb)).catch(()=>{});
    return b;
  },[boom,cu]);

  const getBoardKey=(boardId)=>"board_"+boardId;

  const createActivity=useCallback((data)=>{
    const board=ensureBoard();
    const colId=data.colId||board.cols[0].id;
    const act=mkAct({...data,colId,boardId:board.id},cu?.id||"");
    const key=getBoardKey(board.id);
    const log=mkLog(act.id,cu?.id,"created","","",act.title);
    const nb={...boom,acts:{...boom.acts,[key]:[...(boom.acts[key]||[]),act]},logs:{...boom.logs,[act.id]:[log]}};
    saveBoom(nb);
  },[boom,cu,ensureBoard]);

  const updateActivity=useCallback((actId,changes)=>{
    const board=ensureBoard();
    const key=getBoardKey(board.id);
    const acts=boom.acts[key]||[];
    const old=acts.find(a=>a.id===actId);
    if(!old)return;
    const updated={...old,...changes,updatedAt:new Date().toISOString()};
    const newActs=acts.map(a=>a.id===actId?updated:a);
    const newLogs=Object.keys(changes).map(f=>mkLog(actId,cu?.id,"updated",f,old[f],changes[f]));
    const nb={...boom,acts:{...boom.acts,[key]:newActs},logs:{...boom.logs,[actId]:[...(boom.logs[actId]||[]),...newLogs]}};
    saveBoom(nb);
  },[boom,cu,ensureBoard]);

  const moveActivity=useCallback((actId,newColId)=>{
    const board=ensureBoard();
    const key=getBoardKey(board.id);
    const acts=boom.acts[key]||[];
    const old=acts.find(a=>a.id===actId);
    if(!old)return;
    const updated={...old,colId:newColId,updatedAt:new Date().toISOString()};
    const newActs=acts.map(a=>a.id===actId?updated:a);
    const log=mkLog(actId,cu?.id,"moved","colId",old.colId,newColId);
    const nb={...boom,acts:{...boom.acts,[key]:newActs},logs:{...boom.logs,[actId]:[...(boom.logs[actId]||[]),log]}};
    saveBoom(nb);
  },[boom,cu,ensureBoard]);

  const deleteActivity=useCallback((actId)=>{
    const board=ensureBoard();
    const key=getBoardKey(board.id);
    const newActs=(boom.acts[key]||[]).filter(a=>a.id!==actId);
    const newLogs={...boom.logs};delete newLogs[actId];
    saveBoom({...boom,acts:{...boom.acts,[key]:newActs},logs:newLogs});
  },[boom,ensureBoard]);

  const submitActForm=()=>{
    if(!actForm.title.trim())return;
    const board=ensureBoard();
    const data={...actForm,boardId:board.id,projId:actForm.projId||activeId||"",tags:actForm.tags?actForm.tags.split(",").map(t=>t.trim()).filter(Boolean):[]};
    if(openAct==="new"){createActivity(data);}
    else{const{title,desc,priority,assignees,dueDate,startDate,estimatedH,colId,projId,tags}=actForm;
      updateActivity(openAct,{title,desc,priority,assignees,dueDate,startDate,estimatedH:estimatedH?Number(estimatedH):0,colId:colId||boomBoard?.cols[0].id,projId:projId||activeId||"",tags:tags?tags.split(",").map(t=>t.trim()).filter(Boolean):[]});}
    setOpenAct(null);setActMode("view");
  };

  const openNewAct=(colId)=>{
    const board=ensureBoard();
    setActForm({title:"",desc:"",priority:"medium",assignees:[cu?.id||""],dueDate:"",startDate:"",estimatedH:"",colId:colId||board.cols[0].id,projId:activeId||"",tags:""});
    setOpenAct("new");setActMode("edit");
  };

  const openActDetail=(act)=>{
    setActForm({...act,tags:Array.isArray(act.tags)?act.tags.join(", "):act.tags||""});
    setOpenAct(act.id);setActMode("view");
  };

  const doLogin=()=>{const u=users.find(x=>x.username===loginF.u&&x.password===loginF.p);if(!u){setLoginErr("Usuario o contraseña incorrectos.");return;}setLoginErr("");saveSess(u);};
  const saveUser=async()=>{
    if(!uForm.name.trim()||!uForm.username.trim()||(!editUId&&!uForm.password.trim())){setUFormErr("Todos los campos son obligatorios.");return;}
    if(!editUId&&users.find(u=>u.username===uForm.username)){setUFormErr("Ese usuario ya existe.");return;}
    setUFormErr("");
    let upd;
    if(editUId){upd=users.map(u=>u.id===editUId?{...u,name:uForm.name,username:uForm.username,role:uForm.role,...(uForm.password?{password:uForm.password}:{})}:u);}
    else{upd=[...users,{id:genId(),name:uForm.name,username:uForm.username,password:uForm.password,role:uForm.role,created:new Date().toISOString()}];}
    await saveUsers(upd);
    if(cu){const updated=upd.find(u=>u.id===cu.id);if(updated){setCu(updated);try{await window.storage.set("spms_session",JSON.stringify({userId:updated.id}));}catch{}}}
    setShowUForm(false);setEditUId(null);setUForm({name:"",username:"",password:"",role:"team"});
  };
  const delUser=async()=>{if(!delUConf)return;const upd=users.filter(u=>u.id!==delUConf);await saveUsers(upd);setDelUConf(null);};

  const startNew=()=>{setEditForm({...EP,name:"Nuevo Proyecto"});setEditingId("new");};
  const startEdit=p=>{setEditForm({...EP,...p});setEditingId(p.id);};
  const saveEdit=async()=>{
    if(!editForm.name.trim())return;
    let list,active,saved;
    if(editingId==="new"){const np={...editForm,id:genId(),created:new Date().toISOString(),createdBy:cu?.id};list=[...projects,np];active=np.id;saved=np;}
    else{saved={...projects.find(p=>p.id===editingId),...editForm};list=projects.map(p=>p.id===editingId?saved:p);active=activeId;}
    await saveProj(list,active,saved);setProjSaved(true);setTimeout(()=>setProjSaved(false),2000);setEditingId(null);
  };
  const delProj=async()=>{
    if(!delPConf)return;
    const list=projects.filter(p=>p.id!==delPConf);
    const active=activeId===delPConf?(list.length>0?list[0].id:null):activeId;
    await saveProj(list,active);
    if(sbReady&&cu){try{await sb().from("projects").delete().eq("id",delPConf);}catch(e){console.error(e);}}
    const nn={...notes};delete nn[delPConf];await saveNotes(nn);
    const nt={...tmpl};delete nt[delPConf];await saveTmplAll(nt);
    setDelPConf(null);
  };

  const saveNote=async(k,v)=>{const u={...notes,[activeId]:{...aN,[k]:v}};await saveNotes(u);setEditNK(null);};
  const setTF=(tid,fi,v)=>{const u={...tmpl,[activeId]:{...aT,[tid]:{...(aT[tid]||{}),[fi]:v}}};setTmpl(u);};
  const saveTF=async tid=>{await saveTmplAll({...tmpl,[activeId]:{...aT}});setTmplSaved(s=>({...s,[tid]:true}));setTimeout(()=>setTmplSaved(s=>({...s,[tid]:false})),2000);};

  const navTo=v=>{setView(v);setSelDom(null);setOpenProc(null);if(v==="proyectos")setEditingId(null);};
  const r=cu?ROLES[cu.role]:null;

  const TABS=[
    {id:"home",l:"SPMS+ v2.0"},
    {id:"proyectos",l:"📁 Proyectos"},
    {id:"boom",l:"⚡ BOOM"},
    {id:"principles",l:"Principios"},
    {id:"pmbok",l:"40 Procesos"},
    {id:"tt",l:"T&T"},
    {id:"plantillas",l:"📋 Plantillas"},
    {id:"mc",l:"📊 M&C"},
    ...(cu&&can(cu,"manageUsers")?[{id:"usuarios",l:"👥 Usuarios"}]:[]),
    {id:"coorp",l:"🏛 Coorp"},
  ];

  if(loading)return(<div style={{minHeight:"100vh",background:"#04141A",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"12px",color:"#14B8A6",letterSpacing:"2px"}}>CARGANDO SPMS+ v2.0…</div></div>);

  if(!cu)return(
    <div className="root"><style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-box">
          <div className="login-title">SPMS<em>+</em> v2.0</div>
          <div className="login-sub">SYSTENGER S.A. · PMBOK® 8 · BOOM COMPROMISE</div>

          {sbReady?(<>
            <div style={{textAlign:"center",margin:"12px 0 6px"}}>
              <span className="sync-bar sync-synced" style={{display:"inline-flex",gap:"4px"}}><span className="sync-dot"/>Supabase conectado</span>
            </div>
            <div className="ml-magic">
              <div className="ml-magic-t">✨ Iniciar sesión con Magic Link</div>
              <input className="login-inp" type="email" placeholder="tu@correo.com" value={magicEmail} onChange={e=>{setMagicEmail(e.target.value);setSbErr("");setMagicSent(false);}} onKeyDown={e=>e.key==="Enter"&&sendMagicLink()}/>
              {sbErr&&<div className="login-err" style={{marginTop:"8px"}}>{sbErr}</div>}
              {magicSent?(
                <div className="ml-sent">✓ Enlace enviado a <strong>{magicEmail}</strong><br/><span style={{fontSize:"10px",opacity:.8}}>Revisa tu correo y haz clic en el enlace para iniciar sesión.</span></div>
              ):(
                <button className="login-btn" style={{marginTop:"10px"}} onClick={sendMagicLink}>📧 Enviar enlace mágico</button>
              )}
            </div>
            <div className="ml-divider">o</div>
            <button className="u-btn" style={{width:"100%",padding:"8px",fontSize:"11px"}} onClick={clearSbConfig}>🔌 Desvincular de Supabase</button>
          </>):(<>
            {showSbSetup?(<>
              <label className="login-lbl">Supabase URL</label>
              <input className="login-inp" placeholder="https://xxxx.supabase.co" value={sbForm.url} onChange={e=>{setSbForm(f=>({...f,url:e.target.value}));setSbErr("");}}/>
              <label className="login-lbl">Anon Public Key</label>
              <input className="login-inp" type="password" placeholder="eyJhbGc..." value={sbForm.key} onChange={e=>{setSbForm(f=>({...f,key:e.target.value}));setSbErr("");}}/>
              {sbErr&&<div className="login-err">{sbErr}</div>}
              <button className="login-btn" onClick={saveSbConfig}>🔗 Conectar con Supabase</button>
              <button className="u-btn" style={{width:"100%",padding:"8px",marginTop:"8px",fontSize:"10px"}} onClick={()=>{setShowSbSetup(false);setSbErr("");}}>← Volver a login local</button>
              <div className="login-hint" style={{marginTop:"10px"}}><strong style={{color:"#14B8A6"}}>¿Cómo obtener las credenciales?</strong><br/>1. Ve a supabase.com → tu proyecto<br/>2. Settings → API<br/>3. Copia "Project URL" y "anon public"</div>
            </>):(<>
              <label className="login-lbl">Usuario</label>
              <input className="login-inp" placeholder="Ingresa tu usuario" value={loginF.u} onChange={e=>setLoginF(f=>({...f,u:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
              <label className="login-lbl">Contraseña</label>
              <input className="login-inp" type="password" placeholder="Ingresa tu contraseña" value={loginF.p} onChange={e=>setLoginF(f=>({...f,p:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
              {loginErr&&<div className="login-err">{loginErr}</div>}
              <button className="login-btn" onClick={doLogin}>Iniciar Sesión (local)</button>
              <div className="login-hint"><strong style={{color:"#14B8A6"}}>Acceso local inicial:</strong> admin / spms2024</div>
              <div className="sb-setup-card">
                <div className="sb-setup-t">☁ Modo cloud (Supabase)</div>
                <div className="sb-setup-d">Conecta con Supabase para acceso multi-dispositivo, colaboración en tiempo real y backup automático.</div>
                <button className="sb-setup-btn" onClick={()=>{setShowSbSetup(true);setSbErr("");}}>⚙ Configurar Supabase</button>
              </div>
            </>)}
          </>)}
        </div>
      </div>
    </div>
  );

  /* Note Editor — invocado como función, no componente (fix bug cursor) */
  const noteEditor=(nk)=>{
    const isE=editNK===nk;
    const val=aN[nk]||"";
    if(!activeId)return null;
    return(
      <div>
        <div className="nl"><span>📝 Datos del proyecto</span>{!isE&&<button className="ebt" onClick={()=>{setEditNK(nk);setEditNV(val);}}>✏️ Editar</button>}</div>
        {isE?(<><textarea className="nta" value={editNV} onChange={e=>setEditNV(e.target.value)} placeholder="Ingresa los datos de tu proyecto para este output..."/>
          <div className="nacts"><button className="nsav" onClick={()=>saveNote(nk,editNV)}>💾 Guardar</button><button className="ncnc" onClick={()=>setEditNK(null)}>Cancelar</button></div>
        </>):(val?<div className="nv">{val}</div>:<div className="ne">Sin datos — usa ✏️ Editar para completar.</div>)}
      </div>
    );
  };

  /* Project Bar — invocada como función */
  const projectBar=()=>(
    <div className="pbar">
      <span className="pbar-lbl">Proyecto</span>
      {activeProj?<span className="pbar-name">🏗 {activeProj.name}{activeProj.contract&&" · "+activeProj.contract}</span>:<span className="pbar-none">⚠ Sin proyecto activo</span>}
      <button className="pbar-btn" onClick={()=>navTo("proyectos")}>Cambiar</button>
    </div>
  );

  /* BOOM Modal — invocado como función */
  const boomModal=()=>{
    if(!openAct)return null;
    const isNew=openAct==="new";
    const isEdit=actMode==="edit";
    const act=openActData;
    const board=ensureBoard();
    const getColName=cid=>board.cols.find(c=>c.id===cid)?.name||"—";
    const getProjName=pid=>projects.find(p=>p.id===pid)?.name||"";
    return(
      <div className="boom-modal-ov" onClick={e=>{if(e.target.className==="boom-modal-ov"){setOpenAct(null);setActMode("view");}}}>
        <div className="boom-modal">
          <div className="boom-modal-hdr">
            <span className="boom-modal-title">{isNew?"Nueva Actividad":isEdit?"Editar Actividad":"Detalle de Actividad"}</span>
            {!isNew&&!isEdit&&<button className="boom-cancel-btn" style={{padding:"4px 10px",fontSize:"10px"}} onClick={()=>setActMode("edit")}>✏️ Editar</button>}
            <button className="boom-modal-close" onClick={()=>{setOpenAct(null);setActMode("view");}}>✕</button>
          </div>
          {isEdit?(
            <div className="boom-modal-body">
              <label className="boom-fl">Título *</label>
              <input className="boom-fi" value={actForm.title} onChange={e=>setActForm(f=>({...f,title:e.target.value}))} placeholder="Título de la actividad..."/>
              <label className="boom-fl">Descripción</label>
              <textarea className="boom-ta" value={actForm.desc||""} onChange={e=>setActForm(f=>({...f,desc:e.target.value}))} placeholder="Descripción detallada..."/>
              <label className="boom-fl">Prioridad</label>
              <div className="boom-prio-grid">
                {Object.entries(PRIO).map(([k,p])=>(
                  <div key={k} className={"boom-prio-opt"+(actForm.priority===k?" sel":"")} onClick={()=>setActForm(f=>({...f,priority:k}))}
                    style={actForm.priority===k?{borderColor:p.color,background:p.bg}:{}}>
                    {p.dot} {p.label}
                  </div>
                ))}
              </div>
              <label className="boom-fl">Estado (Columna)</label>
              <select className="boom-fi" value={actForm.colId||board.cols[0].id} onChange={e=>setActForm(f=>({...f,colId:e.target.value}))}>
                {board.cols.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <label className="boom-fl">Proyecto vinculado</label>
              <select className="boom-fi" value={actForm.projId||""} onChange={e=>setActForm(f=>({...f,projId:e.target.value}))}>
                <option value="">Sin proyecto</option>
                {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="boom-grid2">
                <div><label className="boom-fl">Fecha inicio</label><input className="boom-fi" type="date" value={actForm.startDate||""} onChange={e=>setActForm(f=>({...f,startDate:e.target.value}))}/></div>
                <div><label className="boom-fl">Fecha límite</label><input className="boom-fi" type="date" value={actForm.dueDate||""} onChange={e=>setActForm(f=>({...f,dueDate:e.target.value}))}/></div>
              </div>
              <label className="boom-fl">H-H estimadas</label>
              <input className="boom-fi" type="number" min="0" value={actForm.estimatedH||""} onChange={e=>setActForm(f=>({...f,estimatedH:e.target.value}))} placeholder="0"/>
              <label className="boom-fl">Progreso: {actForm.progress||0}%</label>
              <input className="boom-range" type="range" min="0" max="100" value={actForm.progress||0} onChange={e=>setActForm(f=>({...f,progress:Number(e.target.value)}))}/>
              <label className="boom-fl">Asignar a</label>
              <div className="boom-assignee-list">
                {users.map(u=>(
                  <div key={u.id} className={"boom-assignee-opt"+(actForm.assignees?.includes(u.id)?" sel":"")}
                    onClick={()=>{const cur=actForm.assignees||[];const has=cur.includes(u.id);setActForm(f=>({...f,assignees:has?cur.filter(x=>x!==u.id):[...cur,u.id]}));}}>
                    {ROLES[u.role]?.icon} {u.name}
                  </div>
                ))}
              </div>
              <label className="boom-fl">Etiquetas (separadas por coma)</label>
              <input className="boom-fi" value={actForm.tags||""} onChange={e=>setActForm(f=>({...f,tags:e.target.value}))} placeholder="QC, NCR, AACE, CAR..."/>
              <div className="boom-modal-footer">
                {!isNew&&<button className="boom-del-btn" onClick={()=>{deleteActivity(openAct);setOpenAct(null);}}>🗑</button>}
                <button className="boom-cancel-btn" onClick={()=>{if(isNew){setOpenAct(null);}else{setActMode("view");}}}>Cancelar</button>
                <button className="boom-save-btn" onClick={submitActForm}>{isNew?"Crear actividad":"Guardar cambios"}</button>
              </div>
            </div>
          ):(
            act&&(
              <div className="boom-modal-body">
                <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
                  <span style={{fontSize:"18px"}}>{PRIO[act.priority]?.dot}</span>
                  <span style={{fontFamily:"Syne,sans-serif",fontSize:"15px",fontWeight:700,color:"#FFF",flex:1,lineHeight:1.3}}>{act.title}</span>
                </div>
                {act.desc&&<div style={{fontSize:"12px",color:"#8A9BAC",lineHeight:1.7,marginBottom:"10px"}}>{act.desc}</div>}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"10px"}}>
                  {[["Estado",getColName(act.colId)],["Prioridad",PRIO[act.priority]?.label||act.priority],["Proyecto",getProjName(act.projId)||"Sin proyecto"],["Fecha límite",act.dueDate?fmtDate(act.dueDate):"Sin fecha"],["H-H est.",act.estimatedH?act.estimatedH+"h":"—"],["Progreso",act.progress+"%"],["Creado",fmtDate(act.createdAt)],["Actualizado",fmtDate(act.updatedAt)]].map(([l,v])=>(
                    <div key={l} className="boom-detail-field"><div className="boom-detail-lbl">{l}</div><div className="boom-detail-val">{v}</div></div>
                  ))}
                </div>
                {act.assignees?.length>0&&(
                  <div className="boom-detail-field">
                    <div className="boom-detail-lbl">Asignados</div>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"4px"}}>
                      {act.assignees.map(uid=>{const u=users.find(x=>x.id===uid);if(!u)return null;const role=ROLES[u.role];return(<span key={uid} style={{fontSize:"10px",padding:"3px 8px",border:"1px solid "+role.color+"44",background:role.color+"22",borderRadius:"4px",color:role.color}}>{role.icon} {u.name}</span>);})}
                    </div>
                  </div>
                )}
                {act.tags?.length>0&&(
                  <div className="boom-detail-field">
                    <div className="boom-detail-lbl">Etiquetas</div>
                    <div style={{display:"flex",gap:"4px",flexWrap:"wrap",marginTop:"4px"}}>{act.tags.map(t=><span key={t} className="boom-card-tag">{t}</span>)}</div>
                  </div>
                )}
                {act.progress>0&&(
                  <div className="boom-detail-field">
                    <div className="boom-detail-lbl">Progreso — {act.progress}%</div>
                    <div className="boom-progress-bar" style={{width:"100%",marginTop:"4px"}}>
                      <div className="boom-progress-fill" style={{width:act.progress+"%"}}/>
                    </div>
                  </div>
                )}
                <label className="boom-fl">Mover a columna</label>
                <select className="boom-fi" value={act.colId} onChange={e=>moveActivity(act.id,e.target.value)}>
                  {board.cols.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {openActLogs.length>0&&(
                  <div style={{marginTop:"14px"}}>
                    <div className="boom-detail-lbl">Historial de cambios</div>
                    <div style={{marginTop:"6px",background:"#04141A",borderRadius:"4px",padding:"8px"}}>
                      {openActLogs.slice(0,10).map(l=>{
                        const u=users.find(x=>x.id===l.userId);
                        return(<div key={l.id} className="boom-log-item">
                          <span className="boom-log-time">{new Date(l.ts).toLocaleDateString("es-PA",{day:"2-digit",month:"short"})}</span>
                          <span>{u?.name||"?"} · {l.action}{l.field?" ("+l.field+")":""}</span>
                        </div>);
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  /* ─ TEMPLATE HELPERS ─ */
  const interpolateTpl=(tplStr,proj)=>{
    if(!tplStr)return"";
    const today=new Date().toLocaleDateString("es-PA",{year:"numeric",month:"long",day:"2-digit"});
    const defaults={name:"[Nombre del proyecto]",contract:"[Código]",pm:"[PM]",client:"[Cliente]",client_rep:"[Rep. cliente]",org:"[Organización]",scope:"[Alcance]",bac_currency:"USD",bac:"[BAC]",rate:"[Tarifa]",overhead:"[%]",quantum:"[Quantum]",batna:"[BATNA]",pmis:"[PMIS]",schedule_tool:"[Herramienta]",date:today};
    const data={...defaults,...(proj||{}),date:today};
    return tplStr.replace(/\{\{(\w+)\}\}/g,(_,k)=>(data[k]!==undefined&&data[k]!==""?data[k]:defaults[k]||"[—]"));
  };

  const autoGenTpl=(proc,out)=>{
    const today=new Date().toLocaleDateString("es-PA",{year:"numeric",month:"long",day:"2-digit"});
    let s="# "+out.n.toUpperCase()+"\n";
    s+="**Proceso:** "+proc.id+" — "+proc.n+"\n";
    s+="**Proyecto:** "+((activeProj?.name)||"[Nombre del proyecto]")+"\n";
    s+="**Fecha:** "+today+"\n\n";
    s+="## Campos del documento\n\n";
    out.tpl.forEach((f,i)=>{s+=(i+1)+". **"+f+":** [Completar]\n";});
    s+="\n## Notas\n[Información adicional, referencias, supuestos relevantes]\n\n";
    s+="---\n*Ref: PMBOK® Guide 8th Edition · "+proc.fa+" — "+proc.n+"*\n";
    s+="*Este template fue auto-generado a partir de los campos estándar del output. Para una versión más elaborada, consulta referencias PMI.*";
    return s;
  };

  const genTemplate=(proc,out,outIdx)=>{
    const key=proc.id+"_"+outIdx;
    const specific=OUT_TPL[key];
    if(specific)return{text:interpolateTpl(specific,activeProj),source:"oficial"};
    return{text:interpolateTpl(autoGenTpl(proc,out),activeProj),source:"auto"};
  };

  const openTplModal=(proc,out,outIdx)=>{
    const nk=proc.id+"_"+outIdx;
    const {text,source}=genTemplate(proc,out,outIdx);
    setTplModal({procId:proc.id,procName:proc.n,outName:out.n,outIdx,nk,text,source});
  };

  const copyTpl=async()=>{
    if(!tplModal)return;
    try{await navigator.clipboard.writeText(tplModal.text);setTplCopied(true);setTimeout(()=>setTplCopied(false),1800);}
    catch{setTplCopied(false);}
  };

  const useTplAsBase=()=>{
    if(!tplModal||!activeId)return;
    setEditNK(tplModal.nk);setEditNV(tplModal.text);
    setTplModal(null);
  };

  /* ─ M&C Handlers (helpers, no hooks) ─ */
  const startMcEdit=()=>{
    const bl=mcData.bl||{};const cur=mcData.cur||{};
    setMcForm({bl_bac:bl.bac||activeProj?.bac||"",bl_hh:bl.hh||"",bl_days:bl.days||"",bl_scope_items:bl.scope_items||"",bl_risk_reserve:bl.risk_reserve||"",cur_pv:cur.pv||"",cur_ev:cur.ev||"",cur_ac:cur.ac||"",cur_hh_real:cur.hh_real||"",cur_days_elapsed:cur.days_elapsed||"",cur_scope_complete:cur.scope_complete||"",cur_ncr_total:cur.ncr_total||"",cur_ncr_open:cur.ncr_open||"",cur_ncr_critical:cur.ncr_critical||"",cur_risk_emv:cur.risk_emv||"",cur_reserve_used:cur.reserve_used||"",cur_date:cur.date||new Date().toISOString().slice(0,10)});
    setMcEdit(true);
  };
  const saveMcData=async()=>{
    if(!activeProj)return;
    const newMc={bl:{bac:mcForm.bl_bac,hh:mcForm.bl_hh,days:mcForm.bl_days,scope_items:mcForm.bl_scope_items,risk_reserve:mcForm.bl_risk_reserve},cur:{pv:mcForm.cur_pv,ev:mcForm.cur_ev,ac:mcForm.cur_ac,hh_real:mcForm.cur_hh_real,days_elapsed:mcForm.cur_days_elapsed,scope_complete:mcForm.cur_scope_complete,ncr_total:mcForm.cur_ncr_total,ncr_open:mcForm.cur_ncr_open,ncr_critical:mcForm.cur_ncr_critical,risk_emv:mcForm.cur_risk_emv,reserve_used:mcForm.cur_reserve_used,date:mcForm.cur_date}};
    const list=projects.map(p=>p.id===activeId?{...p,mc:newMc}:p);
    await saveProj(list,activeId);setMcEdit(false);
  };

  /* ─ PDF / INPUTS HELPERS ─ */
  const parseInput=(s)=>{
    if(s==="EEF")return{type:"eef",name:"Enterprise Environmental Factors",src:"Factores externos al proyecto (regulaciones, cultura, mercado, infraestructura)",icon:"🌐"};
    if(s==="OPA")return{type:"opa",name:"Organizational Process Assets",src:"Activos internos de la organización (plantillas, procedimientos, lecciones históricas)",icon:"🏢"};
    const refMatch=s.match(/^@(\d+\.\d+)\s+(.+)$/);
    if(refMatch)return{type:"ref",name:refMatch[2],src:"Output del proceso "+refMatch[1],procId:refMatch[1],icon:"🔗"};
    return{type:"ext",name:s,src:"Input externo / documento de negocio",icon:"📄"};
  };

  const renderInputItem=(inStr,i,onRefClick)=>{
    const p=parseInput(inStr);
    return(
      <div key={i} className={"in-item "+p.type} onClick={()=>p.procId&&onRefClick&&onRefClick(p.procId)}>
        <span className="in-ic">{p.icon}</span>
        <div className="in-body">
          <div className="in-name">{p.name}</div>
          <div className={"in-src "+p.type+(p.procId?" in-src-link":"")}>{p.src}</div>
        </div>
      </div>
    );
  };

  const escHtml=(s)=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  const buildProcessPDFHtml=(proc,proj,userNotes)=>{
    const dom=DOM.find(d=>d.id===proc.d);
    const inputs=PR_IN[proc.id]||[];
    const pn=proj?.name||"—";const pc=proj?.contract||"—";
    const today=new Date().toLocaleDateString("es-PA",{day:"2-digit",month:"long",year:"numeric"});
    const inputsHtml=inputs.map((s,i)=>{
      const p=parseInput(s);
      const srcClass=p.type==="ref"?"src-ref":p.type==="eef"?"src-eef":p.type==="opa"?"src-opa":"src-ext";
      return `<div class="in-box ${srcClass}"><div class="in-n">${i+1}. ${escHtml(p.name)}</div><div class="in-s">${escHtml(p.src)}</div></div>`;
    }).join("");
    const outputsHtml=proc.out.map((o,oi)=>{
      const userData=userNotes?userNotes[proc.id+"_"+oi]||"":"";
      const hasUserData=userData&&userData.trim().length>0;
      const fieldsHtml=o.tpl.map(t=>`<li>${escHtml(t)}</li>`).join("");
      const userBlock=hasUserData?`<div class="user-data"><div class="user-data-lbl">📝 Datos registrados del proyecto:</div><div class="user-data-content">${escHtml(userData).replace(/\n/g,"<br/>")}</div></div>`:`<div class="user-data-empty">— Sin datos registrados para este proyecto —</div>`;
      return `<div class="out-box"><div class="out-n">${oi+1}. ${escHtml(o.n)}</div><div class="out-lbl">Campos del documento (PMBOK® 8):</div><ul class="out-fields">${fieldsHtml}</ul>${userBlock}</div>`;
    }).join("");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(proc.id)} — ${escHtml(proc.n)}</title><style>
@page{size:A4;margin:1.8cm 1.5cm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:10pt;line-height:1.55;color:#1a1a1a;background:#FFF}
.cover{border-bottom:3px solid #14B8A6;padding-bottom:10px;margin-bottom:16px}
.brand{font-size:8pt;color:#14B8A6;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:4px}
.pn{font-size:14pt;color:#0F7B6D;font-weight:700;margin-bottom:2px}
.pmeta{font-size:9pt;color:#555}
.proc-h{background:#F0FDFA;border-left:4px solid #14B8A6;padding:10px 14px;margin:14px 0;border-radius:0 4px 4px 0}
.proc-id{font-family:'Courier New',monospace;font-size:9pt;color:#14B8A6;letter-spacing:1.5px;font-weight:700}
.proc-n{font-size:14pt;font-weight:700;color:#1a1a1a;margin:3px 0}
.proc-meta{font-size:9pt;color:#555}
.proc-meta span{display:inline-block;padding:2px 8px;background:#14B8A622;color:#0F7B6D;border-radius:10px;margin-right:6px;font-weight:600;font-size:8pt}
.proc-obj{font-size:10pt;color:#333;background:#F8FAFA;border:1px solid #E5E7EB;border-radius:4px;padding:9px 11px;margin-top:8px;line-height:1.6}
.sec-ti{font-size:12pt;font-weight:700;color:#14B8A6;margin:18px 0 8px;padding:5px 0 5px 10px;border-left:4px solid #14B8A6;background:#F0FDFA}
.sec-ti .ic{margin-right:6px}
.sec-desc{font-size:8.5pt;color:#666;font-style:italic;margin-bottom:10px;padding-left:10px}
.in-box{border:1px solid #D1D5DB;border-left:3px solid #3A7BD5;padding:7px 10px;margin-bottom:5px;border-radius:0 3px 3px 0;page-break-inside:avoid}
.in-box.src-ref{border-left-color:#14B8A6;background:#F0FDFA}
.in-box.src-eef{border-left-color:#F39C12;background:#FFFBEB}
.in-box.src-opa{border-left-color:#9B59B6;background:#F5F3FF}
.in-box.src-ext{border-left-color:#6B7E94;background:#F9FAFB}
.in-n{font-size:10pt;font-weight:600;color:#1a1a1a;margin-bottom:2px}
.in-s{font-family:'Courier New',monospace;font-size:8pt;color:#555;letter-spacing:.3px}
.out-box{border:1px solid #D1D5DB;border-left:3px solid #27AE60;background:#F0FDF4;padding:10px 12px;margin-bottom:9px;border-radius:0 4px 4px 0;page-break-inside:avoid}
.out-n{font-size:11pt;font-weight:700;color:#166534;margin-bottom:5px}
.out-lbl{font-family:'Courier New',monospace;font-size:8pt;color:#0F7B6D;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.out-fields{list-style:none;padding:0}
.out-fields li{font-size:9pt;color:#333;padding:2px 0 2px 12px;position:relative;line-height:1.5}
.out-fields li::before{content:'▸';color:#14B8A6;position:absolute;left:0;font-weight:700}
.user-data{margin-top:9px;background:#FFF;border:1px solid #14B8A666;border-radius:4px;padding:8px 10px}
.user-data-lbl{font-family:'Courier New',monospace;font-size:8pt;color:#14B8A6;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
.user-data-content{font-size:9.5pt;color:#1a1a1a;line-height:1.6;white-space:pre-wrap}
.user-data-empty{margin-top:7px;font-size:8.5pt;color:#999;font-style:italic;padding:5px 9px;background:#F9FAFB;border-radius:3px;text-align:center}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #14B8A6;font-size:8pt;color:#666;text-align:center;line-height:1.6}
.footer strong{color:#14B8A6}
.pb{page-break-before:always}
@media print{.no-print{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.print-btn{position:fixed;top:15px;right:15px;background:#14B8A6;color:#FFF;border:none;padding:10px 16px;border-radius:5px;font-size:11pt;font-weight:700;cursor:pointer;box-shadow:0 3px 8px #00000033}
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<div class="cover"><div class="brand">SYSTENGER SPMS+ v2.0 · PMBOK® Guide 8th Edition</div><div class="pn">${escHtml(pn)}</div><div class="pmeta">Contrato: ${escHtml(pc)} · Generado: ${escHtml(today)}</div></div>
<div class="proc-h"><div class="proc-id">PROCESO ${escHtml(proc.id)}</div><div class="proc-n">${escHtml(proc.n)}</div><div class="proc-meta"><span>${escHtml(proc.fa)}</span><span>${dom?escHtml(dom.n):""}</span></div><div class="proc-obj">${escHtml(proc.obj)}</div></div>
<div class="sec-ti"><span class="ic">📥</span>INPUTS</div>
<div class="sec-desc">Documentos, datos y factores necesarios para ejecutar este proceso. Los marcados 🔗 son outputs de otros procesos del proyecto.</div>
${inputsHtml}
<div class="sec-ti"><span class="ic">📤</span>OUTPUTS</div>
<div class="sec-desc">Documentos y entregables que produce este proceso. Varios servirán como inputs de procesos posteriores.</div>
${outputsHtml}
<div class="footer"><strong>SYSTENGER S.A.</strong> · Informe generado automáticamente desde SPMS+ v2.0<br/>Ref: PMBOK® Guide 8th Edition (PMI, 2025) · Inputs/Outputs adherentes al estándar</div>
</body></html>`;
  };

  const buildAllProcessesPDFHtml=(filterDomain,proj,userNotes)=>{
    const list=filterDomain?PR.filter(p=>p.d===filterDomain):PR;
    const dom=filterDomain?DOM.find(d=>d.id===filterDomain):null;
    const pn=proj?.name||"—";const pc=proj?.contract||"—";
    const today=new Date().toLocaleDateString("es-PA",{day:"2-digit",month:"long",year:"numeric"});
    const title=dom?"Dominio "+dom.n+" — "+list.length+" procesos":"Biblioteca completa PMBOK® 8 — 40 procesos";
    const procsHtml=list.map((proc,idx)=>{
      const dd=DOM.find(d=>d.id===proc.d);
      const inputs=PR_IN[proc.id]||[];
      const inputsHtml=inputs.map((s,i)=>{
        const p=parseInput(s);
        const srcClass=p.type==="ref"?"src-ref":p.type==="eef"?"src-eef":p.type==="opa"?"src-opa":"src-ext";
        return `<div class="in-box ${srcClass}"><div class="in-n">${i+1}. ${escHtml(p.name)}</div><div class="in-s">${escHtml(p.src)}</div></div>`;
      }).join("");
      const outputsHtml=proc.out.map((o,oi)=>{
        const userData=userNotes?userNotes[proc.id+"_"+oi]||"":"";
        const hasUserData=userData&&userData.trim().length>0;
        const fieldsHtml=o.tpl.map(t=>`<li>${escHtml(t)}</li>`).join("");
        const userBlock=hasUserData?`<div class="user-data"><div class="user-data-lbl">📝 Datos registrados:</div><div class="user-data-content">${escHtml(userData).replace(/\n/g,"<br/>")}</div></div>`:`<div class="user-data-empty">— Sin datos registrados —</div>`;
        return `<div class="out-box"><div class="out-n">${oi+1}. ${escHtml(o.n)}</div><div class="out-lbl">Campos PMBOK® 8:</div><ul class="out-fields">${fieldsHtml}</ul>${userBlock}</div>`;
      }).join("");
      return `<div class="${idx>0?"pb":""}"><div class="proc-h"><div class="proc-id">PROCESO ${escHtml(proc.id)}</div><div class="proc-n">${escHtml(proc.n)}</div><div class="proc-meta"><span>${escHtml(proc.fa)}</span><span>${dd?escHtml(dd.n):""}</span></div><div class="proc-obj">${escHtml(proc.obj)}</div></div><div class="sec-ti"><span class="ic">📥</span>INPUTS</div>${inputsHtml}<div class="sec-ti"><span class="ic">📤</span>OUTPUTS</div>${outputsHtml}</div>`;
    }).join("");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(title)} — ${escHtml(pn)}</title><style>
@page{size:A4;margin:1.8cm 1.5cm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:10pt;line-height:1.55;color:#1a1a1a;background:#FFF}
.cover{min-height:85vh;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:40px;page-break-after:always;background:linear-gradient(160deg,#F0FDFA 0%,#FFF 100%);border-radius:10px}
.cover-brand{font-size:10pt;color:#14B8A6;letter-spacing:3px;text-transform:uppercase;font-weight:700;margin-bottom:20px}
.cover-title{font-size:28pt;font-weight:800;color:#0F7B6D;margin-bottom:10px;line-height:1.2}
.cover-sub{font-size:13pt;color:#14B8A6;margin-bottom:30px;font-style:italic}
.cover-pn{font-size:16pt;font-weight:700;color:#1a1a1a;margin-bottom:8px}
.cover-pc{font-size:11pt;color:#555;margin-bottom:40px}
.cover-date{font-size:9pt;color:#888;letter-spacing:1px}
.proc-h{background:#F0FDFA;border-left:4px solid #14B8A6;padding:10px 14px;margin:14px 0;border-radius:0 4px 4px 0}
.proc-id{font-family:'Courier New',monospace;font-size:9pt;color:#14B8A6;letter-spacing:1.5px;font-weight:700}
.proc-n{font-size:14pt;font-weight:700;color:#1a1a1a;margin:3px 0}
.proc-meta span{display:inline-block;padding:2px 8px;background:#14B8A622;color:#0F7B6D;border-radius:10px;margin-right:6px;font-weight:600;font-size:8pt}
.proc-obj{font-size:10pt;color:#333;background:#F8FAFA;border:1px solid #E5E7EB;border-radius:4px;padding:9px 11px;margin-top:8px;line-height:1.6}
.sec-ti{font-size:12pt;font-weight:700;color:#14B8A6;margin:16px 0 8px;padding:5px 0 5px 10px;border-left:4px solid #14B8A6;background:#F0FDFA}
.in-box{border:1px solid #D1D5DB;border-left:3px solid #3A7BD5;padding:6px 10px;margin-bottom:4px;border-radius:0 3px 3px 0;page-break-inside:avoid}
.in-box.src-ref{border-left-color:#14B8A6;background:#F0FDFA}
.in-box.src-eef{border-left-color:#F39C12;background:#FFFBEB}
.in-box.src-opa{border-left-color:#9B59B6;background:#F5F3FF}
.in-box.src-ext{border-left-color:#6B7E94;background:#F9FAFB}
.in-n{font-size:9.5pt;font-weight:600;color:#1a1a1a;margin-bottom:2px}
.in-s{font-family:'Courier New',monospace;font-size:7.5pt;color:#555}
.out-box{border:1px solid #D1D5DB;border-left:3px solid #27AE60;background:#F0FDF4;padding:9px 11px;margin-bottom:7px;border-radius:0 4px 4px 0;page-break-inside:avoid}
.out-n{font-size:10.5pt;font-weight:700;color:#166534;margin-bottom:4px}
.out-lbl{font-family:'Courier New',monospace;font-size:7.5pt;color:#0F7B6D;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}
.out-fields{list-style:none;padding:0}
.out-fields li{font-size:9pt;color:#333;padding:1px 0 1px 12px;position:relative;line-height:1.45}
.out-fields li::before{content:'▸';color:#14B8A6;position:absolute;left:0;font-weight:700}
.user-data{margin-top:7px;background:#FFF;border:1px solid #14B8A666;border-radius:4px;padding:7px 9px}
.user-data-lbl{font-family:'Courier New',monospace;font-size:7.5pt;color:#14B8A6;font-weight:700;margin-bottom:3px}
.user-data-content{font-size:9pt;color:#1a1a1a;line-height:1.5;white-space:pre-wrap}
.user-data-empty{margin-top:5px;font-size:8pt;color:#999;font-style:italic;text-align:center}
.pb{page-break-before:always}
@media print{.no-print{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cover{page-break-after:always}}
.print-btn{position:fixed;top:15px;right:15px;background:#14B8A6;color:#FFF;border:none;padding:10px 16px;border-radius:5px;font-size:11pt;font-weight:700;cursor:pointer;box-shadow:0 3px 8px #00000033;z-index:1000}
</style></head><body>
<button class="print-btn no-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<div class="cover"><div class="cover-brand">SYSTENGER SPMS+ v2.0</div><div class="cover-title">${escHtml(title)}</div><div class="cover-sub">PMBOK® Guide 8th Edition — Inputs &amp; Outputs</div><div class="cover-pn">${escHtml(pn)}</div><div class="cover-pc">Contrato: ${escHtml(pc)}</div><div class="cover-date">Generado: ${escHtml(today)}</div></div>
${procsHtml}
</body></html>`;
  };

  const openPDFWindow=(html)=>{
    const w=window.open("","_blank","width=900,height=700");
    if(!w){alert("⚠ Tu navegador bloqueó la ventana emergente. Permite pop-ups para este sitio para generar PDFs.");return;}
    w.document.open();w.document.write(html);w.document.close();
    setTimeout(()=>{try{w.focus();}catch(e){}},300);
  };

  const sanitizeFilename=(s)=>String(s||"documento").replace(/[^a-zA-Z0-9_\-]+/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"").slice(0,80);

  const showPDFDownloadModal=(title,baseFilename,html)=>{
    const today=new Date().toISOString().slice(0,10);
    const projPrefix=activeProj?sanitizeFilename(activeProj.name).slice(0,25)+"_":"";
    const filename="SPMS_"+projPrefix+sanitizeFilename(baseFilename)+"_"+today+".html";
    setPdfModal({title,filename,html});
  };

  const downloadHTMLFile=()=>{
    if(!pdfModal)return;
    try{
      const blob=new Blob([pdfModal.html],{type:"text/html;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=pdfModal.filename;a.style.display="none";
      document.body.appendChild(a);a.click();
      setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},100);
    }catch(err){alert("Error al descargar: "+err.message);}
  };

  const openInWindowForPrint=()=>{if(pdfModal)openPDFWindow(pdfModal.html);};

  const copyHTMLToClipboard=async()=>{
    if(!pdfModal)return;
    try{await navigator.clipboard.writeText(pdfModal.html);setTplCopied(true);setTimeout(()=>setTplCopied(false),1800);}
    catch{alert("No se pudo copiar al portapapeles.");}
  };

  const printProcessPDF=(proc)=>{
    const html=buildProcessPDFHtml(proc,activeProj,aN);
    showPDFDownloadModal(proc.id+" — "+proc.n,proc.id+"_"+proc.n.slice(0,30),html);
  };

  const printDomainPDF=(domId)=>{
    const html=buildAllProcessesPDFHtml(domId,activeProj,aN);
    const dom=DOM.find(d=>d.id===domId);
    showPDFDownloadModal("Dominio "+dom.n+" — "+PR.filter(p=>p.d===domId).length+" procesos","Dominio_"+dom.n,html);
  };

  const printAllPDF=()=>{
    const html=buildAllProcessesPDFHtml(null,activeProj,aN);
    showPDFDownloadModal("Biblioteca completa PMBOK® 8 — 40 procesos","Biblioteca_Completa_40_Procesos",html);
  };

  const renderBoomCard=(act)=>{
    const p=PRIO[act.priority]||PRIO.medium;
    const overdue=isOverdue(act.dueDate);
    const today=isToday(act.dueDate);
    const proj=projects.find(x=>x.id===act.projId);
    return(
      <div key={act.id} className={"boom-card"+(act.colId===boomBoard?.cols[4]?.id?" done":"")} style={{"--pcolor":p.color}} onClick={()=>openActDetail(act)}>
        {act.tags?.length>0&&<div className="boom-card-tags">{act.tags.slice(0,2).map(t=><span key={t} className="boom-card-tag">{t}</span>)}</div>}
        <div className="boom-card-title">{act.title}</div>
        <div className="boom-card-bottom">
          <div style={{display:"flex",gap:"4px",alignItems:"center",flexWrap:"wrap"}}>
            {proj&&<span className="boom-proj-tag">{proj.name.slice(0,15)}</span>}
            {act.dueDate&&<span className={"boom-date"+(overdue?" overdue":today?" today":"")}>{overdue?"⚠ ":today?"⏰ ":""}{fmtDate(act.dueDate)}</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
            {act.progress>0&&<div className="boom-progress-bar"><div className="boom-progress-fill" style={{width:act.progress+"%"}}/></div>}
            <div className="boom-assignees">
              {(act.assignees||[]).slice(0,2).map(uid=>{const u=users.find(x=>x.id===uid);const role=ROLES[u?.role]||ROLES.team;return u?<div key={uid} className="boom-avatar" style={{background:role.color,fontSize:"8px"}}>{initials(u.name)}</div>:null;})}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBoomActRow=(act)=>{
    const p=PRIO[act.priority]||PRIO.medium;
    const overdue=isOverdue(act.dueDate);
    const today=isToday(act.dueDate);
    const proj=projects.find(x=>x.id===act.projId);
    return(
      <div key={act.id} className="boom-act-row" style={{"--pcolor":p.color}} onClick={()=>openActDetail(act)}>
        <span style={{fontSize:"12px",flexShrink:0}}>{p.dot}</span>
        <span className="boom-act-title">{act.title}</span>
        <div className="boom-act-meta">
          {proj&&<span className="boom-proj-tag">{proj.name.slice(0,12)}</span>}
          {act.dueDate&&<span className={"boom-date"+(overdue?" overdue":today?" today":"")}>{fmtDate(act.dueDate)}</span>}
          {act.progress>0&&<div className="boom-progress-bar"><div className="boom-progress-fill" style={{width:act.progress+"%"}}/></div>}
          <div className="boom-assignees">
            {(act.assignees||[]).slice(0,2).map(uid=>{const u=users.find(x=>x.id===uid);const role=ROLES[u?.role]||ROLES.team;return u?<div key={uid} className="boom-avatar" style={{background:role.color}}>{initials(u.name)}</div>:null;})}
          </div>
        </div>
      </div>
    );
  };

  return(
    <div className="root">
      <style>{CSS}</style>
      <div className="nav">
        {TABS.map(t=><button key={t.id} className={"nb"+(view===t.id?" on":"")} onClick={()=>navTo(t.id)}>{t.l}</button>)}
        <div style={{flex:1}}/>
        <div className="user-area">
          {sbReady?(
            <span className={"sync-bar sync-"+syncStatus} onClick={pullFromSupabase} title={syncMsg||"Clic para sincronizar"}>
              <span className="sync-dot"/>
              {syncStatus==="synced"?"☁ Sync":syncStatus==="syncing"?"Sync...":syncStatus==="offline"?"Offline":syncStatus==="error"?"Error":"Local"}
            </span>
          ):(
            <span className="sync-bar sync-local" title="Modo local — datos solo en este navegador"><span className="sync-dot"/>Local</span>
          )}
          <div className="ubadge" style={{background:r.color+"22",color:r.color,borderColor:r.color+"44"}}>{r.icon} {cu.name}</div>
          <button className="logout-btn" onClick={doLogout}>Salir</button>
        </div>
      </div>

      {view!=="home"&&view!=="proyectos"&&view!=="usuarios"&&view!=="coorp"&&projectBar()}

      {delPConf&&<div className="modal-ov"><div className="modal-box"><div className="modal-t">🗑 Eliminar Proyecto</div><div className="modal-d">Esta acción es <strong>irreversible</strong>.</div><div className="modal-btns"><button className="modal-cnc" onClick={()=>setDelPConf(null)}>Cancelar</button><button className="modal-del" onClick={delProj}>Eliminar</button></div></div></div>}
      {delUConf&&<div className="modal-ov"><div className="modal-box"><div className="modal-t">🗑 Eliminar Usuario</div><div className="modal-d">Esta acción eliminará el usuario permanentemente.</div><div className="modal-btns"><button className="modal-cnc" onClick={()=>setDelUConf(null)}>Cancelar</button><button className="modal-del" onClick={delUser}>Eliminar</button></div></div></div>}
      {openAct&&boomModal()}
      {tplModal&&(
        <div className="tpl-modal-ov" onClick={e=>{if(e.target.className==="tpl-modal-ov")setTplModal(null);}}>
          <div className="tpl-modal">
            <div className="tpl-modal-hdr">
              <div style={{flex:1}}>
                <div className="tpl-modal-ti">📄 {tplModal.outName}</div>
                <div className="tpl-modal-sub">Proceso {tplModal.procId} · {tplModal.procName}</div>
              </div>
              <button className="tpl-modal-close" onClick={()=>setTplModal(null)}>✕</button>
            </div>
            <div className="tpl-modal-body">
              <div className="tpl-info">
                {tplModal.source==="oficial"?<><strong>Template oficial</strong> — Estructura basada en PMBOK® Guide 8th Edition (PMI, 2025). Los placeholders <code>{"{{campo}}"}</code> se llenan automáticamente con los datos del proyecto activo.</>:<><strong>Template auto-generado</strong> — Estructura genérica derivada de los campos estándar del output. Consulta publicaciones PMI recientes para plantillas más específicas de este documento.</>}
                {!activeId&&<div style={{marginTop:"6px",color:"#F39C12"}}>⚠ Sin proyecto activo — los datos aparecerán como placeholders. Selecciona un proyecto para personalizar.</div>}
              </div>
              <pre className="tpl-content">{tplModal.text}</pre>
            </div>
            <div className="tpl-modal-ftr">
              <button className="tpl-btn-copy" onClick={copyTpl}>📋 Copiar</button>
              <button className="tpl-btn-cancel" onClick={()=>setTplModal(null)}>Cerrar</button>
              <button className="tpl-btn-use" disabled={!activeId} style={!activeId?{opacity:0.4,cursor:"not-allowed"}:{}} onClick={useTplAsBase} title={!activeId?"Selecciona un proyecto activo primero":"Cargar este template como base en el editor"}>✨ Usar como base en el editor</button>
            </div>
          </div>
        </div>
      )}
      {tplCopied&&<div className="tpl-copy-toast">✓ Template copiado al portapapeles</div>}
      {pdfModal&&(
        <div className="pdf-dl-ov" onClick={e=>{if(e.target.className==="pdf-dl-ov")setPdfModal(null);}}>
          <div className="pdf-dl-modal">
            <div className="pdf-dl-hdr">
              <span className="pdf-dl-hdr-ic">📄</span>
              <div style={{flex:1}}>
                <div className="pdf-dl-hdr-ti">Informe generado</div>
                <div className="pdf-dl-hdr-sub">Listo para descarga / impresión</div>
              </div>
              <button className="pdf-dl-close" onClick={()=>setPdfModal(null)}>✕</button>
            </div>
            <div className="pdf-dl-body">
              <div className="pdf-dl-info">
                <div className="pdf-dl-info-lbl">Documento</div>
                <div className="pdf-dl-info-val">{pdfModal.title}</div>
                <div className="pdf-dl-info-lbl" style={{marginTop:"8px"}}>Nombre de archivo</div>
                <div className="pdf-dl-info-fn">{pdfModal.filename}</div>
              </div>
              <div className="pdf-dl-actions">
                <button className="pdf-dl-action" onClick={downloadHTMLFile}>
                  <span className="pdf-dl-action-t">📥 Descargar archivo HTML</span>
                  <span className="pdf-dl-action-d">Guarda el informe en tu computadora. Ábrelo con cualquier navegador y usa Ctrl/⌘+P para imprimir o guardar como PDF. 100% autocontenido.</span>
                </button>
                <button className="pdf-dl-action secondary" onClick={openInWindowForPrint}>
                  <span className="pdf-dl-action-t">🖨️ Abrir e imprimir ahora</span>
                  <span className="pdf-dl-action-d">Abre en una nueva ventana con botón de impresión directo. Requiere que tu navegador permita pop-ups.</span>
                </button>
                <button className="pdf-dl-action tertiary" onClick={copyHTMLToClipboard}>
                  <span className="pdf-dl-action-t">📋 Copiar HTML al portapapeles</span>
                  <span className="pdf-dl-action-d">Pega el código en cualquier editor o correo electrónico.</span>
                </button>
              </div>
              <div className="pdf-dl-tip">
                <strong>💡 Consejo para obtener PDF</strong>
                Descarga el HTML → ábrelo con doble clic → presiona <strong style={{display:"inline",fontFamily:"inherit",fontSize:"inherit",letterSpacing:"normal",textTransform:"none",margin:0,color:"#F5CBA7"}}>Ctrl+P</strong> (Windows) o <strong style={{display:"inline",fontFamily:"inherit",fontSize:"inherit",letterSpacing:"normal",textTransform:"none",margin:0,color:"#F5CBA7"}}>⌘+P</strong> (Mac) → en destino elige <strong style={{display:"inline",fontFamily:"inherit",fontSize:"inherit",letterSpacing:"normal",textTransform:"none",margin:0,color:"#F5CBA7"}}>"Guardar como PDF"</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {view==="home"&&(<>
        <div className="hero">
          <div className="eyebrow">Gerencia de Proyectos</div>
          <div className="brand-big"><span className="b1">SYST</span><span className="b2">EN</span><span className="b3">GER</span></div>
          <div className="brand-sa">S.A.</div>
          <div className="brand-divider"/>
          <div className="htitle">SPMS<em>+</em> v2.0</div>
          <div className="hfull">Systenger Project Management System Plus · Version 2.0</div>
          <div className="hsub">PMBOK® 8 · Scrumban · BOOM COMPROMISE · Gestión multi-proyecto</div>
          <div className="pillars">
            <div className="pillar"><span className="pc pc-b1">SYST</span><span className="pn">Sistema</span></div>
            <div className="pillar"><span className="pc pc-b2">EN</span><span className="pn">Ingeniería</span></div>
            <div className="pillar"><span className="pc pc-b3">GER</span><span className="pn">Prácticas</span></div>
          </div>
          <div style={{background:"#0B1F27",border:"1px solid "+r.color+"44",borderLeft:"4px solid "+r.color,borderRadius:"6px",padding:"12px 14px",textAlign:"left"}}>
            <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"8px",color:r.color,letterSpacing:"2px",textTransform:"uppercase",marginBottom:"6px"}}>Sesión activa</div>
            <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
              <div style={{width:"38px",height:"38px",background:r.color+"22",border:"2px solid "+r.color,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0}}>{r.icon}</div>
              <div><div style={{fontFamily:"Syne,sans-serif",fontSize:"15px",fontWeight:700,color:"#FFF"}}>{cu.name}</div><div style={{fontSize:"10px",color:r.color,fontWeight:600}}>{r.label} · {r.sub}</div></div>
            </div>
          </div>
        </div>
        <div className="llist">
          {LAYERS.map(l=><div key={l.n} className="lcard" style={{"--lc":l.col}}><div className="lcard-n">{l.n}</div><div className="lcard-t">{l.t}</div><div className="lcard-d">{l.d}</div><div className="lcard-tags">{l.tags.map(t=><span key={t} className="ltag">{t}</span>)}</div></div>)}
        </div>
        <div className="footer">SPMS+ v2.0 · SYSTENGER · BOOM COMPROMISE · PMBOK® 8</div>
      </>)}

      {view==="proyectos"&&(<>
        {editingId!==null?(
          <>
            <div className="pe-hdr">
              <button className="pe-back" onClick={()=>{setEditingId(null);setProjSaved(false);}}>← Volver</button>
              <span className="pe-ti">{editingId==="new"?"Nuevo Proyecto":"Editar Proyecto"}</span>
              {projSaved&&<span className="sbd">✓ Guardado</span>}
              <button className="pe-save" onClick={saveEdit}>💾 Guardar</button>
            </div>
            <div className="pe-sec">
              {PF.map(g=><div key={g.group} className="fg"><div className="fg-t">{g.group}</div>{g.fields.map(f=><div key={f.k} className="fr"><div className="fl">{f.l}</div><input className="fi" value={editForm[f.k]||""} onChange={e=>setEditForm(p=>({...p,[f.k]:e.target.value}))} placeholder={"Ingresa "+f.l.toLowerCase()+"..."}/></div>)}</div>)}
              <div className="fg"><div className="fg-t">Asignación de Usuarios</div>
                <div className="fr"><div className="fl">PM asignado</div><select className="fi" value={editForm.assignedPM||""} onChange={e=>setEditForm(p=>({...p,assignedPM:e.target.value}))}><option value="">Sin asignar</option>{users.filter(u=>u.role==="pm"||u.role==="sponsor").map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></div>
                <div className="fr"><div className="fl">Miembro de equipo</div><select className="fi" value={editForm.assignedTeam||""} onChange={e=>setEditForm(p=>({...p,assignedTeam:e.target.value}))}><option value="">Sin asignar</option>{users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></div>
              </div>
              <div style={{height:"20px"}}/>
            </div>
          </>
        ):(
          <>
            <div className="pm-hdr"><div className="pm-ey">Multi-Proyecto · {r.icon} {r.label}</div><div className="pm-ti">Proyectos ({visProjs.length})</div></div>
            <div className="pm-wrap">
              {can(cu,"createProject")&&<button className="pm-new" onClick={startNew}>➕ Crear nuevo proyecto</button>}
              {visProjs.length===0?(<div style={{textAlign:"center",padding:"30px",color:"#6B7E94",fontSize:"12px",lineHeight:"1.7"}}><div style={{fontSize:"32px",marginBottom:"10px"}}>📁</div><div style={{fontFamily:"Syne,sans-serif",fontSize:"14px",color:"#CDD6E4",marginBottom:"6px",fontWeight:700}}>Sin proyectos</div><div>{can(cu,"createProject")?"Crea tu primer proyecto.":"No tienes proyectos asignados."}</div></div>):(
                <><div className="pm-sl">Proyectos</div>{visProjs.map(p=>{const au=users.find(u=>u.id===p.assignedPM);return(<div key={p.id} className={"pjcard"+(p.id===activeId?" act":"")}>
                  <div className="pj-top"><div className="pj-icon">🏗</div><div style={{flex:1}}><div style={{display:"flex",alignItems:"flex-start",gap:"6px"}}><div style={{flex:1}}><div className="pj-name">{p.name||"Sin nombre"}</div>{p.contract&&<div className="pj-ctr">{p.contract}</div>}</div>{p.id===activeId&&<span className="pj-abadge">ACTIVO</span>}</div></div></div>
                  <div className="pj-meta">{p.pm&&<div className="pj-mi">👤 <strong>{p.pm}</strong></div>}{p.bac&&<div className="pj-mi">💰 <strong>{p.bac_currency||"USD"} {p.bac}</strong></div>}{au&&<div className="pj-mi">🎯 <strong style={{color:ROLES.pm.color}}>{au.name}</strong></div>}</div>
                  <div className="pj-acts">
                    {p.id!==activeId?<button className="pj-sel" onClick={()=>saveProj(projects,p.id)}>✓ Seleccionar</button>:<div style={{flex:1,fontSize:"10px",color:"#6FCF97",display:"flex",alignItems:"center",gap:"4px"}}>✓ Activo</div>}
                    {can(cu,"createProject")&&<button className="pj-edt" onClick={()=>startEdit(p)}>✏️</button>}
                    {can(cu,"deleteProject")&&<button className="pj-del" onClick={()=>setDelPConf(p.id)}>🗑</button>}
                  </div>
                </div>);})}</>
              )}
            </div>
            <div className="footer">SPMS+ v2.0 · Gestión Multi-Proyecto</div>
          </>
        )}
      </>)}

      {view==="boom"&&(<>
        <div className="sec-hdr" style={{top:"42px"}}>
          <div className="sec-ey">BOOM COMPROMISE · Módulo de Gestión de Actividades</div>
          <div className="sec-ti">⚡ BOOM{activeProj&&<span style={{fontFamily:"JetBrains Mono,monospace",fontSize:"9px",color:"#1ABC9C",marginLeft:"8px",background:"#1ABC9C22",padding:"2px 6px",borderRadius:"3px"}}>📁 {activeProj.name}</span>}</div>
        </div>
        <div className="boom-subnav" style={{top:"86px"}}>
          {[["panel","🏠 Mi Panel"],["board","📋 Tablero"],["list","📑 Lista"]].map(([v,l])=>(<button key={v} className={"boom-snb"+(boomView===v?" on":"")} onClick={()=>setBoomView(v)}>{l}</button>))}
          <button className="boom-add-btn" onClick={()=>openNewAct()}>+ Nueva actividad</button>
        </div>

        {(boomView==="board"||boomView==="list")&&(
          <div className="boom-filter-bar" style={{top:"126px"}}>
            <span className="boom-filter-label">Filtrar:</span>
            <select className="boom-filter-select" value={boomFilter.proj} onChange={e=>setBoomFilter(f=>({...f,proj:e.target.value}))}>
              <option value="">Todos los proyectos</option>
              {visProjs.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="boom-filter-select" value={boomFilter.priority} onChange={e=>setBoomFilter(f=>({...f,priority:e.target.value}))}>
              <option value="">Todas las prioridades</option>
              {Object.entries(PRIO).map(([k,p])=><option key={k} value={k}>{p.dot} {p.label}</option>)}
            </select>
            <select className="boom-filter-select" value={boomFilter.col} onChange={e=>setBoomFilter(f=>({...f,col:e.target.value}))}>
              <option value="">Todos los estados</option>
              {(boomBoard?.cols||SCOLS).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {(boomFilter.proj||boomFilter.priority||boomFilter.col)&&<button style={{background:"transparent",border:"1px solid #E74C3C44",color:"#E57373",padding:"4px 8px",borderRadius:"3px",cursor:"pointer",fontSize:"10px",fontFamily:"Outfit,sans-serif",flexShrink:0}} onClick={()=>setBoomFilter({proj:"",priority:"",col:""})}>✕ Limpiar</button>}
          </div>
        )}

        {boomView==="panel"&&(
          <div className="boom-panel">
            <div className="boom-greeting">Hola, {cu.name.split(" ")[0]} {r.icon}</div>
            <div className="boom-greeting-sub">{new Date().toLocaleDateString("es-PA",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
            <div className="boom-stats">
              {[["Total asignadas",myActs.length,""],["Vencidas",myActs.filter(a=>isOverdue(a.dueDate)).length,"red"],["Para hoy",myActs.filter(a=>isToday(a.dueDate)).length,"amber"],["Completadas",myActs.filter(a=>a.colId===(boomBoard?.cols[4]?.id)).length,""]].map(([l,v,cls])=>(
                <div key={l} className="boom-stat"><div className={"boom-stat-val"+(cls?" "+cls:"")}>{v}</div><div className="boom-stat-lbl">{l}</div></div>
              ))}
            </div>
            {[["🔴 Vencidas",myActs.filter(a=>isOverdue(a.dueDate)&&a.colId!==(boomBoard?.cols[4]?.id))],["⏰ Para hoy",myActs.filter(a=>isToday(a.dueDate))],["📅 Esta semana",myActs.filter(a=>isThisWeek(a.dueDate)&&!isToday(a.dueDate))],["📋 Próximas / Sin fecha",myActs.filter(a=>!a.dueDate&&a.colId!==(boomBoard?.cols[4]?.id))]].map(([section,acts])=>(
              acts.length>0&&<div key={section}><div className="boom-section-lbl">{section} ({acts.length})</div>{acts.map(a=>renderBoomActRow(a))}</div>
            ))}
            {myActs.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:"#6B7E94"}}><div style={{fontSize:"36px",marginBottom:"10px"}}>✅</div><div style={{fontFamily:"Syne,sans-serif",fontSize:"14px",color:"#CDD6E4",marginBottom:"6px",fontWeight:700}}>Sin actividades asignadas</div><div style={{fontSize:"12px"}}>Crea una actividad con "+ Nueva actividad".</div></div>}
          </div>
        )}

        {boomView==="board"&&(()=>{
          const board=ensureBoard();
          return(
            <div className="boom-board-wrap">
              {board.cols.map(col=>{
                const colActs=filteredActs.filter(a=>a.colId===col.id).sort((a,b)=>a.order-b.order);
                const wipOk=!col.wip||colActs.length<=col.wip;
                return(
                  <div key={col.id} className="boom-col">
                    <div className="boom-col-hdr">
                      <div className="boom-col-dot" style={{background:col.color}}/>
                      <div className="boom-col-name">{col.name}</div>
                      <span className="boom-col-cnt">{colActs.length}</span>
                      {col.wip&&<span className="boom-col-wip" style={{color:wipOk?"#6B7E94":"#F39C12"}}>WIP {col.wip}{!wipOk&&" ⚠"}</span>}
                    </div>
                    <div className="boom-cards">
                      {colActs.map(a=>renderBoomCard(a))}
                    </div>
                    <div className="boom-col-add">
                      <button className="boom-col-add-btn" onClick={()=>openNewAct(col.id)}>+ Agregar actividad</button>
                    </div>
                  </div>
                );
              })}
              <div style={{paddingRight:"14px",flexShrink:0,width:"1px"}}/>
            </div>
          );
        })()}

        {boomView==="list"&&(
          <div className="boom-list-wrap">
            {filteredActs.length===0?(<div style={{textAlign:"center",padding:"40px 20px",color:"#6B7E94"}}><div style={{fontSize:"36px",marginBottom:"10px"}}>📋</div><div style={{fontFamily:"Syne,sans-serif",fontSize:"14px",color:"#CDD6E4",marginBottom:"6px",fontWeight:700}}>Sin actividades</div><div style={{fontSize:"12px"}}>Crea una o ajusta los filtros.</div></div>):(
              <table className="boom-list-table">
                <thead><tr>
                  <th className="boom-list-th">Actividad</th>
                  <th className="boom-list-th">Proyecto</th>
                  <th className="boom-list-th">Prioridad</th>
                  <th className="boom-list-th">Estado</th>
                  <th className="boom-list-th">Asignados</th>
                  <th className="boom-list-th">Fecha</th>
                  <th className="boom-list-th">Prog.</th>
                </tr></thead>
                <tbody>
                  {filteredActs.map(act=>{
                    const p=PRIO[act.priority]||PRIO.medium;
                    const col=boomBoard?.cols.find(c=>c.id===act.colId);
                    const proj=projects.find(x=>x.id===act.projId);
                    const overdue=isOverdue(act.dueDate);
                    const today=isToday(act.dueDate);
                    return(
                      <tr key={act.id} className="boom-list-tr" onClick={()=>openActDetail(act)}>
                        <td className="boom-list-td" style={{borderLeft:"3px solid "+p.color}}><div style={{fontWeight:600,color:"#FFF",marginBottom:"2px"}}>{act.title}</div>{act.tags?.length>0&&<div style={{display:"flex",gap:"3px",flexWrap:"wrap",marginTop:"3px"}}>{act.tags.slice(0,2).map(t=><span key={t} className="boom-card-tag">{t}</span>)}</div>}</td>
                        <td className="boom-list-td">{proj?<span className="boom-proj-tag">{proj.name.slice(0,14)}</span>:"—"}</td>
                        <td className="boom-list-td">{p.dot} {p.label}</td>
                        <td className="boom-list-td"><span style={{fontSize:"10px",padding:"2px 7px",borderRadius:"3px",background:col?.color+"22",color:col?.color,border:"1px solid "+(col?.color||"#6B7E94")+"44"}}>{col?.name||"—"}</span></td>
                        <td className="boom-list-td"><div className="boom-assignees">{(act.assignees||[]).slice(0,3).map(uid=>{const u=users.find(x=>x.id===uid);const role=ROLES[u?.role]||ROLES.team;return u?<div key={uid} className="boom-avatar" style={{background:role.color,width:"22px",height:"22px",fontSize:"9px"}}>{initials(u.name)}</div>:null;})}</div></td>
                        <td className="boom-list-td" style={{color:overdue?"#E74C3C":today?"#F39C12":"inherit",fontFamily:"JetBrains Mono,monospace",fontSize:"10px"}}>{act.dueDate?fmtDate(act.dueDate):"—"}</td>
                        <td className="boom-list-td"><div className="boom-progress-bar" style={{width:"60px"}}><div className="boom-progress-fill" style={{width:act.progress+"%"}}/></div><span style={{fontSize:"9px",color:"#6B7E94",fontFamily:"JetBrains Mono,monospace"}}>{act.progress}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        <div className="footer">⚡ BOOM COMPROMISE · SPMS+ v2.0</div>
      </>)}

      {view==="principles"&&(<>
        <div className="sec-hdr"><div className="sec-ey">PMBOK® Guide 8th Edition · PMI 2025</div><div className="sec-ti">6 Principios Fundamentales</div></div>
        <div className="plist">{[{n:"P1",en:"Adopt a Holistic View",es:"Visión Holística",d:"Ve el proyecto como parte de un sistema mayor."},{n:"P2",en:"Focus on Value",es:"Enfoque en el Valor",d:"Mide el éxito por los outcomes que importan a los stakeholders."},{n:"P3",en:"Embed Quality Into Processes and Deliverables",es:"Calidad Integrada",d:"Construye calidad desde el inicio, no como inspección final."},{n:"P4",en:"Be an Accountable Leader",es:"Liderazgo Responsable",d:"Toma propiedad de las decisiones. Fomenta cultura de accountability."},{n:"P5",en:"Integrate Sustainability Within All Project Areas",es:"Sostenibilidad Integrada",d:"Considera impactos ambientales, económicos y sociales."},{n:"P6",en:"Build an Empowered Culture",es:"Cultura Empoderada",d:"Fomenta colaboración, confianza y seguridad psicológica."}].map(p=>(
          <div key={p.n} className="p-card"><div className="p-num">{p.n}</div><div><div className="p-en">{p.en}</div><div className="p-es">{p.es}</div><div className="p-desc">{p.d}</div></div></div>
        ))}</div>
        <div className="footer">PMBOK® 8 · SPMS+ v2.0</div>
      </>)}

      {view==="pmbok"&&(<>
        <div className="sec-hdr"><div className="sec-ey">PMBOK® Guide 8th Edition · 40 Procesos</div><div className="sec-ti">{selDom?DOM.find(d=>d.id===selDom)?.n+" — "+PR.filter(p=>p.d===selDom).length+" procesos":"7 Dominios de Desempeño"}</div></div>
        {!selDom?(<>
          <div style={{padding:"10px 16px 0"}}><div className="pdf-btns-row"><button className="pdf-btn pdf-btn-all" onClick={printAllPDF}>🖨️ Imprimir biblioteca completa (40 procesos)</button></div></div>
          <div className="dgrid">{DOM.map(d=><div key={d.id} className="dc" onClick={()=>{setSelDom(d.id);setOpenProc(null);}}><div className="dc-bar" style={{background:d.col}}/><div className="dc-c">{d.c}</div><div className="dc-n">{d.n}</div><div className="dc-cnt">{d.cnt} procesos</div><div className="dc-bg">{d.id.replace("D","")}</div></div>)}</div>
        </>):(
          <>
            <button className="back-btn" onClick={()=>{setSelDom(null);setOpenProc(null);}}>← Todos los dominios</button>
            <div style={{padding:"0 16px 6px",fontSize:"11px",color:"#6B7E94"}}>{DOM.find(d=>d.id===selDom)?.desc}</div>
            <div style={{padding:"0 16px"}}><div className="pdf-btns-row"><button className="pdf-btn" onClick={()=>printDomainPDF(selDom)}>🖨️ Imprimir dominio completo (PDF)</button></div></div>
            <div className="plist2">
              {PR.filter(p=>p.d===selDom).map(p=>{
                const isO=openProc===p.id,fa=FAS[p.fa]||{bg:"#112A32",tx:"#14B8A6"};
                return(<div key={p.id} className={"pi"+(isO?" open":"")}>
                  <div className="pi-hdr" onClick={()=>{setOpenProc(isO?null:p.id);setProcTab(0);}}>
                    <span className="pi-id">{p.id}</span><span className="pi-fa" style={{background:fa.bg,color:fa.tx}}>{p.fa}</span><span className="pi-n">{p.n}</span><span className={"pi-ch"+(isO?" open":"")}>▼</span>
                  </div>
                  {isO&&(<div className="pd">
                    <div className="pd-pv">← PMBOK 6/7: {p.pv}</div>
                    <div className="pd-obj">{p.obj}</div>
                    <div className="pdf-btns-row"><button className="pdf-btn" onClick={e=>{e.stopPropagation();printProcessPDF(p);}}>🖨️ Generar PDF (Inputs + Outputs)</button></div>
                    <div className="stabs">{["Inputs","T&T","Outputs"].map((l,i)=><button key={i} className={"stab"+(procTab===i?" on":"")} onClick={e=>{e.stopPropagation();setProcTab(i);}}>{l}</button>)}</div>
                    {procTab===0&&(<><div className="sl">Inputs ({(PR_IN[p.id]||[]).length})</div><div style={{fontSize:"10px",color:"#8BA8A3",marginBottom:"8px",lineHeight:"1.6"}}>Los items marcados 🔗 son outputs de otros procesos del proyecto. Haz clic para saltar al proceso origen.</div>{(PR_IN[p.id]||[]).map((inp,i)=>renderInputItem(inp,i,(procRef)=>{const tgt=PR.find(x=>x.id===procRef);if(tgt){setSelDom(tgt.d);setOpenProc(procRef);setProcTab(2);}}))}</>)}
                    {procTab===1&&(<><div className="sl">Herramientas & Técnicas ({p.tt.length})</div>{p.tt.map(tk=>{const t=TT[tk];if(!t)return null;return(<div key={tk} className="tti"><div className="tti-n">🔧 {t.n}<span className="tti-t">{t.t}</span></div><div className="tti-h">{t.how}</div></div>);})}</>)}
                    {procTab===2&&(<><div className="sl">Outputs ({p.out.length})</div>{p.out.map((o,oi)=>(<div key={oi} className="out-item"><div className="out-n">📤 {o.n}{OUT_TPL[p.id+"_"+oi]&&<span className="out-tpl-badge">PMBOK 8</span>}</div><div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"7px",color:"#6B7E94",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"4px"}}>Campos del documento</div><div className="tpl-pills">{o.tpl.map((t,j)=><span key={j} className="pill">{t}</span>)}</div><div className="out-btns"><button className="out-tpl-btn" onClick={e=>{e.stopPropagation();openTplModal(p,o,oi);}}>📄 Ver Template</button></div>{noteEditor(p.id+"_"+oi)}</div>))}</>)}
                  </div>)}
                </div>);
              })}
            </div>
          </>
        )}
        <div className="footer">PMBOK® 8 · 40 Procesos · SPMS+ v2.0</div>
      </>)}

      {view==="tt"&&(<>
        <div className="sec-hdr"><div className="sec-ey">PMBOK® 8 · Biblioteca de Técnicas y Herramientas</div><div className="sec-ti">T&T ({TT_LIST.length})</div></div>
        <div className="lib-wrap">
          <input className="lsrc" placeholder="Buscar técnica o herramienta..." value={libQ} onChange={e=>setLibQ(e.target.value)}/>
          <div className="chips">{TT_TYPES.map(t=><button key={t} className={"chip"+(libT===t?" on":"")} onClick={()=>setLibT(t)}>{t}</button>)}</div>
          <div className="lcnt">{fTT.length} de {TT_LIST.length}</div>
          {fTT.map(t=>{const isO=openLib===t.k,tc={"Técnica":"T","Herramienta":"H","Análisis":"A","Estimación":"E"}[t.t]||"T";return(<div key={t.k} className={"lc"+(isO?" open":"")}>
            <div className="lc-h" onClick={()=>setOpenLib(isO?null:t.k)}><span className={"lc-t ltype-"+tc}>{t.t}</span><span className="lc-n">{t.n}</span><span className={"lc-ch"+(isO?" open":"")}>▼</span></div>
            {isO&&<div className="lc-how">{t.how}</div>}
          </div>);})}
        </div>
        <div className="footer">PMBOK® 8 · T&T · SPMS+ v2.0</div>
      </>)}

      {view==="plantillas"&&(<>
        <div className="sec-hdr"><div className="sec-ey">PMBOK® 8 · Plantillas Oficiales</div><div className="sec-ti">Biblioteca I/O{activeProj&&<span style={{fontFamily:"JetBrains Mono,monospace",fontSize:"9px",color:"#14B8A6",marginLeft:"8px",background:"#14B8A622",padding:"2px 6px",borderRadius:"3px"}}>📁 {activeProj.name}</span>}</div></div>
        {!activeId&&<div className="noproj"><div className="noproj-t">Sin proyecto activo</div><div className="noproj-d">Selecciona o crea un proyecto para ingresar datos.</div><button className="noproj-btn" onClick={()=>navTo("proyectos")}>Ir a Proyectos</button></div>}
        <div className="tw">
          <input className="tsrc" placeholder="Buscar plantilla..." value={tmplQ} onChange={e=>setTmplQ(e.target.value)}/>
          <div className="chips">{[["All","Todos"],["IN","Initiating"],["PL","Planning"],["EX","Executing"],["MC","Mon. & Ctrl"],["CL","Closing"]].map(([k,l])=><button key={k} className={"chip"+(tmplCat===k?" on":"")} onClick={()=>setTmplCat(k)}>{l}</button>)}</div>
          <div className="tcnt">{fTPL.length} de {TPL.length}</div>
          {fTPL.map(ti=>{
            const isO=openTmpl===ti.id,cc=CLC[ti.cat]||"#6B7E94",cl=CLL[ti.cat]||ti.cat,td=aT[ti.id]||{};
            return(<div key={ti.id} className={"tc"+(isO?" open":"")}>
              <div className="tc-h" onClick={()=>setOpenTmpl(isO?null:ti.id)}><span className="tc-cat" style={{background:cc+"22",color:cc,border:"1px solid "+cc+"44"}}>{cl}</span><span className="tc-n">{ti.n}</span><span className="tc-pr">{ti.pr.join(" · ")}</span><span className={"tc-ch"+(isO?" open":"")}>▼</span></div>
              {isO&&(()=>{let fi=-1;return(<div className="tc-body">
                <div className="tc-meta">
                  <div className="tc-mr"><span className="tc-ml">Propósito</span><span>{ti.pur}</span></div>
                  <div className="tc-mr"><span className="tc-ml">Cuándo</span><span>{ti.wh}</span></div>
                  <div className="tc-mr"><span className="tc-ml">Aprobador</span><span>{ti.ap}</span></div>
                </div>
                {ti.secs.map((sec,si)=>(<div key={si} className="tc-sec"><div className="tc-st">{sec.t}</div>{sec.f.map(field=>{fi++;const fk=fi;return(<div key={fk} className="tf"><div className="tf-h"><span className="tf-n">{field.n}</span><span className={"tf-tp "+(TP_CLS[field.tp]||"tft-t")}>{TP_LBL[field.tp]||field.tp}</span>{field.r===1&&<span className="tf-req">Obligatorio</span>}</div><div className="tf-pval">{(field.tp==="ta"||field.tp==="tbl")?(<textarea className="tf-ta" disabled={!activeId} placeholder={activeId?"Datos del proyecto...":"Selecciona un proyecto"} value={td[fk]||""} onChange={e=>activeId&&setTF(ti.id,fk,e.target.value)}/>):(<input className="tf-in" type={field.tp==="d"?"date":field.tp==="n"?"number":"text"} disabled={!activeId} placeholder={activeId?"Datos...":"Selecciona un proyecto"} value={td[fk]||""} onChange={e=>activeId&&setTF(ti.id,fk,e.target.value)}/>)}</div></div>);})}</div>))}
                {activeId&&<div className="tc-sr">{tmplSaved[ti.id]&&<span className="tc-sbd">✓ Guardado</span>}<button className="tc-clr" onClick={()=>setTmpl(t=>({...t,[activeId]:{...aT,[ti.id]:{}}}))}>🗑 Limpiar</button><button className="tc-sbtn" onClick={()=>saveTF(ti.id)}>💾 Guardar</button></div>}
              </div>);})()}
            </div>);
          })}
        </div>
        <div className="footer">PMBOK® 8 · Plantillas · SPMS+ v2.0</div>
      </>)}

      {view==="usuarios"&&(<>
        <div className="pm-hdr" style={{top:"42px"}}><div className="pm-ey">Gestión de Acceso · Solo Sponsor</div><div className="pm-ti">Usuarios ({users.length})</div></div>
        {!can(cu,"manageUsers")?(<div style={{margin:"30px 16px",background:"#E74C3C11",border:"1px solid #E74C3C33",borderRadius:"6px",padding:"20px",textAlign:"center"}}><div style={{fontFamily:"Syne,sans-serif",fontSize:"14px",fontWeight:700,color:"#E57373",marginBottom:"4px"}}>🔒 Acceso restringido</div><div style={{fontSize:"11px",color:"#8A9BAC"}}>Solo el Sponsor puede gestionar usuarios.</div></div>):(
          <div className="users-wrap">
            {showUForm&&(<div className="uform">
              <div className="uform-ti">{editUId?"✏️ Editar":"➕ Nuevo"} Usuario</div>
              {uFormErr&&<div className="login-err" style={{marginBottom:"8px"}}>{uFormErr}</div>}
              {[["Nombre completo","name","text"],["Usuario (login)","username","text"],["Contraseña"+(editUId?" (vacío=no cambiar)":""),"password","password"]].map(([l,k,tp])=>(
                <div key={k} style={{marginBottom:"8px"}}><div className="fl">{l}</div><input className="fi" type={tp} value={uForm[k]} onChange={e=>setUForm(f=>({...f,[k]:e.target.value}))}/></div>
              ))}
              <div className="fl">Rol</div>
              <div className="role-grid">{Object.entries(ROLES).map(([key,role])=>(<div key={key} className={"role-opt"+(uForm.role===key?" sel":"")} onClick={()=>setUForm(f=>({...f,role:key}))} style={uForm.role===key?{borderColor:role.color,background:role.color+"22"}:{}}><span className="role-opt-icon">{role.icon}</span><span className="role-opt-label">{role.label}</span><span className="role-opt-sub">{role.sub}</span></div>))}</div>
              <div style={{display:"flex",gap:"8px",marginTop:"12px"}}><button className="u-btn" onClick={()=>{setShowUForm(false);setEditUId(null);setUFormErr("");}}>Cancelar</button><button className="u-btn primary" onClick={saveUser}>{editUId?"Guardar":"Crear"}</button></div>
            </div>)}
            {!showUForm&&<button className="pm-new" onClick={()=>{setShowUForm(true);setEditUId(null);setUForm({name:"",username:"",password:"",role:"team"});}}>➕ Agregar usuario</button>}
            <div className="pm-sl">Usuarios</div>
            {users.map(u=>{const ur=ROLES[u.role]||ROLES.team;return(<div key={u.id} className="ucard">
              <div className="ucard-top"><div className="uavatar" style={{background:ur.color+"22",borderColor:ur.color}}>{ur.icon}</div><div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"2px"}}><div className="uname">{u.name}</div>{u.id===cu.id&&<span style={{fontSize:"8px",background:"#27AE60",color:"#FFF",padding:"1px 5px",borderRadius:"3px"}}>TÚ</span>}</div><div className="uuname">@{u.username}</div></div><span className="urole" style={{background:ur.color+"22",color:ur.color,border:"1px solid "+ur.color+"44"}}>{ur.icon} {ur.label}</span></div>
              {u.id!==cu.id&&<div className="uacts"><button className="u-btn" onClick={()=>{setEditUId(u.id);setUForm({name:u.name,username:u.username,password:"",role:u.role});setShowUForm(true);}}>✏️ Editar</button><button className="u-btn danger" onClick={()=>setDelUConf(u.id)}>🗑 Eliminar</button></div>}
            </div>);})}
          </div>
        )}
        <div className="footer">SPMS+ v2.0 · Gestión de Usuarios</div>
      </>)}

      {view==="mc"&&(<>
        <div className="sec-hdr"><div className="sec-ey">Monitoreo & Control · Baseline vs Real · PMBOK® 8</div><div className="sec-ti">📊 M&C{activeProj&&<span style={{fontFamily:"JetBrains Mono,monospace",fontSize:"9px",color:"#14B8A6",marginLeft:"8px",background:"#14B8A622",padding:"2px 6px",borderRadius:"3px"}}>📁 {activeProj.name}</span>}</div></div>
        <div className="mc-wrap">
          {!activeProj?(
            <div className="mc-noproj"><div className="mc-noproj-t">⚠ Sin proyecto activo</div><div className="mc-noproj-d">Selecciona un proyecto para monitorear baselines y desviaciones.</div><button className="noproj-btn" onClick={()=>navTo("proyectos")}>Ir a Proyectos</button></div>
          ):mcEdit?(
            <div className="mc-form">
              <div className="mc-form-sec">
                <div className="mc-form-st"><span className="mc-form-st-ic">📏</span>Baselines del proyecto</div>
                <div className="mc-form-hint">Valores de referencia aprobados (scope/schedule/cost baseline). Se definen una vez y cambian sólo vía CR aprobado.</div>
                <div className="mc-form-grid" style={{marginTop:"8px"}}>
                  {[["bl_bac","BAC — Presupuesto total ("+(activeProj.bac_currency||"USD")+")","number"],["bl_hh","H-H plan total","number"],["bl_days","Duración plan (días)","number"],["bl_scope_items","Total entregables / WPs","number"],["bl_risk_reserve","Reserva contingencia ("+(activeProj.bac_currency||"USD")+")","number"]].map(([k,l,tp])=>(
                    <div key={k} className="mc-form-field"><label className="mc-form-lbl">{l}</label><input className="mc-form-inp" type={tp} value={mcForm[k]||""} onChange={e=>setMcForm(f=>({...f,[k]:e.target.value}))}/></div>
                  ))}
                </div>
              </div>
              <div className="mc-form-sec">
                <div className="mc-form-st"><span className="mc-form-st-ic">📈</span>Datos reales del período</div>
                <div className="mc-form-hint">Valores actualizados del período de reporte (semanal / quincenal / mensual).</div>
                <div className="mc-form-grid" style={{marginTop:"8px"}}>
                  <div className="mc-form-field full"><label className="mc-form-lbl">Fecha de reporte (data date)</label><input className="mc-form-inp" type="date" value={mcForm.cur_date||""} onChange={e=>setMcForm(f=>({...f,cur_date:e.target.value}))}/></div>
                  {[["cur_pv","PV — Planned Value a la fecha","EVM"],["cur_ev","EV — Earned Value a la fecha","EVM"],["cur_ac","AC — Actual Cost a la fecha","EVM"],["cur_hh_real","H-H real consumidas","Recursos"],["cur_days_elapsed","Días transcurridos","Cronograma"],["cur_scope_complete","Entregables completados","Alcance"],["cur_ncr_total","NCR totales (período)","Calidad"],["cur_ncr_open","NCR abiertas","Calidad"],["cur_ncr_critical","NCR críticas abiertas","Calidad"],["cur_risk_emv","EMV total riesgos activos","Riesgo"],["cur_reserve_used","Reserva consumida","Riesgo"]].map(([k,l])=>(
                    <div key={k} className="mc-form-field"><label className="mc-form-lbl">{l}</label><input className="mc-form-inp" type="number" value={mcForm[k]||""} onChange={e=>setMcForm(f=>({...f,[k]:e.target.value}))}/></div>
                  ))}
                </div>
              </div>
              <div className="mc-form-ftr"><button className="mc-form-cancel" onClick={()=>setMcEdit(false)}>Cancelar</button><button className="mc-form-save" onClick={saveMcData}>💾 Guardar datos M&C</button></div>
            </div>
          ):(<>
            <div className="mc-actions-top">
              <button className="mc-edit-btn" onClick={startMcEdit}>{mcCompute?.hasBaseline?"✏️ Actualizar datos de M&C":"➕ Configurar baselines y datos actuales"}</button>
              {mcCompute?.reportDate&&<span className="mc-report-date">📅 {fmtDate(mcCompute.reportDate)}</span>}
            </div>

            {!mcCompute?.hasBaseline||!mcCompute?.hasCurrent?(
              <div className="mc-empty">
                <div className="mc-empty-ic">📊</div>
                <div className="mc-empty-t">{!mcCompute?.hasBaseline?"Sin baselines configuradas":"Sin datos reales registrados"}</div>
                <div className="mc-empty-d">{!mcCompute?.hasBaseline?"Configura primero las baselines (BAC, H-H plan, días, entregables, reserva).":"Registra datos reales (PV, EV, AC, H-H real, etc.) para calcular desviaciones."}</div>
              </div>
            ):(()=>{
              const ev=mcEvaluate;if(!ev)return null;
              const order=["cost","sched","scope","quality","res","risk"];
              const axisMeta={cost:{ic:"💰",n:"COSTO",fields:[["BAC",fmtNum(mcCompute.BAC)],["EV",fmtNum(mcCompute.EV)],["AC",fmtNum(mcCompute.AC)],["EAC",fmtNum(mcCompute.EAC)],["VAC",fmtNum(mcCompute.VAC)]]},sched:{ic:"📅",n:"CRONOGRAMA",fields:[["PV",fmtNum(mcCompute.PV)],["EV",fmtNum(mcCompute.EV)],["SV",fmtNum(mcCompute.SV)],["Días plan",mcCompute.daysPlan||"—"],["Proyec.",mcCompute.daysForecast?mcCompute.daysForecast.toFixed(0)+" d":"—"]]},scope:{ic:"🎯",n:"ALCANCE",fields:[["Plan %",mcCompute.scopePlanPct.toFixed(1)+"%"],["Real %",mcCompute.scopePct.toFixed(1)+"%"],["Gap",(mcCompute.scopeGap>=0?"+":"")+mcCompute.scopeGap.toFixed(1)+"%"],["Entreg.",mcCompute.scopeDone+"/"+mcCompute.scopeItems]]},quality:{ic:"✅",n:"CALIDAD",fields:[["NCR total",mcCompute.ncrTotal],["NCR abiert.",mcCompute.ncrOpen],["NCR crít.",mcCompute.ncrCrit],["Conform.",mcCompute.qualityRate.toFixed(1)+"%"]]},res:{ic:"👥",n:"RECURSOS",fields:[["H-H plan",fmtNum(mcCompute.hhPlan)],["H-H real",fmtNum(mcCompute.hhReal)],["Var %",(mcCompute.hhVarPct>=0?"+":"")+mcCompute.hhVarPct.toFixed(1)+"%"]]},risk:{ic:"⚠",n:"RIESGO",fields:[["Reserva",fmtNum(mcCompute.riskReserve)],["Consumida",fmtNum(mcCompute.rUsed)],["EMV activ.",fmtNum(mcCompute.riskEMV)],["Cobert.",mcCompute.reserveCov>100?"∞":mcCompute.reserveCov.toFixed(2)+"×"]]}};
              const active=order.filter(k=>ev[k]&&ev[k].status!=="na"&&ev[k].status!=="green");
              const worst=order.reduce((acc,k)=>{const s=ev[k]?.status;const rank={red:4,orange:3,yellow:2,green:1,na:0};return (rank[s]||0)>(rank[acc]||0)?s:acc;},"na");
              const bannerMap={red:{t:"🚨 ACCIÓN INMEDIATA REQUERIDA",d:"Existen desviaciones críticas que requieren escalación al Sponsor y posible CCB. El proyecto está fuera de control en una o más dimensiones."},orange:{t:"⚠ ACCIÓN CORRECTIVA REQUERIDA",d:"Desviaciones significativas detectadas. El PM debe aplicar acciones correctivas documentadas y evaluar cambios al baseline."},yellow:{t:"🟡 MONITOREO CERCANO",d:"Alertas tempranas activas. Revisar causas raíz y reforzar controles preventivos."},green:{t:"🟢 PROYECTO EN CONTROL",d:"Todas las dimensiones monitoreadas dentro de umbrales PMBOK®. Continuar con control rutinario."},na:{t:"📊 Datos parciales",d:"Algunos ejes no tienen datos suficientes para evaluación."}};
              const b=bannerMap[worst];
              return(<>
                <div className={"mc-banner mc-banner-"+worst}>
                  <span className="mc-banner-ic">{worst==="red"?"🚨":worst==="orange"?"⚠":worst==="yellow"?"🟡":worst==="green"?"✅":"📊"}</span>
                  <div className="mc-banner-body"><div className="mc-banner-t">{b.t}</div><div className="mc-banner-d">{b.d}</div></div>
                </div>

                <div className="mc-evm-bar">
                  <div className="mc-evm-cell"><div className="mc-evm-lbl">CPI</div><div className="mc-evm-val" style={{color:mcCompute.CPI>=0.95?"#6FCF97":mcCompute.CPI>=0.90?"#F5CBA7":mcCompute.CPI>=0.80?"#F0A070":"#E57373"}}>{mcCompute.CPI?mcCompute.CPI.toFixed(3):"—"}</div><div className="mc-evm-sub">EV/AC</div></div>
                  <div className="mc-evm-cell"><div className="mc-evm-lbl">SPI</div><div className="mc-evm-val" style={{color:mcCompute.SPI>=0.95?"#6FCF97":mcCompute.SPI>=0.90?"#F5CBA7":mcCompute.SPI>=0.85?"#F0A070":"#E57373"}}>{mcCompute.SPI?mcCompute.SPI.toFixed(3):"—"}</div><div className="mc-evm-sub">EV/PV</div></div>
                  <div className="mc-evm-cell"><div className="mc-evm-lbl">TCPI</div><div className="mc-evm-val">{mcCompute.TCPI?mcCompute.TCPI.toFixed(3):"—"}</div><div className="mc-evm-sub">Eficiencia req.</div></div>
                </div>

                {active.length>0&&(
                  <div className="mc-alerts-panel">
                    <div className="mc-alerts-hdr"><span style={{fontSize:"14px"}}>🔔</span><span className="mc-alerts-t">Alertas activas · Acciones del Gerente</span><span className="mc-alerts-count">{active.length}</span></div>
                    {active.map(k=>{const e=ev[k];const m=axisMeta[k];const ics={red:"🔴",orange:"🟠",yellow:"🟡",green:"🟢",na:"⚪"};return(<div key={k} className="mc-alert-item"><span className="mc-alert-ic">{ics[e.status]}</span><div className="mc-alert-body"><div className="mc-alert-ax">{m.ic} {m.n} · {e.label}</div><div style={{marginBottom:"3px"}}>{e.msg}</div><div style={{fontSize:"10px",color:"#5EEAD4",fontStyle:"italic"}}>→ {e.action}</div></div></div>);})}
                  </div>
                )}

                <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"8px",color:"#14B8A6",letterSpacing:"2px",textTransform:"uppercase",margin:"14px 0 6px"}}>Triángulo de restricción extendido — dashboard</div>
                <div className="mc-grid">
                  {order.map(k=>{
                    const e=ev[k];const m=axisMeta[k];if(!e)return null;
                    const stClass="mc-"+e.status;const badgeClass="mc-st-"+e.status;
                    return(
                      <div key={k} className={"mc-card "+stClass}>
                        <div className="mc-card-hdr">
                          <span className="mc-card-ic">{m.ic}</span>
                          <span className="mc-card-ti">{m.n}</span>
                          <span className={"mc-card-status "+badgeClass}>{e.label}</span>
                        </div>
                        {e.status!=="na"&&(
                          <div className="mc-card-metrics">
                            <div className="mc-mm"><div className="mc-mm-lbl">Métrica</div><div className="mc-mm-val hl">{e.metric}</div></div>
                            {m.fields.map(([l,v],i)=><div key={i} className="mc-mm"><div className="mc-mm-lbl">{l}</div><div className="mc-mm-val">{v}</div></div>)}
                          </div>
                        )}
                        <div className="mc-card-msg">{e.msg}</div>
                        <div className="mc-card-action"><strong>Acción del gerente</strong>{e.action}</div>
                      </div>
                    );
                  })}
                </div>
              </>);
            })()}
          </>)}
        </div>
        <div className="footer">📊 M&C · Baseline vs Real · Umbrales PMBOK® 8 · SPMS+ v2.0</div>
      </>)}

      {view==="coorp"&&(
        <div className="coorp-root">
          <div className="coorp-subnav">
            {[["identity","🏛 Identidad"],["pillars","⚡ Tres Pilares"],["system","⚙ Sistema"],["problems","✓ Problemas"],["clients","💼 Clientes"],["results","📊 Resultados"],["values","★ Valores"],["messages","💬 Mensajes"],["standards","🎯 Estándares"]].map(([k,l])=>(
              <button key={k} className={"coorp-snb"+(coorpSec===k?" on":"")} onClick={()=>setCoorpSec(k)}>{l}</button>
            ))}
          </div>

          <div className="coorp-hero">
            <div className="coorp-hero-eyebrow">Manual de Divulgación Interno</div>
            <div className="coorp-logo"><span className="s1">SYST</span><span className="s2">EN</span><span className="s3">GER</span></div>
            <div className="coorp-tagline">no es un nombre. es un compromiso.</div>
            <div className="coorp-tagline-es">Industrializamos tu obra: más rápido, mejor y sin sorpresas.</div>
            <div className="coorp-hero-quote">
              <div className="coorp-hero-quote-en">Three words. One commitment. Every day, on every project.</div>
              <div className="coorp-hero-quote-es">Tres palabras. Un compromiso. Cada día, en cada proyecto.</div>
            </div>
          </div>

          {coorpSec==="identity"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 01 · Identidad Corporativa</div>
              <div className="coorp-sec-ti">Misión y Visión</div>
              <div className="coorp-sec-sub">Nuestra misión es el método. Nuestra visión es el resultado que el método produce.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-mv">
                <div className="coorp-mv-box">
                  <div className="coorp-mv-lbl">Misión</div>
                  <div className="coorp-mv-main">Impulsar la transformación del sector construcción en Panamá y la región mediante soluciones industrializadas off-site que integran ingeniería eficiente, manufactura avanzada y sistemas constructivos de alto desempeño.</div>
                  <div className="coorp-mv-sub">Optimizar costos y tiempos, anticipar y controlar riesgos, y superar barreras logísticas, generando impacto económico y social con alcance escalable y sostenible.</div>
                  <div className="coorp-mv-tag">SYST · EN · GER</div>
                </div>
                <div className="coorp-mv-box">
                  <div className="coorp-mv-lbl">Visión</div>
                  <div className="coorp-mv-main">Ser líderes en la integración técnica de proyectos de construcción industrializada en Panamá y la región, ofreciendo soluciones innovadoras y eficientes que garanticen calidad, precisión en la ejecución y generación de valor tangible.</div>
                  <div className="coorp-mv-sub">Para nuestros clientes, nuestro equipo y el desarrollo sostenible de la región.</div>
                </div>
              </div>
              <div className="coorp-cards-grid">
                <div className="coorp-card"><div className="coorp-card-ti">SYST — Lo que hacemos posible</div><div className="coorp-card-d">Sistemas constructivos que se replican. Procesos que no dependen de héroes individuales. La escala es consecuencia del orden.</div></div>
                <div className="coorp-card"><div className="coorp-card-ti">EN — Cómo lo diferenciamos</div><div className="coorp-card-d">Ingeniería de detalle que resuelve antes de fabricar. Normas internacionales aplicadas sin excepción. La calidad no se inspecciona — se diseña.</div></div>
                <div className="coorp-card"><div className="coorp-card-ti">GER — Qué le prometemos al mundo</div><div className="coorp-card-d">Generación de valor tangible, sostenible y medible. Para el cliente, para el equipo, para la región.</div></div>
              </div>
            </div>
          </>)}

          {coorpSec==="pillars"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 02 · Los Tres Pilares</div>
              <div className="coorp-sec-ti">SYST · EN · GER</div>
              <div className="coorp-sec-sub">El nombre como manifiesto — cada sílaba es una promesa operativa.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-pillars">
                {[
                  {c:"SYST",en:"System",n:"Sistema de Trabajo",d:"No improvisamos. Cada proceso, protocolo y secuencia está definido para producir el mismo resultado — siempre. El sistema es la garantía de que el trabajo de todos produce el resultado esperado, independientemente de quién ejecute, en qué frente o bajo qué condiciones.",cl:"«No improvisamos. Tenemos sistema.»"},
                  {c:"EN",en:"Engineered",n:"Ingeniería Puntera al Detalle",d:"No estimamos — calculamos. Antes de que el primer electrodo toque el acero, ya existe un cálculo, una tolerancia y un protocolo verificado. Ingeniería puntera porque usa los estándares más exigentes del mundo. Al detalle porque ninguna decisión técnica se deja al azar.",cl:"«No estimamos. Calculamos.»"},
                  {c:"GER",en:"Manager",n:"Gerenciamiento con las Mejores Prácticas",d:"No esperamos que nos dirijan — conducimos. Plazos, riesgos, costos y comunicación bajo control activo. Las mejores prácticas no son un certificado en la pared: son la forma en que tomamos cada decisión de obra.",cl:"«No esperamos. Conducimos.»"},
                ].map(p=>(
                  <div key={p.c} className="coorp-pillar">
                    <div className="coorp-pillar-hdr"><span className="coorp-pillar-code">{p.c}</span><span className="coorp-pillar-arrow">←</span><span className="coorp-pillar-en">{p.en}</span></div>
                    <div className="coorp-pillar-name">{p.n}</div>
                    <div className="coorp-pillar-desc">{p.d}</div>
                    <div className="coorp-pillar-claim">{p.cl}</div>
                  </div>
                ))}
              </div>
            </div>
          </>)}

          {coorpSec==="system"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 03 · Sistema de Trabajo</div>
              <div className="coorp-sec-ti">Cómo nos organizamos</div>
              <div className="coorp-sec-sub">Un sistema no es un manual en un cajón — es la disciplina colectiva de hacer las cosas bien, siempre.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-mv-box" style={{marginBottom:"12px"}}>
                <div className="coorp-mv-lbl">Promesa del sistema</div>
                <div className="coorp-mv-main">El sistema es nuestra promesa de que el resultado será el mismo independientemente de quién ejecute.</div>
                <div className="coorp-mv-sub">Protocolos documentados · Flujo 6WLA para gestión de restricciones · Daily Scrum + reportes semanales · Trazabilidad total.</div>
              </div>
              <div className="coorp-cards-grid">
                {[
                  ["Rol claro para cada persona","En SYSTENGER cada persona sabe exactamente qué es suyo. Sin ambigüedades, sin duplicaciones, sin vacíos."],
                  ["Proceso antes que persona","El resultado no depende del individuo — depende del protocolo. Formamos personas para ejecutar sistemas probados."],
                  ["Detección temprana de restricciones","Usamos el método 6WLA: identificamos el problema antes de que se convierta en bloqueo. Daily Scrum, análisis sistemático."],
                  ["Fabricación paralela a obra","No esperamos frentes liberados. Producimos en planta mientras la obra avanza. El sistema elimina la dependencia secuencial."],
                  ["Un único responsable por entregable","Sin conflictos entre contratistas. SYSTENGER integra y asume responsabilidad total sobre lo que firma."],
                  ["Aprendizaje documentado","Cada restricción resuelta queda registrada. El sistema aprende. Lo que ocurrió una vez no vuelve a ocurrir sin protocolo."],
                ].map(([ti,d])=>(
                  <div key={ti} className="coorp-card"><div className="coorp-card-ti">{ti}</div><div className="coorp-card-d">{d}</div></div>
                ))}
              </div>
            </div>
          </>)}

          {coorpSec==="problems"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 04 · Los 9 Problemas que Resolvemos</div>
              <div className="coorp-sec-ti">Construcción sin improvisación</div>
              <div className="coorp-sec-sub">No reaccionamos a los problemas — diseñamos sistemas que los previenen.</div>
            </div>
            <div className="coorp-body">
              {[
                ["Diseños no finalizados al inicio","Fast-track real: producimos con soluciones estandarizadas desde el día 1.","SYST"],
                ["Interfaces mal gestionadas entre disciplinas","Interfaces resueltas en fábrica: cero choques en obra.","EN"],
                ["Frentes de trabajo bloqueados","Fabricamos en planta mientras la obra avanza. Sin dependencia secuencial.","SYST"],
                ["Interrupciones por lluvia y clima","Producción en ambiente controlado: el clima no detiene nuestro trabajo.","SYST"],
                ["Conflictos sindicales e incertidumbre","Fabricación fuera de centros urbanos: menor exposición, mayor predictibilidad.","GER"],
                ["Escasez de mano de obra especializada","Montaje simplificado: menos personal requerido, mayor precisión garantizada.","EN"],
                ["Falta de calidad, retrabajos costosos","Calidad certificada en origen: cada componente verificado antes de salir del taller.","EN"],
                ["Altos costos indirectos en obra paralizada","Menos tiempo en obra = menos indirectos. Estructura de costos radicalmente diferente.","GER"],
                ["Obra convertida en 'área de urgencias'","Cronograma garantizado · Costo predecible · Sin sorpresas.","GER"],
              ].map(([prob,sol,pillar],i)=>(
                <div key={i} className="coorp-ps">
                  <div className="coorp-ps-prob"><span className="coorp-ps-icon">⚠</span><span className="coorp-ps-prob-t">{prob}</span><span className="coorp-ps-pillar">{pillar}</span></div>
                  <div className="coorp-ps-sol"><span className="coorp-ps-icon2">→</span><span className="coorp-ps-sol-t">{sol}</span></div>
                </div>
              ))}
            </div>
          </>)}

          {coorpSec==="clients"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 05 · Relación con Clientes</div>
              <div className="coorp-sec-ti">Por qué nos contratan</div>
              <div className="coorp-sec-sub">No vendemos componentes — vendemos certeza, confianza y el orgullo de entregar impecable.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-mv-box" style={{marginBottom:"12px"}}>
                <div className="coorp-mv-main" style={{fontSize:"13px"}}>Nuestros clientes no nos contratan para construir acero.</div>
                <div className="coorp-mv-main" style={{color:"#14B8A6",fontSize:"14px"}}>Nos contratan para eliminar incertidumbre.</div>
              </div>
              {[
                {t:"Trabajo Funcional",p:"SYST",needs:["Terminar la obra a tiempo y dentro del presupuesto","Minimizar riesgos de integración entre disciplinas","Reducir exposición a clima y mano de obra"],sol:"Lo resolvemos con SYST: sistema, protocolo, predictibilidad. El Fast-track real no es marketing — es nuestro método de trabajo."},
                {t:"Trabajo Emocional",p:"EN",needs:["Tranquilidad y confianza durante el proceso","Evitar sorpresas — en costo, plazo o calidad","Orgullo de entregar algo impecable"],sol:"Lo resolvemos con EN: la ciencia documenta, los estándares certifican y la trazabilidad garantiza que lo que se entrega es lo que se prometió."},
                {t:"Trabajo Social",p:"GER",needs:["Ser visto como innovador en su mercado","Demostrar sostenibilidad y modernidad","Diferenciarse de la competencia"],sol:"Lo resolvemos con GER: gestión visible, reporting profesional y un socio que eleva el estándar del proyecto frente a sus propios clientes."},
              ].map(j=>(
                <div key={j.t} className="coorp-job">
                  <div className="coorp-job-hdr"><span className="coorp-job-ti">{j.t}</span><span className="coorp-job-pillar">{j.p}</span></div>
                  <div className="coorp-job-body">
                    <div className="coorp-job-lbl">El cliente necesita</div>
                    <ul className="coorp-job-list">{j.needs.map((n,i)=><li key={i} className="coorp-job-item">{n}</li>)}</ul>
                    <div className="coorp-job-lbl">Cómo lo resolvemos</div>
                    <div className="coorp-job-sol">{j.sol}</div>
                  </div>
                </div>
              ))}
            </div>
          </>)}

          {coorpSec==="results"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 06 · Resultados Documentados</div>
              <div className="coorp-sec-ti">El método en números</div>
              <div className="coorp-sec-sub">Los números hablan por el método. El método habla por el equipo.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-mv-box" style={{marginBottom:"12px"}}>
                <div className="coorp-mv-sub" style={{color:"#5EEAD4",fontStyle:"normal",fontWeight:"600"}}>Estos no son promesas — son resultados documentados en proyectos reales.</div>
              </div>
              <div className="coorp-metrics">
                <div className="coorp-metric"><div className="coorp-metric-val">-26%</div><div className="coorp-metric-lbl-en">Reduction in field erection time</div><div className="coorp-metric-lbl-es">Reducción de tiempo de montaje en campo</div><span className="coorp-metric-pillar">GER</span></div>
                <div className="coorp-metric"><div className="coorp-metric-val">0</div><div className="coorp-metric-lbl-en">Rework due to interface clashes</div><div className="coorp-metric-lbl-es">Retrabajos por incompatibilidades de interfaz</div><span className="coorp-metric-pillar">EN</span></div>
                <div className="coorp-metric"><div className="coorp-metric-val">100%</div><div className="coorp-metric-lbl-en">Piece-by-piece traceability</div><div className="coorp-metric-lbl-es">Trazabilidad pieza por pieza</div><span className="coorp-metric-pillar">SYST</span></div>
              </div>
              <div className="coorp-metrics-footnote">Resultados documentados en proyecto de nave industrial — 3.200 m² de cubierta y fachada · Panamá 2024</div>
            </div>
          </>)}

          {coorpSec==="values"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 07 · Valores Organizados por Pilar</div>
              <div className="coorp-sec-ti">Cultura en acción</div>
              <div className="coorp-sec-sub">Los valores son comportamientos, no carteles. Viven en la forma en que trabajamos cada día.</div>
            </div>
            <div className="coorp-body">
              {[
                {code:"SYST",name:"Sistema de Trabajo",vals:[["Compromiso Inquebrantable","Lo que firmamos, lo cumplimos. Sin excusas, sin transferir responsabilidad."],["Agilidad y Adaptabilidad","Ajustamos el sistema ante la realidad — sin improvisar, con método."],["Integración y Colaboración","Un equipo que se coordina como sistema. Las interfaces se resuelven, no se evitan."]]},
                {code:"EN",name:"Ingeniería Puntera",vals:[["Alta Performance","El estándar mínimo aceptable es la excelencia técnica. No hay 'suficientemente bueno'."],["Entrega de Valor Excepcional","Cada componente que sale del taller supera la especificación. Eso es lo que firmamos."],["Cero Desperdicio y Compromiso Ambiental","Lean Construction no es filosofía — es nuestro proceso de producción."]]},
                {code:"GER",name:"Gerenciamiento",vals:[["Confianza Total","El cliente sabe exactamente en qué punto está su proyecto. Transparencia sin filtros."],["Generación de Valor Sostenible","El valor que generamos hoy debe sostener al cliente por los próximos 15 años."],["Visión de Futuro","Construimos con los estándares de mañana. No con los mínimos de hoy."]]},
              ].map(g=>(
                <div key={g.code} className="coorp-vals-group">
                  <div className="coorp-vals-hdr"><span className="coorp-vals-code">{g.code}</span><span className="coorp-vals-name">{g.name}</span></div>
                  {g.vals.map(([t,d])=>(<div key={t} className="coorp-val"><div className="coorp-val-ti">★ {t}</div><div className="coorp-val-d">{d}</div></div>))}
                </div>
              ))}
            </div>
          </>)}

          {coorpSec==="messages"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 08 · Mensajes Institucionales</div>
              <div className="coorp-sec-ti">Filosofía de trabajo</div>
              <div className="coorp-sec-sub">Frases-manifiesto que definen cómo pensamos y cómo actuamos.</div>
            </div>
            <div className="coorp-body">
              <div className="coorp-msg-list">
                {[
                  ["The system is our promise that the result will be the same regardless of who executes, on which front, under what conditions.","El sistema es nuestra promesa de que el resultado será el mismo independientemente de quién ejecute."],
                  ["A system is not a manual in a drawer — it is the collective discipline to always do things the right way.","Un sistema no es un manual en un cajón — es la disciplina colectiva de hacer las cosas bien, siempre."],
                  ["We don't react to problems — we design systems that prevent them.","No reaccionamos a los problemas — diseñamos sistemas que los previenen."],
                  ["Our clients don't hire us to build steel. They hire us to eliminate uncertainty.","Nuestros clientes no nos contratan para construir acero. Nos contratan para eliminar incertidumbre."],
                  ["We don't sell components — we sell certainty, trust and the pride of delivering impeccably.","No vendemos componentes — vendemos certeza, confianza y el orgullo de entregar impecable."],
                  ["The numbers speak for the method. The method speaks for the team.","Los números hablan por el método. El método habla por el equipo."],
                  ["Our mission is the method. Our vision is the result the method produces.","Nuestra misión es el método. Nuestra visión es el resultado que el método produce."],
                  ["Values are behaviors, not posters. They live in the way we work every day.","Los valores son comportamientos, no carteles. Viven en la forma en que trabajamos cada día."],
                  ["We industrialize your project: faster, better and with no surprises.","Industrializamos tu obra: más rápido, mejor y sin sorpresas."],
                ].map(([en,es],i)=>(
                  <div key={i} className="coorp-msg"><div className="coorp-msg-en">“{en}”</div><div className="coorp-msg-es">{es}</div></div>
                ))}
              </div>
            </div>
          </>)}

          {coorpSec==="standards"&&(<>
            <div className="coorp-sec-hdr">
              <div className="coorp-sec-num">Sección 09 · Capacidades Diferenciales</div>
              <div className="coorp-sec-ti">Estándares y metodología</div>
              <div className="coorp-sec-sub">Los estándares más exigentes del mundo aplicados sin excepción.</div>
            </div>
            <div className="coorp-body">
              <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"9px",color:"#14B8A6",letterSpacing:"2px",textTransform:"uppercase",marginBottom:"8px"}}>Normas técnicas</div>
              <div className="coorp-caps">
                {[
                  ["📐","AISC","American Institute of Steel Construction — diseño y fabricación de estructuras metálicas."],
                  ["🔥","AWS D1.1","Structural Welding Code — Steel. Código aplicado en cada junta soldada."],
                  ["🛡","ISO 12944","Protección contra la corrosión por sistemas de pintura. Durabilidad certificada."],
                  ["🔗","ISO 19650","Gestión de información BIM durante todo el ciclo de vida del proyecto."],
                  ["✅","ISO 9606","Calificación de soldadores. Cada soldador verificado antes de operar."],
                ].map(([ic,t,d])=>(
                  <div key={t} className="coorp-cap"><span className="coorp-cap-icon">{ic}</span><div className="coorp-cap-body"><div className="coorp-cap-ti">{t}</div><div className="coorp-cap-d">{d}</div></div></div>
                ))}
              </div>
              <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:"9px",color:"#14B8A6",letterSpacing:"2px",textTransform:"uppercase",marginTop:"16px",marginBottom:"8px"}}>Metodología</div>
              <div className="coorp-caps">
                {[
                  ["⚙","Lean Construction","Cero desperdicio como filosofía operativa. Optimización continua del flujo de valor."],
                  ["📊","PMBOK® 8","Gerenciamiento de proyectos bajo el estándar global del PMI. Integración con Scrumban."],
                  ["🏗","BIM 5D","Modelado 5D: geometría + tiempo + costo. Control integrado del proyecto completo."],
                  ["🔄","6WLA","Metodología propia de detección temprana y gestión de restricciones."],
                  ["📋","Daily Scrum","Reuniones diarias y reportes semanales. Transparencia operativa total."],
                ].map(([ic,t,d])=>(
                  <div key={t} className="coorp-cap"><span className="coorp-cap-icon">{ic}</span><div className="coorp-cap-body"><div className="coorp-cap-ti">{t}</div><div className="coorp-cap-d">{d}</div></div></div>
                ))}
              </div>
            </div>
          </>)}

          <div className="coorp-closing">
            <div className="coorp-closing-logo"><span style={{color:"#14B8A6"}}>SYST</span><span style={{color:"#5EEAD4"}}>EN</span><span style={{color:"#FFF"}}>GER</span></div>
            <div className="coorp-closing-main">We industrialize your project: <em>faster, better</em> and with no surprises.</div>
            <div className="coorp-closing-sub">Industrializamos tu obra: más rápido, mejor y sin sorpresas.</div>
            <div className="coorp-closing-pillars">
              <div className="coorp-closing-p"><div className="coorp-closing-pc">SYST</div><div className="coorp-closing-pn">We don't improvise.<br/>We have a system.</div></div>
              <div className="coorp-closing-p"><div className="coorp-closing-pc">EN</div><div className="coorp-closing-pn">We don't estimate.<br/>We calculate.</div></div>
              <div className="coorp-closing-p"><div className="coorp-closing-pc">GER</div><div className="coorp-closing-pn">We don't wait<br/>for direction. We lead.</div></div>
            </div>
            <div className="coorp-regions">Panamá · América Central · El Caribe</div>
            <div className="coorp-standards">AISC · AWS D1.1 · ISO 12944 · ISO 19650 · ISO 9606 · Lean Construction · PMBOK · BIM 5D</div>
          </div>
          <div className="coorp-footer-mark">🏛 COORP · MANUAL INSTITUCIONAL · SYSTENGER S.A. · SPMS+ v2.0</div>
        </div>
      )}
    </div>
  );
}