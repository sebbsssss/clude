import{dx as a,dF as b,dc as E,de as h,d4 as e,df as v,dg as x,e3 as C,eW as P}from"./index-l91PVMT7.js";import{a as I,c as m}from"./TodoList-CgrU7uwu-DEN9KkRx.js";import{n as L}from"./ScreenLayout-D1p_ntex-B3Nwe3ZC.js";import{C as N}from"./circle-check-big-BNdmOtRe.js";import{F as w}from"./fingerprint-pattern-CiqnqvbL.js";import{c as S}from"./createLucideIcon-BUyq3X6S.js";import"./check-C-2Axsx_.js";import"./ModalHeader-BnVmXtvG-BbPQjodo.js";import"./Screen-Cycy3IzT-D1vgF4Ou.js";import"./index-Dq_xe9dz-B89WBFCw.js";const A=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],W=S("trash-2",A),M=({passkeys:s,isLoading:d,errorReason:u,success:y,expanded:n,onLinkPasskey:l,onUnlinkPasskey:o,onExpand:r,onBack:t,onClose:i})=>e.jsx(L,y?{title:"Passkeys updated",icon:N,iconVariant:"success",primaryCta:{label:"Done",onClick:i},onClose:i,watermark:!0}:n?{icon:w,title:"Your passkeys",onBack:t,onClose:i,watermark:!0,children:e.jsx(j,{passkeys:s,expanded:n,onUnlink:o,onExpand:r})}:{icon:w,title:"Set up passkey verification",subtitle:"Verify with passkey",primaryCta:{label:"Add new passkey",onClick:l,loading:d},onClose:i,watermark:!0,helpText:u||void 0,children:s.length===0?e.jsx(U,{}):e.jsx(B,{children:e.jsx(j,{passkeys:s,expanded:n,onUnlink:o,onExpand:r})})});let B=a.div`
  margin-bottom: 12px;
`,j=({passkeys:s,expanded:d,onUnlink:u,onExpand:y})=>{let[n,l]=h.useState([]),o=d?s.length:2;return e.jsxs("div",{children:[e.jsx(V,{children:"Your passkeys"}),e.jsxs(T,{children:[s.slice(0,o).map((r=>{return e.jsxs(O,{children:[e.jsxs("div",{children:[e.jsx(z,{children:(t=r,t.authenticatorName?t.createdWithBrowser?`${t.authenticatorName} on ${t.createdWithBrowser}`:t.authenticatorName:t.createdWithBrowser?t.createdWithOs?`${t.createdWithBrowser} on ${t.createdWithOs}`:`${t.createdWithBrowser}`:"Unknown device")}),e.jsxs(F,{children:["Last used:"," ",(r.latestVerifiedAt??r.firstVerifiedAt)?.toLocaleString()??"N/A"]})]}),e.jsx(R,{disabled:n.includes(r.credentialId),onClick:()=>(async i=>{l((p=>p.concat([i]))),await u(i),l((p=>p.filter((f=>f!==i))))})(r.credentialId),children:n.includes(r.credentialId)?e.jsx(P,{}):e.jsx(W,{size:16})})]},r.credentialId);var t})),s.length>2&&!d&&e.jsx($,{onClick:y,children:"View all"})]})]})},U=()=>e.jsxs(I,{style:{color:"var(--privy-color-foreground)"},children:[e.jsx(m,{children:"Verify with Touch ID, Face ID, PIN, or hardware key"}),e.jsx(m,{children:"Takes seconds to set up and use"}),e.jsx(m,{children:"Use your passkey to verify transactions and login to your account"})]});const te={component:()=>{let{user:s,unlinkPasskey:d}=b(),{linkWithPasskey:u,closePrivyModal:y}=E(),n=s?.linkedAccounts.filter((c=>c.type==="passkey")),[l,o]=h.useState(!1),[r,t]=h.useState(""),[i,p]=h.useState(!1),[f,k]=h.useState(!1);return h.useEffect((()=>{n.length===0&&k(!1)}),[n.length]),e.jsx(M,{passkeys:n,isLoading:l,errorReason:r,success:i,expanded:f,onLinkPasskey:()=>{o(!0),u().then((()=>p(!0))).catch((c=>{if(c instanceof v){if(c.privyErrorCode===x.CANNOT_LINK_MORE_OF_TYPE)return void t("Cannot link more passkeys to account.");if(c.privyErrorCode===x.PASSKEY_NOT_ALLOWED)return void t("Passkey request timed out or rejected by user.")}t("Unknown error occurred.")})).finally((()=>{o(!1)}))},onUnlinkPasskey:async c=>(o(!0),await d(c).then((()=>p(!0))).catch((g=>{g instanceof v&&g.privyErrorCode===x.MISSING_MFA_CREDENTIALS?t("Cannot unlink a passkey enrolled in MFA"):t("Unknown error occurred.")})).finally((()=>{o(!1)}))),onExpand:()=>k(!0),onBack:()=>k(!1),onClose:()=>y()})}},re=a.div`
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
`;let _=C`
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
`;const $=a.button`
  ${_}
`;let T=a.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.8rem;
  padding: 0.5rem 0rem 0rem;
  flex-grow: 1;
  width: 100%;
`,V=a.div`
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
`,F=a.div`
  font-size: 0.875rem;
  line-height: 1rem;
  color: #64668b;
  padding: 0.2em 0;
`,O=a.div`
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
`,D=C`
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
  ${D}
`;export{re as DoubleIconWrapper,$ as LinkButton,te as LinkPasskeyScreen,M as LinkPasskeyView,te as default};
