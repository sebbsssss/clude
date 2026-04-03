import{bO as a,bN as C,ak as E,r as h,j as e,bQ as v,ag as m,cW as b,cV as P}from"./vendor-privy-BA9hQiL2.js";import{a as I,c as x}from"./TodoList-CgrU7uwu-D_FwubHe.js";import{n as L}from"./ScreenLayout-D1p_ntex-BehYPJaQ.js";import{C as N}from"./circle-check-big-Bq-MM-j_.js";import{F as w}from"./fingerprint-pattern-DJZfvpr0.js";import{c as S}from"./createLucideIcon-qAGt5Wmt.js";import"./check-CyZnMjpS.js";import"./ModalHeader-BnVmXtvG-C1ndut6F.js";import"./Screen-Cycy3IzT-By9WDgqH.js";import"./index-Dq_xe9dz-DrnttNFa.js";const A=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],W=S("trash-2",A),M=({passkeys:s,isLoading:l,errorReason:u,success:y,expanded:n,onLinkPasskey:d,onUnlinkPasskey:o,onExpand:r,onBack:t,onClose:i})=>e.jsx(L,y?{title:"Passkeys updated",icon:N,iconVariant:"success",primaryCta:{label:"Done",onClick:i},onClose:i,watermark:!0}:n?{icon:w,title:"Your passkeys",onBack:t,onClose:i,watermark:!0,children:e.jsx(j,{passkeys:s,expanded:n,onUnlink:o,onExpand:r})}:{icon:w,title:"Set up passkey verification",subtitle:"Verify with passkey",primaryCta:{label:"Add new passkey",onClick:d,loading:l},onClose:i,watermark:!0,helpText:u||void 0,children:s.length===0?e.jsx(U,{}):e.jsx(B,{children:e.jsx(j,{passkeys:s,expanded:n,onUnlink:o,onExpand:r})})});let B=a.div`
  margin-bottom: 12px;
`,j=({passkeys:s,expanded:l,onUnlink:u,onExpand:y})=>{let[n,d]=h.useState([]),o=l?s.length:2;return e.jsxs("div",{children:[e.jsx(T,{children:"Your passkeys"}),e.jsxs($,{children:[s.slice(0,o).map((r=>{return e.jsxs(D,{children:[e.jsxs("div",{children:[e.jsx(z,{children:(t=r,t.authenticatorName?t.createdWithBrowser?`${t.authenticatorName} on ${t.createdWithBrowser}`:t.authenticatorName:t.createdWithBrowser?t.createdWithOs?`${t.createdWithBrowser} on ${t.createdWithOs}`:`${t.createdWithBrowser}`:"Unknown device")}),e.jsxs(O,{children:["Last used:"," ",(r.latestVerifiedAt??r.firstVerifiedAt)?.toLocaleString()??"N/A"]})]}),e.jsx(R,{disabled:n.includes(r.credentialId),onClick:()=>(async i=>{d((p=>p.concat([i]))),await u(i),d((p=>p.filter((k=>k!==i))))})(r.credentialId),children:n.includes(r.credentialId)?e.jsx(P,{}):e.jsx(W,{size:16})})]},r.credentialId);var t})),s.length>2&&!l&&e.jsx(_,{onClick:y,children:"View all"})]})]})},U=()=>e.jsxs(I,{style:{color:"var(--privy-color-foreground)"},children:[e.jsx(x,{children:"Verify with Touch ID, Face ID, PIN, or hardware key"}),e.jsx(x,{children:"Takes seconds to set up and use"}),e.jsx(x,{children:"Use your passkey to verify transactions and login to your account"})]});const te={component:()=>{let{user:s,unlinkPasskey:l}=C(),{linkWithPasskey:u,closePrivyModal:y}=E(),n=s?.linkedAccounts.filter((c=>c.type==="passkey")),[d,o]=h.useState(!1),[r,t]=h.useState(""),[i,p]=h.useState(!1),[k,f]=h.useState(!1);return h.useEffect((()=>{n.length===0&&f(!1)}),[n.length]),e.jsx(M,{passkeys:n,isLoading:d,errorReason:r,success:i,expanded:k,onLinkPasskey:()=>{o(!0),u().then((()=>p(!0))).catch((c=>{if(c instanceof v){if(c.privyErrorCode===m.CANNOT_LINK_MORE_OF_TYPE)return void t("Cannot link more passkeys to account.");if(c.privyErrorCode===m.PASSKEY_NOT_ALLOWED)return void t("Passkey request timed out or rejected by user.")}t("Unknown error occurred.")})).finally((()=>{o(!1)}))},onUnlinkPasskey:async c=>(o(!0),await l(c).then((()=>p(!0))).catch((g=>{g instanceof v&&g.privyErrorCode===m.MISSING_MFA_CREDENTIALS?t("Cannot unlink a passkey enrolled in MFA"):t("Unknown error occurred.")})).finally((()=>{o(!1)}))),onExpand:()=>f(!0),onBack:()=>f(!1),onClose:()=>y()})}},re=a.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 90px;
  border-radius: 50%;
  svg + svg {
    margin-left: 12px;
  }
  > svg {
    z-index: 2;
    color: var(--privy-color-accent) !important;
    stroke: var(--privy-color-accent) !important;
    fill: var(--privy-color-accent) !important;
  }
`;let V=b`
  && {
    width: 100%;
    font-size: 0.875rem;
    line-height: 1rem;

    /* Tablet and Up */
    @media (min-width: 440px) {
      font-size: 14px;
    }

    display: flex;
    gap: 12px;
    justify-content: center;

    padding: 6px 8px;
    background-color: var(--privy-color-background);
    transition: background-color 200ms ease;
    color: var(--privy-color-accent) !important;

    :focus {
      outline: none;
      box-shadow: none;
    }
  }
`;const _=a.button`
  ${V}
`;let $=a.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.8rem;
  padding: 0.5rem 0rem 0rem;
  flex-grow: 1;
  width: 100%;
`,T=a.div`
  line-height: 20px;
  height: 20px;
  font-size: 1em;
  font-weight: 450;
  display: flex;
  justify-content: flex-beginning;
  width: 100%;
`,z=a.div`
  font-size: 1em;
  line-height: 1.3em;
  font-weight: 500;
  color: var(--privy-color-foreground-2);
  padding: 0.2em 0;
`,O=a.div`
  font-size: 0.875rem;
  line-height: 1rem;
  color: #64668b;
  padding: 0.2em 0;
`,D=a.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1em;
  gap: 10px;
  font-size: 0.875rem;
  line-height: 1rem;
  text-align: left;
  border-radius: 8px;
  border: 1px solid #e2e3f0 !important;
  width: 100%;
  height: 5em;
`,F=b`
  :focus,
  :hover,
  :active {
    outline: none;
  }
  display: flex;
  width: 2em;
  height: 2em;
  justify-content: center;
  align-items: center;
  svg {
    color: var(--privy-color-error);
  }
  svg:hover {
    color: var(--privy-color-foreground-3);
  }
`,R=a.button`
  ${F}
`;export{re as DoubleIconWrapper,_ as LinkButton,te as LinkPasskeyScreen,M as LinkPasskeyView,te as default};
