import{d4 as r,dx as o}from"./index-CTw60tnN.js";const c=({title:i,description:t,children:n,...e})=>r.jsx(l,{...e,children:r.jsxs(r.Fragment,{children:[r.jsx("h3",{children:i}),typeof t=="string"?r.jsx("p",{children:t}):t,n]})});o(c)`
  margin-bottom: 24px;
`;const x=({title:i,description:t,icon:n,children:e,...s})=>r.jsxs(a,{...s,children:[n||null,r.jsx("h3",{children:i}),t&&typeof t=="string"?r.jsx("p",{children:t}):t,e]});let l=o.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  text-align: left;
  gap: 8px;
  width: 100%;
  margin-bottom: 24px;

  && h3 {
    font-size: 17px;
    color: var(--privy-color-foreground);
  }

  /* Sugar assuming children are paragraphs. Otherwise, handling styling on your own */
  && p {
    color: var(--privy-color-foreground-2);
    font-size: 14px;
  }
`,a=o(l)`
  align-items: center;
  text-align: center;
  gap: 16px;

  h3 {
    margin-bottom: 24px;
  }
`;export{c as n,x as o};
