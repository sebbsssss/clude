import{ar as o,aq as b,ap as E,al as h,am as e,at as v,au as f,cP as C,cO as P}from"./index-C5ltmIwg.js";import{a as I,c as x}from"./TodoList-CgrU7uwu-BH6xhCTQ.js";import{n as L}from"./ScreenLayout-D1p_ntex-zQJzln9L.js";import{C as N}from"./circle-check-big-DNEIDx9U.js";import{F as w}from"./fingerprint-pattern-BjH6IuLU.js";import{c as S}from"./createLucideIcon-bRcOMvfd.js";import"./check-D-N_CMlD.js";import"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import"./Screen-Cycy3IzT-CRRvO9tN.js";import"./index-Dq_xe9dz-CSuLitfE.js";const A=[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],M=S("trash-2",A),W=({passkeys:a,isLoading:l,errorReason:u,success:y,expanded:n,onLinkPasskey:d,onUnlinkPasskey:s,onExpand:r,onBack:t,onClose:i})=>e.jsx(L,y?{title:"Passkeys updated",icon:N,iconVariant:"success",primaryCta:{label:"Done",onClick:i},onClose:i,watermark:!0}:n?{icon:w,title:"Your passkeys",onBack:t,onClose:i,watermark:!0,children:e.jsx(j,{passkeys:a,expanded:n,onUnlink:s,onExpand:r})}:{icon:w,title:"Set up passkey verification",subtitle:"Verify with passkey",primaryCta:{label:"Add new passkey",onClick:d,loading:l},onClose:i,watermark:!0,helpText:u||void 0,children:a.length===0?e.jsx(U,{}):e.jsx(B,{children:e.jsx(j,{passkeys:a,expanded:n,onUnlink:s,onExpand:r})})});let B=o.div`
  margin-bottom: 12px;
`,j=({passkeys:a,expanded:l,onUnlink:u,onExpand:y})=>{let[n,d]=h.useState([]),s=l?a.length:2;return e.jsxs("div",{children:[e.jsx(V,{children:"Your passkeys"}),e.jsxs(T,{children:[a.slice(0,s).map((r=>{return e.jsxs(D,{children:[e.jsxs("div",{children:[e.jsx(z,{children:(t=r,t.authenticatorName?t.createdWithBrowser?`${t.authenticatorName} on ${t.createdWithBrowser}`:t.authenticatorName:t.createdWithBrowser?t.createdWithOs?`${t.createdWithBrowser} on ${t.createdWithOs}`:`${t.createdWithBrowser}`:"Unknown device")}),e.jsxs(O,{children:["Last used:"," ",(r.latestVerifiedAt??r.firstVerifiedAt)?.toLocaleString()??"N/A"]})]}),e.jsx(R,{disabled:n.includes(r.credentialId),onClick:()=>(async i=>{d((p=>p.concat([i]))),await u(i),d((p=>p.filter((k=>k!==i))))})(r.credentialId),children:n.includes(r.credentialId)?e.jsx(P,{}):e.jsx(M,{size:16})})]},r.credentialId);var t})),a.length>2&&!l&&e.jsx($,{onClick:y,children:"View all"})]})]})},U=()=>e.jsxs(I,{style:{color:"var(--privy-color-foreground)"},children:[e.jsx(x,{children:"Verify with Touch ID, Face ID, PIN, or hardware key"}),e.jsx(x,{children:"Takes seconds to set up and use"}),e.jsx(x,{children:"Use your passkey to verify transactions and login to your account"})]});const te={component:()=>{let{user:a,unlinkPasskey:l}=b(),{linkWithPasskey:u,closePrivyModal:y}=E(),n=a?.linkedAccounts.filter((c=>c.type==="passkey")),[d,s]=h.useState(!1),[r,t]=h.useState(""),[i,p]=h.useState(!1),[k,m]=h.useState(!1);return h.useEffect((()=>{n.length===0&&m(!1)}),[n.length]),e.jsx(W,{passkeys:n,isLoading:d,errorReason:r,success:i,expanded:k,onLinkPasskey:()=>{s(!0),u().then((()=>p(!0))).catch((c=>{if(c instanceof v){if(c.privyErrorCode===f.CANNOT_LINK_MORE_OF_TYPE)return void t("Cannot link more passkeys to account.");if(c.privyErrorCode===f.PASSKEY_NOT_ALLOWED)return void t("Passkey request timed out or rejected by user.")}t("Unknown error occurred.")})).finally((()=>{s(!1)}))},onUnlinkPasskey:async c=>(s(!0),await l(c).then((()=>p(!0))).catch((g=>{g instanceof v&&g.privyErrorCode===f.MISSING_MFA_CREDENTIALS?t("Cannot unlink a passkey enrolled in MFA"):t("Unknown error occurred.")})).finally((()=>{s(!1)}))),onExpand:()=>m(!0),onBack:()=>m(!1),onClose:()=>y()})}},re=o.div`
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
`;const $=o.button`
  ${_}
`;let T=o.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.8rem;
  padding: 0.5rem 0rem 0rem;
  flex-grow: 1;
  width: 100%;
`,V=o.div`
  line-height: 20px;
  height: 20px;
  font-size: 1em;
  font-weight: 450;
  display: flex;
  justify-content: flex-beginning;
  width: 100%;
`,z=o.div`
  font-size: 1em;
  line-height: 1.3em;
  font-weight: 500;
  color: var(--privy-color-foreground-2);
  padding: 0.2em 0;
`,O=o.div`
  font-size: 0.875rem;
  line-height: 1rem;
  color: #64668b;
  padding: 0.2em 0;
`,D=o.div`
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
`,F=C`
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
`,R=o.button`
  ${F}
`;export{re as DoubleIconWrapper,$ as LinkButton,te as LinkPasskeyScreen,W as LinkPasskeyView,te as default};
