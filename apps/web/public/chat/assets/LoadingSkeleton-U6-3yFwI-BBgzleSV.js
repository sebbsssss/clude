import{cW as r,db as i}from"./vendor-privy-BA9hQiL2.js";let a=i`
  from, to {
    background: var(--privy-color-foreground-4);
    color: var(--privy-color-foreground-4);
  }

  50% {
    background: var(--privy-color-foreground-accent);
    color: var(--privy-color-foreground-accent);
  }
`;const c=r`
  ${o=>o.$isLoading?r`
          width: 35%;
          animation: ${a} 2s linear infinite;
          border-radius: var(--privy-border-radius-sm);
        `:""}
`;export{c as n};
