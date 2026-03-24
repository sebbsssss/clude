import{de as n,dF as A,dc as B,db as W,da as L,d4 as t,dx as f,dX as U}from"./index-l91PVMT7.js";import{t as $}from"./WarningBanner-D5LqDt95-D8gQDIGJ.js";import{j as R}from"./WalletInfoCard-CEcdukTg-UYwaNtHt.js";import{n as F}from"./ScreenLayout-D1p_ntex-B3Nwe3ZC.js";import"./ExclamationTriangleIcon-CTmms4EP.js";import"./ModalHeader-BnVmXtvG-BbPQjodo.js";import"./ErrorMessage-D8VaAP5m-DXi4FGVO.js";import"./LabelXs-oqZNqbm_-BacmFe54.js";import"./Address-N-mzBgMy-BAhrVwzj.js";import"./check-C-2Axsx_.js";import"./createLucideIcon-BUyq3X6S.js";import"./copy-Q-nBPI3B.js";import"./shared-FM0rljBt-BMFl62gL.js";import"./Screen-Cycy3IzT-D1vgF4Ou.js";import"./index-Dq_xe9dz-B89WBFCw.js";const K=({address:e,accessToken:o,appConfigTheme:l,onClose:d,exportButtonProps:i,onBack:a})=>t.jsx(F,{title:"Export wallet",subtitle:t.jsxs(t.Fragment,{children:["Copy either your private key or seed phrase to export your wallet."," ",t.jsx("a",{href:"https://privy-io.notion.site/Transferring-your-account-9dab9e16c6034a7ab1ff7fa479b02828",target:"blank",rel:"noopener noreferrer",children:"Learn more"})]}),onClose:d,onBack:a,showBack:!!a,watermark:!0,children:t.jsxs(O,{children:[t.jsx($,{theme:l,children:"Never share your private key or seed phrase with anyone."}),t.jsx(R,{title:"Your wallet",address:e,showCopyButton:!0}),t.jsx("div",{style:{width:"100%"},children:o&&i&&t.jsx(z,{accessToken:o,dimensions:{height:"44px"},...i})})]})});let O=f.div`
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: left;
`;function z(e){let[o,l]=n.useState(e.dimensions.width),[d,i]=n.useState(!1),[a,p]=n.useState(void 0),s=n.useRef(null);n.useEffect((()=>{if(s.current&&o===void 0){let{width:u}=s.current.getBoundingClientRect();l(u)}let r=getComputedStyle(document.documentElement);p({background:r.getPropertyValue("--privy-color-background"),background2:r.getPropertyValue("--privy-color-background-2"),foreground3:r.getPropertyValue("--privy-color-foreground-3"),foregroundAccent:r.getPropertyValue("--privy-color-foreground-accent"),accent:r.getPropertyValue("--privy-color-accent"),accentDark:r.getPropertyValue("--privy-color-accent-dark"),success:r.getPropertyValue("--privy-color-success"),colorScheme:r.getPropertyValue("color-scheme")})}),[]);let c=e.chainType==="ethereum"&&!e.imported&&!e.isUnifiedWallet;return t.jsx("div",{ref:s,children:o&&t.jsxs(D,{children:[t.jsx("iframe",{style:{position:"absolute",zIndex:1,opacity:d?1:0,transition:"opacity 50ms ease-in-out",pointerEvents:d?"auto":"none"},onLoad:()=>setTimeout((()=>i(!0)),1500),width:o,height:e.dimensions.height,allow:"clipboard-write self *",src:U({origin:e.origin,path:`/apps/${e.appId}/embedded-wallets/export`,query:e.isUnifiedWallet?{v:"1-unified",wallet_id:e.walletId,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...a}:{v:"1",entropy_id:e.entropyId,entropy_id_verifier:e.entropyIdVerifier,hd_wallet_index:e.hdWalletIndex,chain_type:e.chainType,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...a},hash:{token:e.accessToken}})}),t.jsx(x,{children:"Loading..."}),c&&t.jsx(x,{children:"Loading..."})]})})}const ae={component:()=>{let[e,o]=n.useState(null),{authenticated:l,user:d}=A(),{closePrivyModal:i,createAnalyticsEvent:a,clientAnalyticsId:p,client:s}=B(),c=W(),{data:r,onUserCloseViaDialogOrKeybindRef:u}=L(),{onFailure:v,onSuccess:w,origin:k,appId:I,appClientId:b,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,chainType:T,address:m,isUnifiedWallet:V,imported:P,showBackButton:S}=r.keyExport,g=y=>{i({shouldCallAuthOnSuccess:!1}),v(typeof y=="string"?Error(y):y)},h=()=>{i({shouldCallAuthOnSuccess:!1}),w(),a({eventName:"embedded_wallet_key_export_completed",payload:{walletAddress:m}})};return n.useEffect((()=>{if(!l)return g("User must be authenticated before exporting their wallet");s.getAccessToken().then(o).catch(g)}),[l,d]),u.current=h,t.jsx(K,{address:m,accessToken:e,appConfigTheme:c.appearance.palette.colorScheme,onClose:h,isLoading:!e,onBack:S?h:void 0,exportButtonProps:e?{origin:k,appId:I,appClientId:b,clientAnalyticsId:p,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,isUnifiedWallet:V,imported:P,chainType:T}:void 0})}};let D=f.div`
  overflow: visible;
  position: relative;
  overflow: none;
  height: 44px;
  display: flex;
  gap: 12px;
`,x=f.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: 500;
  border-radius: var(--privy-border-radius-md);
  background-color: var(--privy-color-background-2);
  color: var(--privy-color-foreground-3);
`;export{ae as EmbeddedWalletKeyExportScreen,K as EmbeddedWalletKeyExportView,ae as default};
