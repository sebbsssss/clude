import{d9 as d,d6 as e,ds as n}from"./index-DYJlS9iH.js";import{C as u}from"./check-DoTzrX73.js";import{C as m}from"./copy-Bw2OWeg-.js";let a=n.button`
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 0.5rem;

  svg {
    width: 0.875rem;
    height: 0.875rem;
  }
`,p=n.span`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  color: var(--privy-color-foreground-2);
`,h=n(u)`
  color: var(--privy-color-icon-success);
  flex-shrink: 0;
`,x=n(m)`
  color: var(--privy-color-icon-muted);
  flex-shrink: 0;
`;function v({children:r,iconOnly:l,value:o,hideCopyIcon:s,...c}){let[i,t]=d.useState(!1);return e.jsxs(a,{...c,onClick:()=>{navigator.clipboard.writeText(o||(typeof r=="string"?r:"")).catch(console.error),t(!0),setTimeout((()=>t(!1)),1500)},children:[r," ",i?e.jsxs(p,{children:[e.jsx(h,{})," ",!l&&"Copied"]}):!s&&e.jsx(x,{})]})}const y=({value:r,includeChildren:l,children:o,...s})=>{let[c,i]=d.useState(!1),t=()=>{navigator.clipboard.writeText(r).catch(console.error),i(!0),setTimeout((()=>i(!1)),1500)};return e.jsxs(e.Fragment,{children:[l?e.jsx(a,{...s,onClick:t,children:o}):e.jsx(e.Fragment,{children:o}),e.jsx(a,{...s,onClick:t,children:c?e.jsx(p,{children:e.jsx(h,{})}):e.jsx(x,{})})]})};export{v as m,y as p};
