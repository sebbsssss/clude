import{d9 as d,d6 as e,dg as p,ds as t}from"./index-DYJlS9iH.js";import{$ as m}from"./ModalHeader-BnVmXtvG-BhMbJOlz.js";import{C as x}from"./check-DoTzrX73.js";import{C as f}from"./copy-Bw2OWeg-.js";const v=({address:r,showCopyIcon:i,url:n,className:a})=>{let[o,l]=d.useState(!1);function c(s){s.stopPropagation(),navigator.clipboard.writeText(r).then((()=>l(!0))).catch(console.error)}return d.useEffect((()=>{if(o){let s=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(s)}}),[o]),e.jsxs(h,n?{children:[e.jsx(u,{title:r,className:a,href:`${n}/address/${r}`,target:"_blank",children:p(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:16})]}:{children:["Copy",e.jsx(f,{size:16})]})})]}:{children:[e.jsx(g,{title:r,className:a,children:p(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem",fontSize:"14px"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:14})]}:{children:["Copy",e.jsx(f,{size:14})]})})]})};let h=t.span`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
`,g=t.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,u=t.a`
  font-size: 14px;
  color: var(--privy-color-foreground);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;export{v as p};
