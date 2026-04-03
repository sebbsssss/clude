import{am as r,ar as i}from"./index-C5ltmIwg.js";let l=({data:t})=>{let e=o=>typeof o=="object"&&o!==null?r.jsx(d,{children:Object.entries(o).map((([a,n])=>r.jsxs("li",{children:[r.jsxs("strong",{children:[a,":"]})," ",e(n)]},a)))}):r.jsx("span",{children:String(o)});return r.jsx("div",{children:e(t)})};const s=i.div`
  margin-top: 1.5rem;
  background-color: var(--privy-color-background-2);
  border-radius: var(--privy-border-radius-md);
  padding: 12px;
  text-align: left;
  max-height: 310px;
  overflow: scroll;
  white-space: pre-wrap;
  width: 100%;
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--privy-color-foreground);
  line-height: 1.5;

  // hide the scrollbars
  -ms-overflow-style: none; /* Internet Explorer 10+ */
  scrollbar-width: none; /* Firefox */

  &::-webkit-scrollbar {
    display: none; /* Safari and Chrome */
  }
`;let d=i.ul`
  margin-left: 12px !important;
  white-space: nowrap;

  &:first-child {
    margin-left: 0 !important;
  }

  strong {
    font-weight: 500 !important;
  }
`;const p=({data:t,className:e})=>r.jsx(s,{className:e,children:r.jsx(l,{data:t})});export{p as a,s as i};
