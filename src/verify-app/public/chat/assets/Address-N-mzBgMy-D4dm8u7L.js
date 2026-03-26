import{r as p,j as e,b2 as d,aV as s}from"./vendor-privy-DtunxRQf.js";import{$ as m}from"./ModalHeader-BnVmXtvG-CidjF2-W.js";import{C as x}from"./check-MsF7fwPJ.js";import{C as f}from"./copy-86b8b8bP.js";const v=({address:r,showCopyIcon:i,url:n,className:a})=>{let[o,l]=p.useState(!1);function c(t){t.stopPropagation(),navigator.clipboard.writeText(r).then((()=>l(!0))).catch(console.error)}return p.useEffect((()=>{if(o){let t=setTimeout((()=>l(!1)),3e3);return()=>clearTimeout(t)}}),[o]),e.jsxs(h,n?{children:[e.jsx(j,{title:r,className:a,href:`${n}/address/${r}`,target:"_blank",children:d(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:16})]}:{children:["Copy",e.jsx(f,{size:16})]})})]}:{children:[e.jsx(g,{title:r,className:a,children:d(r)}),i&&e.jsx(m,{onClick:c,size:"sm",style:{gap:"0.375rem",fontSize:"14px"},children:e.jsxs(e.Fragment,o?{children:["Copied",e.jsx(x,{size:14})]}:{children:["Copy",e.jsx(f,{size:14})]})})]})};let h=s.span`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
`,g=s.span`
  font-size: 14px;
  font-weight: 500;
  color: var(--privy-color-foreground);
`,j=s.a`
  font-size: 14px;
  color: var(--privy-color-foreground);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;export{v as p};
