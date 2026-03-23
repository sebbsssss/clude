import{d9 as d,d6 as e,ds as r}from"./index-DYJlS9iH.js";import{$ as p}from"./ModalHeader-BnVmXtvG-BhMbJOlz.js";import{e as f}from"./ErrorMessage-D8VaAP5m-CMaPIfBg.js";import{r as x}from"./LabelXs-oqZNqbm_-C9ioCfD2.js";import{p as h}from"./Address-N-mzBgMy-CiOEX9Wr.js";import{d as g}from"./shared-FM0rljBt-Du14WgVh.js";import{C as j}from"./check-DoTzrX73.js";import{C as u}from"./copy-Bw2OWeg-.js";let v=r(g)`
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
`,z=r.div`
  font-size: 12px;
  line-height: 1rem;
  color: var(--privy-color-foreground-3);
`,b=r(x)`
  text-align: left;
  margin-bottom: 0.5rem;
`,w=r(f)`
  margin-top: 0.25rem;
`,E=r(p)`
  && {
    gap: 0.375rem;
    font-size: 14px;
  }
`;const R=({errMsg:t,balance:i,address:a,className:c,title:n,showCopyButton:m=!1})=>{let[o,l]=d.useState(!1);return d.useEffect((()=>{if(o){let s=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(s)}}),[o]),e.jsxs("div",{children:[n&&e.jsx(b,{children:n}),e.jsx(v,{className:c,$state:t?"error":void 0,children:e.jsxs(y,{children:[e.jsxs(C,{children:[e.jsx(h,{address:a,showCopyIcon:!1}),i!==void 0&&e.jsx(z,{children:i})]}),m&&e.jsx(E,{onClick:function(s){s.stopPropagation(),navigator.clipboard.writeText(a).then((()=>l(!0))).catch(console.error)},size:"sm",children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(j,{size:14})]}:{children:["Copy",e.jsx(u,{size:14})]})})]})}),t&&e.jsx(w,{children:t})]})};export{R as j};
