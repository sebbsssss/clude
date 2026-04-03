import{al as n,aq as A,ap as B,ao as W,an as L,am as t,ar as m,cE as U}from"./index-C5ltmIwg.js";import{t as $}from"./WarningBanner-D5LqDt95-CbF55FUg.js";import{j as R}from"./WalletInfoCard-CEcdukTg-Ch1BooAC.js";import{n as K}from"./ScreenLayout-D1p_ntex-zQJzln9L.js";import"./ExclamationTriangleIcon-B3ddPmRH.js";import"./ModalHeader-BnVmXtvG-BcKBQfIN.js";import"./ErrorMessage-D8VaAP5m-DXcmz3Wa.js";import"./LabelXs-oqZNqbm_-C3djtduR.js";import"./Address-N-mzBgMy-BW5O7Cjv.js";import"./check-D-N_CMlD.js";import"./createLucideIcon-bRcOMvfd.js";import"./copy-BVx5KpSy.js";import"./shared-FM0rljBt-B6RtpVjf.js";import"./Screen-Cycy3IzT-CRRvO9tN.js";import"./index-Dq_xe9dz-CSuLitfE.js";const O=({address:e,accessToken:o,appConfigTheme:l,onClose:s,exportButtonProps:i,onBack:a})=>t.jsx(K,{title:"Export wallet",subtitle:t.jsxs(t.Fragment,{children:["Copy either your private key or seed phrase to export your wallet."," ",t.jsx("a",{href:"https://privy-io.notion.site/Transferring-your-account-9dab9e16c6034a7ab1ff7fa479b02828",target:"blank",rel:"noopener noreferrer",children:"Learn more"})]}),onClose:s,onBack:a,showBack:!!a,watermark:!0,children:t.jsxs(q,{children:[t.jsx($,{theme:l,children:"Never share your private key or seed phrase with anyone."}),t.jsx(R,{title:"Your wallet",address:e,showCopyButton:!0}),t.jsx("div",{style:{width:"100%"},children:o&&i&&t.jsx(z,{accessToken:o,dimensions:{height:"44px"},...i})})]})});let q=m.div`
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: left;
`;function z(e){let[o,l]=n.useState(e.dimensions.width),[s,i]=n.useState(!1),[a,p]=n.useState(void 0),d=n.useRef(null);n.useEffect((()=>{if(d.current&&o===void 0){let{width:u}=d.current.getBoundingClientRect();l(u)}let r=getComputedStyle(document.documentElement);p({background:r.getPropertyValue("--privy-color-background"),background2:r.getPropertyValue("--privy-color-background-2"),foreground3:r.getPropertyValue("--privy-color-foreground-3"),foregroundAccent:r.getPropertyValue("--privy-color-foreground-accent"),accent:r.getPropertyValue("--privy-color-accent"),accentDark:r.getPropertyValue("--privy-color-accent-dark"),success:r.getPropertyValue("--privy-color-success"),colorScheme:r.getPropertyValue("color-scheme")})}),[]);let c=e.chainType==="ethereum"&&!e.imported&&!e.isUnifiedWallet;return t.jsx("div",{ref:d,children:o&&t.jsxs(D,{children:[t.jsx("iframe",{style:{position:"absolute",zIndex:1,opacity:s?1:0,transition:"opacity 50ms ease-in-out",pointerEvents:s?"auto":"none"},onLoad:()=>setTimeout((()=>i(!0)),1500),width:o,height:e.dimensions.height,allow:"clipboard-write self *",src:U({origin:e.origin,path:`/apps/${e.appId}/embedded-wallets/export`,query:e.isUnifiedWallet?{v:"1-unified",wallet_id:e.walletId,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...a}:{v:"1",entropy_id:e.entropyId,entropy_id_verifier:e.entropyIdVerifier,hd_wallet_index:e.hdWalletIndex,chain_type:e.chainType,client_id:e.appClientId,width:`${o}px`,caid:e.clientAnalyticsId,phrase_export:c,...a},hash:{token:e.accessToken}})}),t.jsx(x,{children:"Loading..."}),c&&t.jsx(x,{children:"Loading..."})]})})}const ae={component:()=>{let[e,o]=n.useState(null),{authenticated:l,user:s}=A(),{closePrivyModal:i,createAnalyticsEvent:a,clientAnalyticsId:p,client:d}=B(),c=W(),{data:r,onUserCloseViaDialogOrKeybindRef:u}=L(),{onFailure:v,onSuccess:w,origin:k,appId:I,appClientId:b,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,chainType:T,address:f,isUnifiedWallet:V,imported:P,showBackButton:S}=r.keyExport,g=y=>{i({shouldCallAuthOnSuccess:!1}),v(typeof y=="string"?Error(y):y)},h=()=>{i({shouldCallAuthOnSuccess:!1}),w(),a({eventName:"embedded_wallet_key_export_completed",payload:{walletAddress:f}})};return n.useEffect((()=>{if(!l)return g("User must be authenticated before exporting their wallet");d.getAccessToken().then(o).catch(g)}),[l,s]),u.current=h,t.jsx(O,{address:f,accessToken:e,appConfigTheme:c.appearance.palette.colorScheme,onClose:h,isLoading:!e,onBack:S?h:void 0,exportButtonProps:e?{origin:k,appId:I,appClientId:b,clientAnalyticsId:p,entropyId:j,entropyIdVerifier:C,walletId:_,hdWalletIndex:E,isUnifiedWallet:V,imported:P,chainType:T}:void 0})}};let D=m.div`
  overflow: visible;
  position: relative;
  overflow: none;
  height: 44px;
  display: flex;
  gap: 12px;
`,x=m.div`
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
`;export{ae as EmbeddedWalletKeyExportScreen,O as EmbeddedWalletKeyExportView,ae as default};
