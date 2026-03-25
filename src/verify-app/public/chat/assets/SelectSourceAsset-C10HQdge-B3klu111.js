import{dI as v,d4 as e,eY as h,de as f,dx as n}from"./index-CxgUv6vE.js";import{n as j}from"./ScreenLayout-D1p_ntex-DQNeglxC.js";import{c as k}from"./createLucideIcon-IQGcnTjC.js";const C=[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]],A=k("chevron-down",C),S=async({operation:r,until:a,delay:o,interval:s,attempts:l,signal:p})=>{let c,i=0;for(;i<l;){if(p?.aborted)return{status:"aborted",result:c,attempts:i};i++;try{if(c=await r(),a(c))return{status:"success",result:c,attempts:i};i<l&&await v(s)}catch{i<l&&await v(s)}}return{status:"max_attempts",result:c,attempts:i}},z=r=>{try{return r.location.origin}catch{return}},N=async(r,a)=>{let o=await S({operation:async()=>({done:z(r)===window.location.origin,closed:r.closed}),until:({done:s,closed:l})=>s||l,delay:0,interval:500,attempts:360,signal:a});return o.status==="aborted"?(r.close(),{status:"aborted"}):o.status==="max_attempts"?{status:"timeout"}:o.result.done?(r.close(),{status:"redirected"}):{status:"closed"}},T=({currency:r="usd",value:a,onChange:o,inputMode:s="decimal",autoFocus:l})=>{let[p,c]=f.useState("0"),i=f.useRef(null),m=a??p,g=h[r]?.symbol??"$",w=f.useCallback((d=>{let t=d.target.value,u=(t=t.replace(/[^\d.]/g,"")).split(".");u.length>2&&(t=u[0]+"."+u.slice(1).join("")),u.length===2&&u[1].length>2&&(t=`${u[0]}.${u[1].slice(0,2)}`),t.length>1&&t[0]==="0"&&t[1]!=="."&&(t=t.slice(1)),(t===""||t===".")&&(t="0"),o?o(t):c(t)}),[o]),b=f.useCallback((d=>{!(["Delete","Backspace","Tab","Escape","Enter",".","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(d.key)||(d.ctrlKey||d.metaKey)&&["a","c","v","x"].includes(d.key.toLowerCase()))&&(d.key>="0"&&d.key<="9"||d.preventDefault())}),[]),y=f.useMemo((()=>(m.includes("."),m)),[m]);return e.jsxs(L,{onClick:()=>i.current?.focus(),children:[e.jsx(x,{children:g}),y,e.jsx("input",{ref:i,type:"text",inputMode:s,value:y,onChange:w,onKeyDown:b,autoFocus:l,placeholder:"0",style:{width:1,height:"1rem",opacity:0,alignSelf:"center",fontSize:"1rem"}}),e.jsx(x,{style:{opacity:0},children:g})]})},Z=({selectedAsset:r,onEditSourceAsset:a})=>{let{icon:o}=h[r];return e.jsxs(D,{onClick:a,children:[e.jsx(E,{children:o}),e.jsx(_,{children:r.toLocaleUpperCase()}),e.jsx(B,{children:e.jsx(A,{})})]})};let L=n.span`
  background-color: var(--privy-color-background);
  width: 100%;
  text-align: center;
  border: none;
  font-kerning: none;
  font-feature-settings: 'calt' off;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  cursor: pointer;

  &:focus {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
  }

  && {
    color: var(--privy-color-foreground);
    font-size: 3.75rem;
    font-style: normal;
    font-weight: 600;
    line-height: 5.375rem;
  }
`,x=n.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 1rem;
  font-style: normal;
  font-weight: 600;
  line-height: 1.5rem;
  margin-top: 0.75rem;
`,D=n.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: auto;
  gap: 0.5rem;
  border: 1px solid var(--privy-color-border-default);
  border-radius: var(--privy-border-radius-full);

  && {
    margin: auto;
    padding: 0.5rem 1rem;
  }
`,E=n.div`
  svg {
    width: 1rem;
    height: 1rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
  }
`,_=n.span`
  color: var(--privy-color-foreground);
  font-kerning: none;
  font-feature-settings: 'calt' off;
  font-size: 0.875rem;
  font-style: normal;
  font-weight: 500;
  line-height: 1.375rem;
`,B=n.div`
  color: var(--privy-color-foreground);

  svg {
    width: 1.25rem;
    height: 1.25rem;
  }
`;const G=({opts:r,isLoading:a,onSelectSource:o})=>e.jsx(j,{showClose:!1,showBack:!0,onBack:()=>o(r.source.selectedAsset),title:"Select currency",children:e.jsx(K,{children:r.source.assets.map((s=>{let{icon:l,name:p}=h[s];return e.jsx(M,{onClick:()=>o(s),disabled:a,children:e.jsxs(R,{children:[e.jsx(U,{children:l}),e.jsxs(F,{children:[e.jsx(I,{children:p}),e.jsx(Y,{children:s.toLocaleUpperCase()})]})]})},s)}))})});let K=n.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
`,M=n.button`
  border-color: var(--privy-color-border-default);
  border-width: 1px;
  border-radius: var(--privy-border-radius-mdlg);
  border-style: solid;
  display: flex;

  && {
    padding: 0.75rem 1rem;
  }
`,R=n.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
`,U=n.div`
  svg {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--privy-border-radius-full);
    overflow: hidden;
  }
`,F=n.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
`,I=n.span`
  color: var(--privy-color-foreground);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
`,Y=n.span`
  color: var(--privy-color-foreground-3);
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.125rem;
`;export{T as f,Z as h,G as k,N as p,S as u};
