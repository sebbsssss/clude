import{cR as p,cO as e,cY as d,d7 as s}from"./index-7Y6H6yFI.js";import{$ as m}from"./ModalHeader-BnVmXtvG-DSojumJk.js";import{C as x}from"./check-Da8mFkct.js";import{C as f}from"./copy-DH-rCJFw.js";const v=({address:r,showCopyIcon:i,url:n,className:a})=>{let[o,l]=p.useState(!1);function c(t){t.stopPropagation(),navigator.clipboard.writeText(r).then((()=>l(!0))).catch(console.error)}return p.useEffect((()=>{if(o){let t=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(t)}}),[o]),e.jsxs(h,n?{children:[e.jsx(u,{title:r,className:a,href:`${n}/address/${r}`,target:"_blank",children:d(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:16})]}:{children:["Copy",e.jsx(f,{size:16})]})})]}:{children:[e.jsx(g,{title:r,className:a,children:d(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem",fontSize:"14px"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:14})]}:{children:["Copy",e.jsx(f,{size:14})]})})]})};let h=s.span`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
`,g=s.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,u=s.a`
  font-size: 14px;
  color: var(--privy-color-foreground);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;export{v as p};
