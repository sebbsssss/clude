import{de as d,d4 as e,dx as r}from"./index-CTw60tnN.js";import{$ as p}from"./ModalHeader-BnVmXtvG-EcG3iF6i.js";import{e as x}from"./ErrorMessage-D8VaAP5m-C3OA27SV.js";import{r as f}from"./LabelXs-oqZNqbm_-C2cEDV-2.js";import{p as h}from"./Address-N-mzBgMy-B4DlUCDH.js";import{d as g}from"./shared-FM0rljBt-Bm3aDAWw.js";import{C as j}from"./check-Cti-pl3u.js";import{C as u}from"./copy-CH7e9s5N.js";let v=r(g)`
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
`,b=r(f)`
  text-align: left;
  margin-bottom: 0.5rem;
`,w=r(x)`
  margin-top: 0.25rem;
`,E=r(p)`
  && {
    gap: 0.375rem;
    font-size: 14px;
  }
`;const R=({errMsg:t,balance:s,address:a,className:c,title:n,showCopyButton:m=!1})=>{let[o,l]=d.useState(!1);return d.useEffect((()=>{if(o){let i=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(i)}}),[o]),e.jsxs("div",{children:[n&&e.jsx(b,{children:n}),e.jsx(v,{className:c,$state:t?"error":void 0,children:e.jsxs(y,{children:[e.jsxs(C,{children:[e.jsx(h,{address:a,showCopyIcon:!1}),s!==void 0&&e.jsx(z,{children:s})]}),m&&e.jsx(E,{onClick:function(i){i.stopPropagation(),navigator.clipboard.writeText(a).then((()=>l(!0))).catch(console.error)},size:"sm",children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(j,{size:14})]}:{children:["Copy",e.jsx(u,{size:14})]})})]})}),t&&e.jsx(w,{children:t})]})};export{R as j};
