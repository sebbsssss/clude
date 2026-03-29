import{r as c,j as e,bJ as r}from"./vendor-privy-D-qEdLrY.js";import{$ as p}from"./ModalHeader-BnVmXtvG-nKy1GoVW.js";import{e as f}from"./ErrorMessage-D8VaAP5m-Dq4QnDxM.js";import{r as x}from"./LabelXs-oqZNqbm_-1ggFM4vF.js";import{p as h}from"./Address-N-mzBgMy-BR7tjwfj.js";import{d as j}from"./shared-FM0rljBt-CcVPmDjr.js";import{C as g}from"./check-DOQ5lhR0.js";import{C as u}from"./copy-BBBdqpkp.js";let v=r(j)`
  && {
    padding: 0.75rem;
    height: 56px;
  }
`,y=r.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`,C=r.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`,b=r.div`
  font-size: 12px;
  line-height: 1rem;
  color: var(--privy-color-foreground-3);
`,z=r(x)`
  text-align: left;
  margin-bottom: 0.5rem;
`,w=r(f)`
  margin-top: 0.25rem;
`,E=r(p)`
  && {
    gap: 0.375rem;
    font-size: 14px;
  }
`;const P=({errMsg:t,balance:s,address:a,className:m,title:n,showCopyButton:d=!1})=>{let[o,l]=c.useState(!1);return c.useEffect((()=>{if(o){let i=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(i)}}),[o]),e.jsxs("div",{children:[n&&e.jsx(z,{children:n}),e.jsx(v,{className:m,$state:t?"error":void 0,children:e.jsxs(y,{children:[e.jsxs(C,{children:[e.jsx(h,{address:a,showCopyIcon:!1}),s!==void 0&&e.jsx(b,{children:s})]}),d&&e.jsx(E,{onClick:function(i){i.stopPropagation(),navigator.clipboard.writeText(a).then((()=>l(!0))).catch(console.error)},size:"sm",children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(g,{size:14})]}:{children:["Copy",e.jsx(u,{size:14})]})})]})}),t&&e.jsx(w,{children:t})]})};export{P as j};
