import{al as m,am as e,ar as r}from"./index-C5ltmIwg.js";import{$ as p}from"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import{e as f}from"./ErrorMessage-D8VaAP5m-DXcmz3Wa.js";import{r as x}from"./LabelXs-oqZNqbm_-C3djtduR.js";import{p as h}from"./Address-N-mzBgMy-BW5O7Cjv.js";import{d as g}from"./shared-FM0rljBt-B6RtpVjf.js";import{C as j}from"./check-D-N_CMlD.js";import{C as u}from"./copy-BVx5KpSy.js";let v=r(g)`
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
`;const R=({errMsg:t,balance:s,address:a,className:c,title:n,showCopyButton:d=!1})=>{let[o,l]=m.useState(!1);return m.useEffect((()=>{if(o){let i=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(i)}}),[o]),e.jsxs("div",{children:[n&&e.jsx(b,{children:n}),e.jsx(v,{className:c,$state:t?"error":void 0,children:e.jsxs(y,{children:[e.jsxs(C,{children:[e.jsx(h,{address:a,showCopyIcon:!1}),s!==void 0&&e.jsx(z,{children:s})]}),d&&e.jsx(E,{onClick:function(i){i.stopPropagation(),navigator.clipboard.writeText(a).then((()=>l(!0))).catch(console.error)},size:"sm",children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(j,{size:14})]}:{children:["Copy",e.jsx(u,{size:14})]})})]})}),t&&e.jsx(w,{children:t})]})};export{R as j};
